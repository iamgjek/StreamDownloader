"""
字幕搜尋：依檔名/片名查詢，並可下載 .srt。
來源：OpenSubtitles REST API（需設定 OPENSUBTITLES_API_KEY）、Subtitle Cat（https://www.subtitlecat.com/）、
Subtitle Nexus（https://subtitlenexus.com/zh-tw/products/user-subtitles/，提供搜尋入口）、
AVSubtitles（https://www.avsubtitles.com/search）。
"""
import io
import logging
import os
import re
import zipfile
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ---------- OpenSubtitles ----------
BASE_URL = "https://api.opensubtitles.com/api/v1"
API_KEY = os.environ.get("OPENSUBTITLES_API_KEY")
HEADERS = {
    "Api-Key": API_KEY or "",
    "User-Agent": "StreamDownloader/1.0",
    "Accept": "application/json",
}

# ---------- Subtitle Cat ----------
SUBTITLECAT_BASE = "https://www.subtitlecat.com"
SUBTITLECAT_SEARCH = "https://www.subtitlecat.com/index.php"
# 請求時使用一般瀏覽器 User-Agent，避免被擋
SUBTITLECAT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}

# 字幕僅支援 zh-TW（繁中）、zh-CN（簡中）
# 介面語言代碼 -> Subtitle Cat 網址中的語言後綴（-zh-TW.srt, -zh-CN.srt）
LANG_TO_SUFFIX = {
    "zht": ["zh-TW", "zh-tw", "zht", "cht"],
    "zhs": ["zh-CN", "zh-cn", "zhs"],
}
# 允許的語言（僅此兩種）
SUPPORTED_SUBTITLE_LANGS = ("zht", "zhs")

# ---------- Subtitle Nexus ----------
SUBTITLENEXUS_SEARCH_TW = "https://subtitlenexus.com/zh-tw/products/user-subtitles/"
SUBTITLENEXUS_SEARCH_CN = "https://subtitlenexus.com/zh-cn/products/user-subtitles/"

# ---------- AVSubtitles ----------
AVSUBTITLES_BASE = "https://www.avsubtitles.com"
AVSUBTITLES_SEARCH = "https://www.avsubtitles.com/search_results.php"
AVSUBTITLES_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-TW,zh;q=0.9,en;q=0.5",
}
AVSUBTITLES_MOVIE_LINK_RE = re.compile(
    r'href=["\']?(/movie\d+/[^"\'>\s/]+)["\']?',
    re.I,
)
AVSUBTITLES_ZH_SUB_RE = re.compile(
    r'href=["\']?(/movie\d+/[^"\']+/subtitles/zh/(\d+))["\']?',
    re.I,
)
AVSUBTITLES_MOVIE_TITLE_RE = re.compile(r"<title>\s*Subtitles for\s+(.+?)\s*</title>", re.I | re.S)
ZHT_LANG_MARKERS = ("zht", "zh-tw", "zh_tw", "cht", "traditional", "繁")
ZHS_LANG_MARKERS = ("zhs", "zh-cn", "zh_cn", "simplified", "简体", "簡")


def _query_from_filename(filename: str) -> str:
    """從影片檔名推測搜尋關鍵字（去掉副檔名與常見解析度等）。"""
    name = filename
    if "." in name:
        name = name.rsplit(".", 1)[0]
    name = re.sub(r"\s*\d{4}\s*", " ", name)
    name = re.sub(r"\s*(720p|1080p|2160p|4k|bluray|webrip|web-dl|hdtv)\s*", " ", name, flags=re.I)
    name = re.sub(r"[._-]+", " ", name).strip()
    return name[:100] if name else filename


def _lang_label(lang: str) -> str:
    return "簡中" if _normalize_subtitle_lang(lang) == "zhs" else "繁中"


def _matches_requested_chinese_lang(language_text: str | None, lang: str) -> bool:
    """判斷 OpenSubtitles 等來源回傳的語言欄位是否符合繁中/簡中要求。"""
    if not language_text:
        return True
    s = language_text.strip().lower()
    if _normalize_subtitle_lang(lang) == "zhs":
        if any(m in s for m in ZHS_LANG_MARKERS):
            return True
        return s in ("zh", "chinese", "zho", "cn") and "trad" not in s and "tw" not in s
    if any(m in s for m in ZHT_LANG_MARKERS):
        return True
    return s in ("zh", "chinese", "zho", "tw") and "simp" not in s and "cn" not in s


