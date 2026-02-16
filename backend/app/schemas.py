from datetime import datetime
from pydantic import BaseModel, EmailStr


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str


class UserLogin(BaseModel):
    email: str  # 可為 email 或 username（管理員 id: admin）
    password: str


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class DownloadRequest(BaseModel):
    url: str
    download_type: str = "video"  # "video" | "subs" | "both"


class DownloadJobResponse(BaseModel):
    job_id: int


class DownloadStatusResponse(BaseModel):
    job_id: int
    status: str
    progress: int
    message: str | None
    title: str | None


# Dashboard
class UserInfo(BaseModel):
    id: int
    email: str
    username: str
    is_admin: bool
    created_at: datetime


class DownloadLogInfo(BaseModel):
    id: int
    user_id: int
    username: str
    url: str
    title: str | None
    og_title: str | None = None
    og_description: str | None = None
    status: str
    progress: int
    message: str | None
    created_at: datetime
    completed_at: datetime | None


class UserUpdate(BaseModel):
    username: str | None = None
    email: str | None = None
    password: str | None = None
    is_admin: bool | None = None


class DownloadLogUpdate(BaseModel):
    title: str | None = None
    og_title: str | None = None
    og_description: str | None = None


class DownloadHistoryItem(BaseModel):
    id: int
    url: str
    title: str | None  # 標題（og_title 或 title）
    og_description: str | None = None  # 描述
    status: str
    created_at: datetime


class DownloadHistoryResponse(BaseModel):
    items: list[DownloadHistoryItem]
    total: int
    page: int
    limit: int
