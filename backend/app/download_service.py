import os
import re
import zipfile
import tempfile
import gzip
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse


class DownloadCancelled(Exception):
    """使用者已取消下載。"""
    pass
from urllib.request import Request, urlopen

# 停用 yt-dlp 外掛，避免與外掛的 load_plugins() 簽名不相容導致崩潰
os.environ["YTDLP_NO_PLUGINS"] = "1"

import yt_dlp

# missav 網域（支援 .ai / .ws 等）
MISSAV_URL_RE = re.compile(r"https?://(?:www\.)?missav\.(?:ai|ws)/", re.I)

# MissAV 檔名：從 URL 取最後一段，並移除常見後綴
# 例：110625_001 => 110625_001.mkv；dm1/naac-032 => naac-032.mkv；ipzz-556-uncensored-leak => ipzz-556.mkv
MISSAV_STRIP_SUFFIXES = ("-uncensored-leak", "-uncensored", "-leak")


def _origin_from_url(url: str) -> str:
    """從網址取得 origin（scheme + netloc）作為 Referer/Origin 用"""
    p = urlparse(url)
    if p.scheme and p.netloc:
        return f"{p.scheme}://{p.netloc}"
    return ""


def _is_missav_url(url: str) -> bool:
    return bool(MISSAV_URL_RE.match(url.strip()))


def _missav_filename_from_url(url: str) -> str:
    """
    MissAV 檔名命名規則：
    - https://missav.ai/110625_001 => 110625_001
    - https://missav.ai/dm1/naac-032 => naac-032
    - https://missav.ai/ipzz-556-uncensored-leak => ipzz-556
    """
    p = urlparse(url.strip())
    path = (p.path or "").strip("/")
    if not path:
        return "video"
    segment = path.split("/")[-1]
    for suffix in MISSAV_STRIP_SUFFIXES:
        if segment.endswith(suffix):
            segment = segment[: -len(suffix)].rstrip("-")
            break
    return sanitize_filename(segment) or "video"


def _fetch_missav_page(url: str, headers: dict) -> str:
    """取得 missav 頁面 HTML（處理 gzip / brotli）。"""
    req = Request(url, headers=headers)
    with urlopen(req, timeout=30) as resp:
        raw = resp.read()
        ce = resp.headers.get("Content-Encoding", "").strip().lower()
        if ce == "gzip":
            raw = gzip.decompress(raw)
        elif ce == "br":
            try:
                import brotli
                raw = brotli.decompress(raw)
            except Exception:
                pass  # 若未安裝 brotli 則略過，可能得到亂碼
        return raw.decode("utf-8", errors="replace")


def _unpack_missav_packed_js(packed: str, dict_str: str) -> str:
    """
    解開 missav 使用的 packed JS：dict 為 pipe 分隔的陣列，
    packed 中單一字元 0-9 / a-e 會依序對應陣列索引 0-14，替換後即為原始程式碼。
    """
    parts = dict_str.split("|")
    n = len(parts)

    def repl(m: re.Match) -> str:
        c = m.group(0)
        if c.isdigit():
            i = int(c)
        elif "a" <= c <= "e":
            i = 10 + ord(c) - ord("a")
        else:
            return c
        return parts[i] if i < n else c

    # 只替換「單一」數字或 a-e（字邊界），避免替換到字串內的連續數字
    return re.sub(r"\b([0-9a-e])\b", repl, packed)