def _subtitlecat_collect_srt_links(html: str) -> list[str]:
    srt_links = re.findall(
        r'href=["\']?(https?://[^"\'\s>]+?\.srt(?:\?[^"\'\s>]*)?)["\']?',
        html,
        re.I,
    )
    if not srt_links:
        srt_links = re.findall(
            r'href=["\']?((?:/?subs/[^"\'\s>]+?)\.srt(?:\?[^"\'\s>]*)?)["\']?',
            html,
            re.I,
        )
        srt_links = [
            (url if url.startswith("http") else f"{SUBTITLECAT_BASE}/{url.lstrip('/')}")
            for url in srt_links
        ]
    return list(dict.fromkeys(srt_links))


def _subtitlecat_pick_lang_srt_url(html: str, lang: str) -> str | None:
    candidates = LANG_TO_SUFFIX.get(_normalize_subtitle_lang(lang), [lang])
    for url in _subtitlecat_collect_srt_links(html):
        url_lower = url.lower()
        for suf in candidates:
            suffix = suf.lower()
            if f"-{suffix}.srt" in url_lower or f"-{suffix}?" in url_lower:
                return url
    return None


# ---------- OpenSubtitles ----------
def search_opensubtitles(query: str, lang: str = "zht") -> list[dict[str, Any]]:
    """依關鍵字搜尋 OpenSubtitles，回傳列表（每項含 source='opensubtitles'）。"""
    if not API_KEY or not query or not query.strip():
        return []
    q = query.strip()
    if not q and len(query) > 2:
        q = _query_from_filename(query)
    params = {"query": q, "languages": lang}
    try:
        r = requests.get(
            f"{BASE_URL}/subtitles",
            headers=HEADERS,
            params=params,
            timeout=15,
        )
        if r.status_code != 200:
            return []
        data = r.json()
        items = data.get("data", []) if isinstance(data, dict) else []
        result = []
        for it in items[:30]:
            att = it.get("attributes", {}) or {}
            files = att.get("files", []) or []
            f = files[0] if files else {}
            file_id = f.get("file_id") or it.get("file_id")
            language = att.get("language", "") or it.get("language", "")
            if not _matches_requested_chinese_lang(language, lang):
                continue
            result.append({
                "source": "opensubtitles",
                "id": it.get("id"),
                "file_id": file_id,
                "release": att.get("release", "") or it.get("release", ""),
                "language": _lang_label(lang),
                "download_url": att.get("url") or f.get("url"),
                "file_name": f.get("file_name", ""),
            })
        return result
    except Exception:
        return []


def download_opensubtitles(file_id: int | str | None, download_url: str | None) -> tuple[bytes | None, str | None]:
    """下載 OpenSubtitles 單一字幕檔。回傳 (content, suggested_filename) 或 (None, None)。"""
    if not API_KEY:
        return None, None
    try:
        if download_url:
            r = requests.get(download_url, headers={**HEADERS, "Accept": "*/*"}, timeout=30)
            if r.status_code == 200:
                name = download_url.split("/")[-1].split("?")[0] or "subtitle.srt"
                return r.content, name
        if file_id is not None:
            r = requests.post(
                f"{BASE_URL}/download",
                headers={**HEADERS, "Content-Type": "application/json"},
                json={"file_id": int(file_id) if isinstance(file_id, str) and file_id.isdigit() else file_id},
                timeout=30,
            )
            if r.status_code == 200:
                data = r.json()
                link = data.get("link") if isinstance(data, dict) else None
                if link:
                    r2 = requests.get(link, timeout=30)
                    if r2.status_code == 200:
                        fname = (data.get("filename") or "subtitle.srt").strip()
                        return r2.content, fname
    except Exception:
        pass
    return None, None


