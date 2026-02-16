import logging
import os
import shutil
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, status
from fastapi import APIRouter
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from app.database import get_db, engine, Base, SessionLocal
from app.models import User, DownloadLog
from app.schemas import (
    UserCreate,
    UserLogin,
    Token,
    DownloadRequest,
    DownloadJobResponse,
    DownloadStatusResponse,
    UserInfo,
    DownloadLogInfo,
    DownloadLogUpdate,
    DownloadHistoryItem,
    DownloadHistoryResponse,
    UserUpdate,
)
from app.auth import (
    get_password_hash,
    verify_password,
    create_access_token,
    decode_token,
)
from app.download_service import download_video_with_subs, fetch_og_meta_from_url
from app.subtitle_service import search_subtitles, download_subtitle_file

logger = logging.getLogger(__name__)

# 完成的下載 job 暫存：job_id -> { tmpdir, title, dtype, video_path, sub_paths, zip_path }
_job_results: dict[int, dict] = {}

# 預設管理員
ADMIN_USERNAME = "admin"
ADMIN_PASSWORD = "1qaz2wsx"
ADMIN_EMAIL = "admin@localhost"


def _seed_admin(db: Session) -> None:
    if db.query(User).filter(User.username == ADMIN_USERNAME).first():
        return
    admin = User(
        email=ADMIN_EMAIL,
        username=ADMIN_USERNAME,
        hashed_password=get_password_hash(ADMIN_PASSWORD),
        is_admin=True,
    )
    db.add(admin)
    db.commit()
    logger.info("預設管理員已建立: id=admin, password=%s", ADMIN_PASSWORD)


def _migrate_add_is_admin():
    """若舊資料庫沒有 is_admin 欄位則新增。"""
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            r = conn.execute(text("PRAGMA table_info(users)"))
            cols = [row[1] for row in r]
            if "is_admin" not in cols:
                conn.execute(text("ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0"))
                conn.commit()
        except Exception:
            pass


def _migrate_download_log_og():
    """若 download_logs 沒有 og_title / og_description 則新增。"""
    from sqlalchemy import text
    with engine.connect() as conn:
        try:
            r = conn.execute(text("PRAGMA table_info(download_logs)"))
            cols = [row[1] for row in r]
            if "og_title" not in cols:
                conn.execute(text("ALTER TABLE download_logs ADD COLUMN og_title VARCHAR(500)"))
            if "og_description" not in cols:
                conn.execute(text("ALTER TABLE download_logs ADD COLUMN og_description TEXT"))
            conn.commit()
        except Exception:
            pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate_add_is_admin()
    _migrate_download_log_og()
    db = SessionLocal()
    try:
        _seed_admin(db)
    finally:
        db.close()
    yield
    # 關閉時清理暫存
    for data in _job_results.values():
        tmpdir = data.get("tmpdir")
        if tmpdir and Path(tmpdir).exists():
            shutil.rmtree(tmpdir, ignore_errors=True)
    _job_results.clear()


app = FastAPI(title="Stream Downloader API", lifespan=lifespan)

_default_origins = [
    "http://localhost:5173", "http://127.0.0.1:5173",
    "http://localhost:3000", "http://127.0.0.1:3000",
]
_cors_origins = os.getenv("CORS_ORIGINS")
if _cors_origins:
    _default_origins = [s.strip() for s in _cors_origins.split(",") if s.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_default_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="請先登入",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="登入已過期或無效",
        )
    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise HTTPException(status_code=401, detail="使用者不存在")
    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="需要管理員權限")
    return current_user


api = APIRouter(prefix="/api", tags=["api"])


def _cleanup_tmpdir(tmpdir: Path) -> None:
    if tmpdir.exists():
        shutil.rmtree(tmpdir, ignore_errors=True)


@api.post("/register", response_model=Token)
def register(data: UserCreate, db: Session = Depends(get_db)):
    if db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=400, detail="此信箱已被註冊")
    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=400, detail="此使用者名稱已被使用")
    user = User(
        email=data.email,
        username=data.username,
        hashed_password=get_password_hash(data.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token)


@api.post("/login", response_model=Token)
def login(data: UserLogin, db: Session = Depends(get_db)):
    # 支援以 email 或 username 登入（管理員 id: admin）
    if "@" in data.email:
        user = db.query(User).filter(User.email == data.email).first()
    else:
        user = db.query(User).filter(User.username == data.email).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="帳號或密碼錯誤")
    token = create_access_token({"sub": str(user.id)})
    return Token(access_token=token)