def _extract_missav_m3u8_from_packed(webpage: str) -> str | None:
    """
    從 packed eval(...) 中解析 m3u8 URL（missav.ai 新頁面格式）。
    格式：}('packed_code',15,15,'m3u8|...|source'.split('|'),0,{})
    """
    # 主正則：}( 'packed', 數字, 數字, 'dict'.split('|')
    m = re.search(
        r"\}\s*\(\s*'((?:[^'\\]|\\.)*)',\s*\d+\s*,\s*\d+\s*,\s*'([^']+(?:\|[^']+)+)'\.split\s*\(\s*'\|'\s*\)",
        webpage,
    )
    if not m:
        # 備援：找 ",數字,數字,'m3u8" 前的一段 '...\'; 即 packed
        fallback = re.search(
            r"'((?:[^'\\]|\\.)*');\s*,\s*\d+\s*,\s*\d+\s*,\s*'m3u8\|[^']*'\.split\s*\(\s*'\|'\s*\)",
            webpage,
        )
        if not fallback:
            return None
        packed = fallback.group(1)
        dict_match = re.search(
            r"'m3u8\|[^']+(?:\|[^']+)+'\.split\s*\(\s*'\|'\s*\)",
            webpage[fallback.start() :],
        )
        if not dict_match:
            return None
        dict_str = dict_match.group(0)
        dict_str = dict_str[: dict_str.find("'.split")]
        if dict_str.startswith("'"):
            dict_str = dict_str[1:]
        if "https" not in dict_str:
            return None
    else:
        packed, dict_str = m.group(1), m.group(2)

    unpacked = _unpack_missav_packed_js(packed, dict_str)
    u = re.search(r"https?://[^\s'\"<>]+\.m3u8", unpacked)
    return u.group(0) if u else None


def _extract_missav_m3u8_from_dict_only(webpage: str) -> str | None:
    """
    僅從頁面中的字典字串 'm3u8|xxx|...|source' 還原 m3u8 URL。
    格式：parts = [m3u8, 1, 2, 3, 4, 5, com, surrit, https, video, ...]，還原為
    https://surrit.com/{5-4-3-2-1}/playlist.m3u8（path 為 parts[1:6] 反序用 - 接）。
    """
    m = re.search(r"'m3u8\|([^']+(?:\|[^']+)+)'\.split\s*\(\s*'\|'\s*\)", webpage)
    if not m:
        return None
    parts = ("m3u8|" + m.group(1)).split("|")
    if "https" not in parts or "playlist" not in parts:
        return None
    try:
        idx_https = parts.index("https")
        idx_com = next((i for i, x in enumerate(parts) if x == "com"), None)
        if idx_com is None or idx_com >= idx_https or idx_https - idx_com < 2:
            return None
        # domain = surrit.com（parts 為 ... com, surrit, https ...，取 [com, surrit] 反序）
        base = ".".join(parts[idx_com : idx_https][::-1])
        # path = parts[1:6] 反序用 - 接，對應 packed 的 5-4-3-2-1
        if len(parts) >= 6:
            path = "-".join(parts[1:6][::-1])
            return f"https://{base}/{path}/playlist.m3u8"
        return None
    except (ValueError, IndexError):
        return None


def _extract_og_meta(webpage: str) -> tuple[str | None, str | None]:
    """從 HTML 擷取 og:title、og:description（通用）。"""
    og_title = None
    og_desc = None
    m = re.search(r'<meta[^>]+property=["\']og:title["\'][^>]+content=["\']([^"\']*)["\']', webpage, re.I)
    if m:
        og_title = m.group(1).strip() or None
    m = re.search(r'<meta[^>]+property=["\']og:description["\'][^>]+content=["\']([^"\']*)["\']', webpage, re.I)
    if m:
        og_desc = m.group(1).strip() or None
    return og_title, og_desc


def fetch_og_meta_from_url(url: str) -> tuple[str | None, str | None]:
    """
    從該 URL 的頁面取得 og:title、og:description。
    用於管理後台「從網址取得」標題與描述。
    """
    import requests
    origin = _origin_from_url(url)
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-TW;q=0.8",
    }
    if origin:
        headers["Referer"] = f"{origin}/"
    try:
        r = requests.get(url, headers=headers, timeout=15)
        r.raise_for_status()
        text = r.text
        if not isinstance(text, str):
            text = text.decode("utf-8", errors="replace")
        return _extract_og_meta(text)
    except Exception:
        return None, None