# ---------- Subtitle Cat ----------
def search_subtitlecat(query: str, lang: str = "zht") -> list[dict[str, Any]]:
    """依關鍵字搜尋 Subtitle Cat，僅回傳含繁中/簡中 .srt 的結果。"""
    if not query or not query.strip():
        return []
    lang = _normalize_subtitle_lang(lang)
    q = _query_from_filename(query.strip()) if query.strip() else query.strip()
    params = {"search": q.replace(" ", "+")}
    result = []
    try:
        r = requests.get(SUBTITLECAT_SEARCH, headers=SUBTITLECAT_HEADERS, params=params, timeout=15)
        if r.status_code != 200:
            return []
        html = r.text
        # 搜尋結果頁：連結格式 /subs/數字/標題.html 或 href="subs/422/Title.html"
        pattern = re.compile(
            r'href=["\']?(?:https?://www\.subtitlecat\.com/)?(subs/\d+/[^"\'>\s]+\.html)["\']?[^>]*>([^<]+)',
            re.I,
        )
        seen = set()
        for m in pattern.finditer(html):
            path = m.group(1).strip()
            title = re.sub(r"\s+", " ", m.group(2).strip())
            if not title or title.lower() in ("download", "translate", "👍", "👎"):
                continue
            full_url = path if path.startswith("http") else f"{SUBTITLECAT_BASE}/{path}"
            if full_url in seen:
                continue
            seen.add(full_url)
            # 過濾明顯非字幕標題的連結
            if len(title) < 2 or "subtitlecat" in title.lower():
                continue
            result.append({
                "source": "subtitlecat",
                "id": f"subtitlecat-{path}",
                "page_url": full_url,
                "release": title,
                "language": _lang_label(lang),
                "file_name": (title[:80] + ".srt") if len(title) > 80 else f"{title}.srt",
            })
    except Exception:
        pass

    filtered: list[dict[str, Any]] = []
    for item in result:
        try:
            page_r = requests.get(item["page_url"], headers=SUBTITLECAT_HEADERS, timeout=12)
            if page_r.status_code != 200:
                continue
            if not _subtitlecat_pick_lang_srt_url(page_r.text, lang):
                continue
            filtered.append(item)
            if len(filtered) >= 30:
                break
        except Exception:
            continue
    return filtered


def download_subtitlecat(page_url: str, lang: str = "zht") -> tuple[bytes | None, str | None]:
    """
    從 Subtitle Cat 字幕頁下載指定語言的 .srt。
    僅支援 zh-TW（繁中）、zh-CN（簡中）；會抓取該頁 HTML 找出對應語言的 .srt 連結再下載。
    """
    if not page_url or "subtitlecat.com" not in page_url:
        return None, None
    if lang not in SUPPORTED_SUBTITLE_LANGS:
        lang = "zht"
    try:
        r = requests.get(page_url, headers=SUBTITLECAT_HEADERS, timeout=15)
        if r.status_code != 200:
            logger.info("subtitlecat page %s returned status %s", page_url[:80], r.status_code)
            return None, None
        html = r.text
        download_url = _subtitlecat_pick_lang_srt_url(html, lang)
        if not download_url:
            srt_count = len(_subtitlecat_collect_srt_links(html))
            logger.info(
                "subtitlecat no %s .srt link on page (found %d .srt links)",
                lang,
                srt_count,
            )
        if not download_url:
            return None, None
        r2 = requests.get(download_url, headers=SUBTITLECAT_HEADERS, timeout=30)
        if r2.status_code != 200:
            logger.info("subtitlecat srt download %s returned %s", download_url[:80], r2.status_code)
            return None, None
        name = download_url.split("/")[-1].split("?")[0] or "subtitle.srt"
        return r2.content, name
    except Exception as e:
        logger.warning("subtitlecat download_subtitlecat error: %s", e, exc_info=True)
    return None, None