def _run_download_job(job_id: int, url: str, dtype: str, user_id: int) -> None:
    db = SessionLocal()
    try:
        log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
        if not log or log.status != "pending":
            return
        log.status = "downloading"
        log.progress = 0
        log.message = "準備下載…"
        db.commit()

        def progress_cb(percent: int, message: str) -> None:
            log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
            if log:
                log.progress = min(100, percent)
                log.message = message
                db.commit()

        try:
            tmpdir, title, video_path, sub_paths, og_title, og_description = download_video_with_subs(
                url,
                merge_format="mkv",
                progress_callback=progress_cb,
            )
        except Exception as e:
            logger.exception("下載失敗 job_id=%s: %s", job_id, e)
            log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
            if log:
                log.status = "error"
                log.message = str(e)
                log.completed_at = datetime.utcnow()
                db.commit()
            return

        # 依 dtype 準備回傳檔
        result_data = {"tmpdir": tmpdir, "title": title, "dtype": dtype}
        if dtype == "video":
            if video_path and video_path.exists():
                result_data["video_path"] = video_path
                result_data["filename"] = f"{title}{video_path.suffix}"
            else:
                log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
                if log:
                    log.status = "error"
                    log.message = "未取得影片檔"
                    log.completed_at = datetime.utcnow()
                    db.commit()
                return
        elif dtype == "subs":
            if sub_paths:
                if len(sub_paths) == 1:
                    result_data["file_path"] = sub_paths[0]
                    result_data["filename"] = sub_paths[0].name
                else:
                    zip_path = tmpdir / f"{title}_subtitles.zip"
                    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                        for p in sub_paths:
                            zf.write(p, p.name)
                    result_data["file_path"] = zip_path
                    result_data["filename"] = zip_path.name
            else:
                log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
                if log:
                    log.status = "error"
                    log.message = "未取得字幕檔"
                    log.completed_at = datetime.utcnow()
                    db.commit()
                return
        else:
            # both
            zip_path = tmpdir / f"{title}.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for f in tmpdir.iterdir():
                    if f.is_file() and f != zip_path:
                        zf.write(f, f.name)
            result_data["file_path"] = zip_path
            result_data["filename"] = zip_path.name

        _job_results[job_id] = result_data
        log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
        if log:
            log.status = "done"
            log.progress = 100
            log.message = "完成"
            log.title = title
            if og_title is not None:
                log.og_title = og_title
            if og_description is not None:
                log.og_description = og_description
            log.completed_at = datetime.utcnow()
            db.commit()
    finally:
        db.close()