def _extract_missav_m3u8_and_title(webpage: str, page_url: str) -> tuple[str, str, str | None, str | None] | None:
    """
    從 missav 頁面原始碼解析 m3u8 網址與標題。
    依序嘗試：packed JS → 僅字典還原 URL → 舊版 m3u8|...|playlist|source → 頁面中任意 .m3u8（含 \/ 轉義）。
    """
    m3u8_url = None

    # 1) missav.ai 新格式：packed eval 內含 m3u8 URL
    m3u8_url = _extract_missav_m3u8_from_packed(webpage)

    # 2) 僅從字典字串組出 URL（packed 解包失敗時備援）
    if not m3u8_url:
        m3u8_url = _extract_missav_m3u8_from_dict_only(webpage)

    # 3) 舊版外掛式：m3u8|...|playlist|source
    if not m3u8_url:
        try:
            chunk = webpage.split("m3u8|")[1].split("|playlist|source")[0]
            url_words = chunk.split("|")
            if "video" in url_words:
                video_index = url_words.index("video")
                protocol = url_words[video_index - 1]
                m3u8_url_path = "-".join((url_words[0:5])[::-1])
                base_url_path = ".".join((url_words[5 : video_index - 1])[::-1])
                video_format = url_words[video_index + 1]
                m3u8_url = "{0}://{1}/{2}/{3}/{4}.m3u8".format(
                    protocol, base_url_path, m3u8_url_path, video_format, url_words[video_index]
                )
        except (IndexError, ValueError, KeyError):
            pass

    # 4) 備援：頁面中任一個 .m3u8 連結（允許 JSON 轉義 \/）
    if not m3u8_url:
        normalized = webpage.replace("\\/", "/")
        m = re.search(r'https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*', normalized)
        if m:
            m3u8_url = m.group(0).rstrip("\\").strip()

    if not m3u8_url:
        return None

    # MissAV 檔名依 URL 規則：最後路徑段，並移除 -uncensored-leak 等後綴
    title = _missav_filename_from_url(page_url)
    og_title, og_description = _extract_og_meta(webpage)
    return m3u8_url, title, og_title, og_description


def sanitize_filename(name: str) -> str:
    """移除檔名中的非法字元"""
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    return name.strip() or "video"


# 影片與字幕副檔名，用於分類
VIDEO_EXTS = {".mp4", ".mkv", ".webm", ".avi", ".mov", ".flv", ".m4a"}
SUB_EXTS = {".srt", ".vtt", ".ass", ".ssa"}


def _progress_hook_factory(callback, cancelled_check: Callable[[], bool] | None = None):
    """建立 yt-dlp progress_hook；若 cancelled_check 回傳 True 則拋出 DownloadCancelled。"""
    if not callback and not cancelled_check:
        return None

    def progress_hook(d):
        if cancelled_check and cancelled_check():
            raise DownloadCancelled()
        if callback:
            if d.get("status") == "downloading":
                if d.get("total_bytes"):
                    pct = min(100, int(d.get("downloaded_bytes", 0) * 100 / d["total_bytes"]))
                    msg = d.get("_percent_str") or f"{pct}%"
                else:
                    msg = d.get("_percent_str") or "下載中…"
                    # 無 total_bytes 時（如 HLS fragment）從 _percent_str 或 fragment 推算進度，讓 UI 與後端一致
                    pct = 0
                    percent_str = d.get("_percent_str") or ""
                    m = re.search(r"(\d+(?:\.\d+)?)\s*%", percent_str)
                    if m:
                        pct = min(100, int(float(m.group(1)) + 0.5))
                    elif d.get("fragment_count") and d.get("fragment_index") is not None:
                        fc, fi = d["fragment_count"], d["fragment_index"]
                        if fc > 0:
                            pct = min(100, int(fi * 100 / fc))
                callback(pct, msg)
            elif d.get("status") == "finished":
                callback(100, "合併檔案中…")
    return progress_hook


def _split_video_and_subs(files: list[Path]) -> tuple[Path | None, list[Path]]:
    """將檔案列表分為影片（取第一個）與字幕列表。"""
    video_path = None
    sub_paths = []
    for f in sorted(files):
        if not f.is_file():
            continue
        ext = f.suffix.lower()
        if ext in VIDEO_EXTS and video_path is None:
            video_path = f
        elif ext in SUB_EXTS:
            sub_paths.append(f)
    return video_path, sub_paths


