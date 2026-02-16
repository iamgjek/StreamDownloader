# Stream Downloader

影片在這下、字幕在這找，一站搞定。支援 MissAV、YouTube 跟一堆有的沒的～登入就能用，不用再兩邊跑。

---

## 功能概覽

| 功能 | 說明 |
|------|------|
| **會員系統** | 註冊／登入（信箱或使用者名稱），登入後方可使用下載功能 |
| **影片下載** | 貼上 URL → 選擇輸出（僅 .mkv／僅字幕／影片+字幕 ZIP）→ 即時進度 → 存至瀏覽器下載位置 |
| **字幕搜尋** | 依檔名或片名搜尋字幕（需 OpenSubtitles API Key）→ 預覽結果 → 下載到本機 |
| **管理後台** | 管理員可查看會員列表與下載紀錄（路徑：`/dashboard`） |

---

## 環境需求

- **Python** 3.10～3.12（**不建議 3.14**：部分套件可能尚未完全支援，若系統預設為 3.14，可安裝 `brew install python@3.12` 後由 `./scripts/dev.sh` 自動選用）
- **Node.js** 18+
- **ffmpeg**（選用）：下載需合併影音格式的影片時（如多數 YouTube）會用到；未安裝會出現「ffmpeg is not installed」。macOS 可 `brew install ffmpeg`。

---

## 專案結構

```
Downloader/
├── backend/          # FastAPI 後端
│   ├── app/
│   │   ├── main.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── download_service.py
│   │   └── subtitle_service.py
│   └── requirements.txt
├── frontend/         # React + Vite 前端
│   ├── src/
│   └── package.json
└── README.md
```

---

## 安裝與執行

### 一鍵啟動（推薦）

從專案根目錄執行下列腳本，會自動啟動後端（背景）與前端（前景）；按 `Ctrl+C` 會一併關閉。

```bash
./scripts/dev.sh
```

- **API**：http://127.0.0.1:8000  
- **前端**：http://localhost:5173  
- 適用 macOS / Linux；Windows 請用下方手動步驟。

### 手動啟動（可選）

#### 1. 後端（需先啟動）

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- **API**：`http://127.0.0.1:8000`
- **資料庫**：本機開發預設使用 `backend/users.db`（SQLite）；部署時使用 PostgreSQL（透過 `DATABASE_URL` 環境變數）

#### 2. 前端

```bash
cd frontend
npm install
npm run dev
```

- **網址**：http://localhost:5173
- 前端透過 Vite proxy 將 `/api` 轉發至後端，無需額外設定 CORS。

### 3. 字幕搜尋（選用）