def search_subtitlenexus(query: str, lang: str = "zht") -> list[dict[str, Any]]:
    """
    Subtitle Nexus 目前會阻擋伺服器端機器人存取（Cloudflare challenge），
    因此此處提供「搜尋入口」結果，讓前端可一鍵開啟來源網站進行人工下載。
    """
    q = (query or "").strip()
    if not q:
        return []
    base = SUBTITLENEXUS_SEARCH_CN if _normalize_subtitle_lang(lang) == "zhs" else SUBTITLENEXUS_SEARCH_TW
    lang_param = "zh" if _normalize_subtitle_lang(lang) == "zhs" else "zh-tw"
    keyword = requests.utils.quote(_query_from_filename(q))
    page_url = f"{base}?language={lang_param}&s={keyword}"
    return [{
        "source": "subtitlenexus",
        "id": f"subtitlenexus-{abs(hash(page_url))}",
        "page_url": page_url,
        "release": f"Subtitle Nexus：{q}",
        "language": _lang_label(lang),
        "file_name": "subtitle.srt",
    }]


# ---------- AVSubtitles ----------
def _avsubtitles_movie_title(html: str, fallback: str) -> str:
    m = AVSUBTITLES_MOVIE_TITLE_RE.search(html)
    if m:
        title = re.sub(r"\s+", " ", m.group(1).strip())
        if title:
            return title[:160]
    return fallback


def _avsubtitles_parse_movie_zh_subs(html: str, movie_path: str, lang: str) -> list[dict[str, Any]]:
    movie_title = _avsubtitles_movie_title(html, movie_path.rsplit("/", 1)[-1])
    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for m in AVSUBTITLES_ZH_SUB_RE.finditer(html):
        sub_path, subid = m.group(1), m.group(2)
        if sub_path in seen:
            continue
        seen.add(sub_path)
        page_url = f"{AVSUBTITLES_BASE}{sub_path}"
        items.append({
            "source": "avsubtitles",
            "id": f"avsubtitles-{subid}",
            "page_url": page_url,
            "release": movie_title,
            "language": _lang_label(lang),
            "file_name": f"{movie_title[:80]}.srt" if len(movie_title) > 80 else f"{movie_title}.srt",
        })
    return items


def search_avsubtitles(query: str, lang: str = "zht") -> list[dict[str, Any]]:
    """搜尋 AVSubtitles，僅回傳含中文（zh）字幕的項目。"""
    q = (query or "").strip()
    if not q:
        return []
    lang = _normalize_subtitle_lang(lang)
    q = _query_from_filename(q)
    result: list[dict[str, Any]] = []
    try:
        r = requests.get(
            AVSUBTITLES_SEARCH,
            headers=AVSUBTITLES_HEADERS,
            params={"search": q},
            timeout=15,
        )
        if r.status_code != 200:
            return []
        movie_paths: list[str] = []
        seen_movies: set[str] = set()
        for m in AVSUBTITLES_MOVIE_LINK_RE.finditer(r.text):
            path = m.group(1).strip()
            if "/subtitles/" in path or path in seen_movies:
                continue
            seen_movies.add(path)
            movie_paths.append(path)
            if len(movie_paths) >= 10:
                break

        for movie_path in movie_paths:
            movie_url = f"{AVSUBTITLES_BASE}{movie_path}"
            try:
                movie_r = requests.get(movie_url, headers=AVSUBTITLES_HEADERS, timeout=12)
                if movie_r.status_code != 200:
                    continue
                items = _avsubtitles_parse_movie_zh_subs(movie_r.text, movie_path, lang)
                result.extend(items)
                if len(result) >= 30:
                    break
            except Exception:
                continue
    except Exception as e:
        logger.warning("avsubtitles search error: %s", e, exc_info=True)
    return result[:30]