def download_video_with_subs(
    url: str,
    *,
    merge_format: str = "mkv",
    progress_callback: Callable[[int, str], None] | None = None,
    cancelled_check: Callable[[], bool] | None = None,
) -> tuple[Path, str, Path | None, list[Path], str | None, str | None]:
    """
    下載影片與字幕，回傳 (暫存目錄, 標題, 影片路徑或 None, 字幕檔列表, og_title, og_description)。
    支援 YouTube、missav.ai（本機解析 m3u8）及多數 yt-dlp 內建網站。
    progress_callback(percent: int, message: str) 用於即時進度。
    cancelled_check() 若回傳 True 會拋出 DownloadCancelled，用於中斷下載。
    """
    tmpdir = Path(tempfile.mkdtemp())
    out_tmpl = str(tmpdir / "%(title)s.%(ext)s")
    sub_tmpl = str(tmpdir / "%(title)s.%(lang)s.%(ext)s")
    progress_hook = _progress_hook_factory(progress_callback, cancelled_check)

    # 使用完整瀏覽器標頭與 Referer，降低 403 Forbidden 機率
    origin = _origin_from_url(url)
    http_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,zh-TW;q=0.8,zh;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none" if not origin else "cross-site",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }
    if origin:
        http_headers["Referer"] = f"{origin}/"
        http_headers["Origin"] = origin

    # missav：本機解析頁面取得 m3u8 後用 yt-dlp 下載（不依賴外掛）
    if _is_missav_url(url):
        try:
            webpage = _fetch_missav_page(url, http_headers)
        except Exception as e:
            raise ValueError(f"無法載入 missav 頁面：{e}") from e
        # 除錯：寫出後端實際收到的前 5000 字元，可與瀏覽器另存的 HTML 比對
        _debug_path = Path(__file__).resolve().parent.parent / "missav_page_debug.html"
        try:
            _debug_path.write_text(webpage[:5000], encoding="utf-8")
        except Exception:
            pass
        parsed = _extract_missav_m3u8_and_title(webpage, url)
        if not parsed:
            raise ValueError("無法從 missav 頁面解析影片連結（頁面結構可能已變更）")
        m3u8_url, title, og_title, og_description = parsed
        missav_out_tmpl = str(tmpdir / f"{title}.%(ext)s")
        ydl_opts_missav = {
            "format": "best/bestvideo+bestaudio",
            "merge_output_format": merge_format,
            "outtmpl": missav_out_tmpl,
            "quiet": True,
            "no_warnings": True,
            "http_headers": http_headers,
        }
        if progress_hook:
            ydl_opts_missav["progress_hooks"] = [progress_hook]
        with yt_dlp.YoutubeDL(ydl_opts_missav) as ydl:
            ydl.download([m3u8_url])
        all_files = [f for f in tmpdir.glob("*") if f.is_file()]
        if not all_files:
            raise ValueError("未產生任何檔案")
        video_path, sub_paths = _split_video_and_subs(all_files)
        return tmpdir, title, video_path, sub_paths, og_title, og_description
    else:
        ydl_opts = {
            "format": "bestvideo+bestaudio/best",
            "merge_output_format": merge_format,
            "outtmpl": out_tmpl,
            "writesubtitles": True,
            "writeautomaticsub": True,
            "subtitleslangs": ["zh", "zh-TW", "zh-CN", "en", "en-US", "en-GB"],
            "subtitlesformat": "srt",
            "quiet": True,
            "no_warnings": True,
            "http_headers": http_headers,
        }
        # 選用：YouTube 機器人偵測時可設 YTDLP_COOKIES 指向瀏覽器匯出的 cookies.txt
        cookies_path = os.environ.get("YTDLP_COOKIES")
        if cookies_path:
            p = Path(cookies_path).expanduser().resolve()
            if p.is_file():
                ydl_opts["cookiefile"] = str(p)
        if progress_hook:
            ydl_opts["progress_hooks"] = [progress_hook]
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            if not info:
                raise ValueError("無法取得影片資訊")
            title = sanitize_filename(info.get("title") or "video")
            og_title = (info.get("title") or "").strip() or None
            og_description = (info.get("description") or "").strip() or None

    all_files = [f for f in tmpdir.glob("*") if f.is_file()]
    if not all_files:
        raise ValueError("未產生任何檔案")

    video_path, sub_paths = _split_video_and_subs(all_files)
    return tmpdir, title, video_path, sub_paths, og_title, og_description