使用 [OpenSubtitles](https://www.opensubtitles.com/) API。啟用方式：

1. 註冊並取得 API Key。
2. 啟動後端時設定環境變數：

   ```bash
   export OPENSUBTITLES_API_KEY=your_api_key_here
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```

未設定時，字幕搜尋會回傳空結果。

### 4. YouTube 出現「Sign in to confirm you're not a bot」時（選用）

YouTube 可能將下載請求視為機器人。可擇一處理：

1. **升級 yt-dlp**：請執行 `pip install -U yt-dlp` 取得最新版（YouTube 常更新，新版本較不易被擋）。
2. **使用 cookies**：從已登入 YouTube 的瀏覽器匯出 cookies（例如用 Chrome 擴充功能「Get cookies.txt LOCALLY」存成 `youtube_cookies.txt`），啟動後端時設定：
   ```bash
   export YTDLP_COOKIES=/path/to/youtube_cookies.txt
   uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
   ```
   **注意**：cookies 檔案含登入資訊，請勿分享或提交到版本庫。

### 5. 下載時出現「ffmpeg is not installed」（選用）

yt-dlp 合併影音格式時需要 **ffmpeg**。請在本機安裝後再下載：

- **macOS**：`brew install ffmpeg`
- **Ubuntu / Debian**：`sudo apt install ffmpeg`
- **Windows**：從 [ffmpeg 官網](https://ffmpeg.org/download.html) 下載並加入 PATH

---

## 使用方式

1. 開啟 http://localhost:5173
2. 點選「登入 / 加入會員」完成註冊或登入
3. **影片下載**：在「影片下載」頁可先點「選擇下載位置」指定資料夾（大檔案建議先選，需 Chrome/Edge 等支援 File System Access API 的瀏覽器），再貼上網址、點「開始下載」；完成後檔案會存到指定資料夾或瀏覽器預設下載位置。
4. **字幕下載**：在「字幕下載」頁輸入檔名或片名搜尋，從結果中選擇並下載
5. **管理後台**：管理員登入後可前往 `/dashboard` 查看會員與下載紀錄（預設管理員：id `admin`，密碼 `1qaz2wsx`）

---

## 技術說明

| 層級 | 技術與說明 |
|------|------------|
| **後端** | FastAPI、SQLAlchemy（PostgreSQL／SQLite）、JWT 登入；yt-dlp 下載影片（.mkv）與字幕；下載採 job 制、即時回報進度；missav 由本機解析 m3u8 後以 yt-dlp 下載 |
| **前端** | React 18、TypeScript、Vite、深色風格；專案名稱 Stream Downloader；首頁含介紹與操作說明 |
| **管理** | `/dashboard` 僅管理員可進入，可查看會員與下載紀錄 |

---

## 部署（前端 Vercel + 後端 Render）

- **前端**：部署至 [Vercel](https://vercel.com)（靜態站點）。
- **後端**：部署至 [Render](https://render.com)（常駐 Web Service + PostgreSQL 資料庫）。

### 後端（Render）步驟

1. 前往 [Render](https://render.com) 登入，點 **New → Blueprint**，選擇「連接到 Git 倉庫」並選定本專案。
2. Render 會讀取專案根目錄的 **`render.yaml`**，自動建立一個 **Web Service**（`stream-downloader-api`）與一個 **PostgreSQL 資料庫**（`stream-downloader-db`），並自動將 `DATABASE_URL` 注入服務環境變數。
3. 在該 Service 的 **Environment** 中新增以下環境變數（必填建議先設）：
   - **SECRET_KEY**：JWT 簽章用，正式環境必改。可於本機產生一組隨機字串後貼上，例如：
     - 終端機執行：`openssl rand -hex 32`，得到類似 `a1b2c3d4e5f6...` 的 64 字元十六進位字串，整串複製為 SECRET_KEY 的值。
     - 或：`python3 -c "import secrets; print(secrets.token_hex(32))"`，同樣將輸出整串設為 SECRET_KEY。
   - **CORS_ORIGINS**：前端網址，例如 `https://your-app.vercel.app`（與 Vercel 前端搭配時必設）。
   - **OPENSUBTITLES_API_KEY**：（選用）字幕搜尋用。
   - **DATABASE_URL**：由 Blueprint 自動從 PostgreSQL 注入，通常不需手動設定。
4. 部署完成後，後端網址為 `https://<你的服務名稱>.onrender.com`，API 基礎路徑為 **`https://<服務名稱>.onrender.com/api`**（前端 `VITE_API_BASE` 須指向此網址並含 `/api`）。

**注意**：Render 免費方案的 PostgreSQL 資料庫有 90 天期限，屆時需手動重建或升級付費方案。服務在一段時間無請求後會進入休眠，首次喚醒可能較慢。

### 前端（Vercel）步驟

1. 在 [Vercel](https://vercel.com) 匯入本專案（Import Git Repository）。
2. **Root Directory**：設為 `frontend`（專案根目錄下的 `frontend` 資料夾）。
3. **Environment Variables**：新增變數  
   - 名稱：`VITE_API_BASE`  
   - 值：後端 API 的完整網址，須包含路徑 `/api`，例如 `https://stream-downloader-api.onrender.com/api`。
4. 部署後，前端由 Vercel 提供，所有 API 請求會送往上述後端網址。

本地開發不需設定 `VITE_API_BASE`，會沿用 Vite proxy 的 `/api` 轉發到本機後端。

### 前後端串接提醒

- 後端 **CORS_ORIGINS** 必須包含前端實際網址（例如 `https://your-app.vercel.app`），多個以逗號分隔。
- 前端 **VITE_API_BASE** 必須指向後端完整 API 網址（含 `/api`）。

---

## 注意事項

- 下載內容僅供個人合理使用，請遵守各平台服務條款與著作權法。
- **正式部署**請修改後端 `SECRET_KEY`（建議使用環境變數），並設定適當的 CORS 來源。