@api.post("/download", response_model=DownloadJobResponse)
def download_start(
    body: DownloadRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not body.url or not body.url.strip():
        raise HTTPException(status_code=400, detail="請提供影片網址")
    dtype = (body.download_type or "video").strip().lower()
    if dtype not in ("video", "subs", "both"):
        raise HTTPException(status_code=400, detail="download_type 須為 video、subs 或 both")

    log = DownloadLog(
        user_id=current_user.id,
        url=body.url.strip(),
        status="pending",
        progress=0,
        message="排隊中…",
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    job_id = log.id
    background_tasks.add_task(_run_download_job, job_id, body.url.strip(), dtype, current_user.id)
    return DownloadJobResponse(job_id=job_id)


@api.get("/download/status/{job_id}", response_model=DownloadStatusResponse)
def download_status(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="找不到此下載任務")
    if log.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="無權限查看此任務")
    return DownloadStatusResponse(
        job_id=log.id,
        status=log.status,
        progress=log.progress or 0,
        message=log.message,
        title=log.title,
    )


@api.get("/downloads/history", response_model=DownloadHistoryResponse)
def downloads_history(
    page: int = 1,
    limit: int = 10,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """當前帳號下載紀錄，由新到舊，分頁每頁 limit 筆。"""
    if page < 1:
        page = 1
    if limit < 1 or limit > 50:
        limit = 10
    offset = (page - 1) * limit
    q = db.query(DownloadLog).filter(
        DownloadLog.user_id == current_user.id,
    ).order_by(DownloadLog.created_at.desc())
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    items = [
        DownloadHistoryItem(
            id=r.id,
            url=r.url,
            title=r.og_title or r.title,
            og_description=r.og_description,
            status=r.status,
            created_at=r.created_at,
        )
        for r in rows
    ]
    return DownloadHistoryResponse(items=items, total=total, page=page, limit=limit)


@api.get("/me", response_model=UserInfo)
def me(current_user: User = Depends(get_current_user)):
    return UserInfo(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        is_admin=bool(current_user.is_admin),
        created_at=current_user.created_at,
    )


@api.get("/download/result/{job_id}")
def download_result(
    job_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log = db.query(DownloadLog).filter(DownloadLog.id == job_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="找不到此下載任務")
    if log.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="無權限")
    if log.status != "done":
        raise HTTPException(status_code=400, detail="下載尚未完成或失敗")
    data = _job_results.get(job_id)
    if not data:
        raise HTTPException(status_code=404, detail="檔案已過期，請重新下載")
    tmpdir = data.get("tmpdir")
    filename = data.get("filename", "download")
    if data.get("video_path"):
        path = data["video_path"]
        media_type = "application/octet-stream"
    else:
        path = data.get("file_path")
        if not path or not Path(path).exists():
            raise HTTPException(status_code=404, detail="檔案不存在")
        path = Path(path)
        media_type = "application/zip" if path.suffix == ".zip" else "application/x-subrip"
    response = FileResponse(
        path=str(path),
        filename=filename,
        media_type=media_type,
    )
    return response


# ---------- 字幕搜尋（依檔名） ----------
@api.get("/subs/search")
def subs_search(
    q: str = "",
    lang: str = "zht",
    current_user: User = Depends(get_current_user),
):
    """依檔名/片名搜尋字幕，列出符合的結果供預覽。"""
    query = (q or "").strip()
    if not query:
        return {"data": []}
    items = search_subtitles(query, lang=lang)
    return {"data": items}


@api.get("/subs/download")
def subs_download(
    file_id: int | None = None,
    download_url: str | None = None,
    source: str = "opensubtitles",
    page_url: str | None = None,
    lang: str = "zht",
    current_user: User = Depends(get_current_user),
):
    """下載單一字幕檔到本地（由瀏覽器儲存）。支援 OpenSubtitles 與 Subtitle Cat。"""
    if source == "subtitlecat":
        if not page_url:
            raise HTTPException(status_code=400, detail="Subtitle Cat 下載請提供 page_url")
        content, filename = download_subtitle_file(
            source=source, page_url=page_url, lang=lang
        )
    else:
        if file_id is None and not download_url:
            raise HTTPException(status_code=400, detail="請提供 file_id 或 download_url")
        content, filename = download_subtitle_file(file_id=file_id, download_url=download_url)
    if content is None:
        raise HTTPException(
            status_code=502,
            detail="無法取得字幕檔（OpenSubtitles 請確認 OPENSUBTITLES_API_KEY；Subtitle Cat 請確認該頁有該語言）",
        )
    return Response(
        content=content,
        media_type="application/x-subrip",
        headers={"Content-Disposition": f'attachment; filename="{filename or "subtitle.srt"}"'},
    )


# ---------- Dashboard (Admin) ----------
@api.get("/admin/users", response_model=list[UserInfo])
def admin_list_users(
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    users = db.query(User).order_by(User.id).all()
    return [
        UserInfo(
            id=u.id,
            email=u.email,
            username=u.username,
            is_admin=bool(u.is_admin),
            created_at=u.created_at,
        )
        for u in users
    ]


@api.get("/admin/downloads", response_model=list[DownloadLogInfo])
def admin_list_downloads(
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(DownloadLog, User.username)
        .join(User, DownloadLog.user_id == User.id)
        .order_by(DownloadLog.id.desc())
        .limit(500)
        .all()
    )
    return [
        DownloadLogInfo(
            id=log.id,
            user_id=log.user_id,
            username=username,
            url=log.url,
            title=log.title,
            og_title=getattr(log, "og_title", None),
            og_description=getattr(log, "og_description", None),
            status=log.status,
            progress=log.progress or 0,
            message=log.message,
            created_at=log.created_at,
            completed_at=log.completed_at,
        )
        for log, username in rows
    ]


@api.patch("/admin/users/{user_id}", response_model=UserInfo)
def admin_update_user(
    user_id: int,
    body: UserUpdate,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")
    if body.username is not None:
        if db.query(User).filter(User.username == body.username, User.id != user_id).first():
            raise HTTPException(status_code=400, detail="此使用者名稱已被使用")
        user.username = body.username
    if body.email is not None:
        if db.query(User).filter(User.email == body.email, User.id != user_id).first():
            raise HTTPException(status_code=400, detail="此信箱已被使用")
        user.email = body.email
    if body.password is not None:
        user.hashed_password = get_password_hash(body.password)
    if body.is_admin is not None:
        user.is_admin = body.is_admin
    db.commit()
    db.refresh(user)
    return UserInfo(
        id=user.id,
        email=user.email,
        username=user.username,
        is_admin=bool(user.is_admin),
        created_at=user.created_at,
    )


@api.post("/admin/users", response_model=UserInfo)
def admin_create_user(
    body: UserCreate,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=400, detail="此信箱已被註冊")
    if db.query(User).filter(User.username == body.username).first():
        raise HTTPException(status_code=400, detail="此使用者名稱已被使用")
    user = User(
        email=body.email,
        username=body.username,
        hashed_password=get_password_hash(body.password),
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return UserInfo(
        id=user.id,
        email=user.email,
        username=user.username,
        is_admin=bool(user.is_admin),
        created_at=user.created_at,
    )


@api.delete("/admin/users/{user_id}")
def admin_delete_user(
    user_id: int,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    if user_id == current_user.id:
        raise HTTPException(status_code=400, detail="無法刪除自己")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")
    if user.username == ADMIN_USERNAME:
        raise HTTPException(status_code=400, detail="admin 不可以刪除")
    db.delete(user)
    db.commit()
    return {"ok": True}


@api.post("/admin/downloads/{log_id}/fetch-og")
def admin_fetch_og_from_url(
    log_id: int,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """從該筆下載的 URL 取得 og:title、og:description 並寫入紀錄。"""
    log = db.query(DownloadLog).filter(DownloadLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="下載紀錄不存在")
    og_title, og_description = fetch_og_meta_from_url(log.url)
    log.og_title = og_title
    log.og_description = og_description
    db.commit()
    db.refresh(log)
    return {"og_title": log.og_title, "og_description": log.og_description or ""}


@api.patch("/admin/downloads/{log_id}", response_model=DownloadLogInfo)
def admin_update_download(
    log_id: int,
    body: DownloadLogUpdate,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    log = db.query(DownloadLog).filter(DownloadLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="下載紀錄不存在")
    if body.title is not None:
        log.title = body.title
    if body.og_title is not None:
        log.og_title = body.og_title
    if body.og_description is not None:
        log.og_description = body.og_description
    db.commit()
    db.refresh(log)
    username = db.query(User).filter(User.id == log.user_id).first()
    return DownloadLogInfo(
        id=log.id,
        user_id=log.user_id,
        username=username.username if username else "",
        url=log.url,
        title=log.title,
        og_title=getattr(log, "og_title", None),
        og_description=getattr(log, "og_description", None),
        status=log.status,
        progress=log.progress or 0,
        message=log.message,
        created_at=log.created_at,
        completed_at=log.completed_at,
    )


@api.delete("/admin/downloads/{log_id}")
def admin_delete_download(
    log_id: int,
    current_user: User = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """刪除一筆下載紀錄。"""
    log = db.query(DownloadLog).filter(DownloadLog.id == log_id).first()
    if not log:
        raise HTTPException(status_code=404, detail="下載紀錄不存在")
    db.delete(log)
    db.commit()
    return {"ok": True}


app.include_router(api)


@app.get("/")
def root():
    return {
        "message": "Stream Downloader API",
        "docs": "/docs",
        "api": "/api",
    }