def download_avsubtitles(page_url: str, _lang: str = "zht") -> tuple[bytes | None, str | None]:
    """從 AVSubtitles 字幕頁下載 .srt（網站可能回傳 zip 壓縮檔）。"""
    if not page_url or "avsubtitles.com" not in page_url:
        return None, None
    try:
        session = requests.Session()
        session.headers.update(AVSUBTITLES_HEADERS)
        page_r = session.get(page_url, timeout=15)
        if page_r.status_code != 200:
            return None, None
        subid_m = re.search(r'name=["\']subid["\']\s+value=["\'](\d+)["\']', page_r.text, re.I)
        revid_m = re.search(r'name=["\']revid["\']\s+value=["\'](\d+)["\']', page_r.text, re.I)
        if not subid_m or not revid_m:
            return None, None
        subid, revid = subid_m.group(1), revid_m.group(1)
        dl_page = f"{AVSUBTITLES_BASE}/download_page.php"
        dl_page_r = session.get(
            dl_page,
            params={"subid": subid, "revid": revid},
            headers={"Referer": page_url},
            timeout=15,
        )
        if dl_page_r.status_code != 200:
            return None, None
        dl_link_m = re.search(
            r'href=["\']([^"\']*download_sub\.php\?[^"\']+)["\']',
            dl_page_r.text,
            re.I,
        )
        if not dl_link_m:
            return None, None
        dl_href = dl_link_m.group(1)
        dl_url = dl_href if dl_href.startswith("http") else f"{AVSUBTITLES_BASE}/{dl_href.lstrip('./')}"
        file_r = session.get(
            dl_url,
            headers={"Referer": f"{dl_page}?subid={subid}&revid={revid}"},
            timeout=30,
        )
        if file_r.status_code != 200 or not file_r.content:
            return None, None
        content = file_r.content
        if content[:2] == b"PK":
            with zipfile.ZipFile(io.BytesIO(content)) as zf:
                for name in zf.namelist():
                    if name.lower().endswith(".srt"):
                        return zf.read(name), os.path.basename(name)
            return None, None
        if b"-->" in content[:800]:
            fname = dl_url.split("/")[-1].split("?")[0]
            if not fname.lower().endswith(".srt"):
                fname = "subtitle.srt"
            return content, fname
    except Exception as e:
        logger.warning("avsubtitles download error: %s", e, exc_info=True)
    return None, None


# ---------- 統一介面（向後相容） ----------
def _normalize_subtitle_lang(lang: str) -> str:
    """僅支援 zh-TW(zht)、zh-CN(zhs)，其餘視為 zht。"""
    if not lang:
        return "zht"
    lang = lang.strip().lower()
    if lang in ("zhs", "zh-cn", "zh_cn"):
        return "zhs"
    return "zht"


def search_subtitles(query: str, lang: str = "zht") -> list[dict[str, Any]]:
    """
    依關鍵字搜尋字幕，合併 OpenSubtitles、Subtitle Cat、Subtitle Nexus 與 AVSubtitles 結果。
    僅支援繁中(zht)、簡中(zhs)。每項含 source；含 page_url 的來源可直接或導向下載。
    """
    combined: list[dict[str, Any]] = []
    lang = _normalize_subtitle_lang(lang)
    q = (query or "").strip()
    if not q and len((query or "")) > 2:
        q = _query_from_filename(query)
    if not q:
        return []

    opensub = search_opensubtitles(q, lang)
    for it in opensub:
        it.setdefault("source", "opensubtitles")
        combined.append(it)

    subtitlecat = search_subtitlecat(q, lang)
    for it in subtitlecat:
        it.setdefault("source", "subtitlecat")
        combined.append(it)

    subtitlenexus = search_subtitlenexus(q, lang)
    for it in subtitlenexus:
        it.setdefault("source", "subtitlenexus")
        combined.append(it)

    avsubtitles = search_avsubtitles(q, lang)
    for it in avsubtitles:
        it.setdefault("source", "avsubtitles")
        combined.append(it)

    return combined


def download_subtitle_file(
    file_id: int | str | None = None,
    download_url: str | None = None,
    source: str = "opensubtitles",
    page_url: str | None = None,
    lang: str = "zht",
) -> tuple[bytes | None, str | None]:
    """
    下載單一字幕檔。回傳 (content, suggested_filename) 或 (None, None)。
    - source=opensubtitles：使用 file_id 或 download_url（與原行為相同）。
    - source=subtitlecat：使用 page_url + lang 至 Subtitle Cat 抓頁再下載對應語言 .srt。
    - source=avsubtitles：使用 page_url 至 AVSubtitles 抓頁再下載中文 .srt。
    """
    if source == "subtitlecat" and page_url:
        return download_subtitlecat(page_url, _normalize_subtitle_lang(lang))
    if source == "avsubtitles" and page_url:
        return download_avsubtitles(page_url, _normalize_subtitle_lang(lang))
    return download_opensubtitles(file_id, download_url)
