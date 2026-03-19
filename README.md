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

## 部署（前端 Vercel + 後端 AWS EC2 Free Tier）

- **前端**：部署至 [Vercel](https://vercel.com)。
- **後端**：部署至 AWS EC2 Free Tier（Nginx + systemd + FastAPI）。

### 後端（AWS EC2）步驟

#### 1) 建立 EC2（Free Tier）

1. 到 AWS Console 建立 EC2（建議 `t2.micro` 或 `t3.micro`）。
2. Security Group 開放：
   - `22`（SSH）
   - `80`（HTTP）
   - `443`（HTTPS，若要 SSL）
3. 記下 EC2 Public IP（例如 `3.0.0.10`）。

#### 2) 上傳程式並執行部署腳本

在本機推送程式碼到 GitHub 後，SSH 進 EC2（依 AMI 調整使用者）：

- Ubuntu：`ubuntu`
- Amazon Linux：`ec2-user`

```bash
ssh -i /path/to/your-key.pem <EC2_USER>@<EC2_PUBLIC_IP>
sudo mkdir -p /opt && sudo chown <EC2_USER>:<EC2_USER> /opt
cd /opt
git clone <YOUR_REPO_URL> stream-downloader
cd stream-downloader
export APP_USER=<EC2_USER>
export APP_GROUP=<EC2_USER>
sudo bash deploy/ec2/setup.sh
```

腳本會自動：
- 安裝 `python3`、`ffmpeg`、`nginx` 等套件
- 建立 `backend/venv` 並安裝 `requirements.txt`
- 安裝 `systemd` 服務 `stream-downloader-api`
- 套用 Nginx 設定（將 `/api` 轉發到 `127.0.0.1:8000`）

#### 3) 設定後端環境變數

編輯 `sudo nano /etc/stream-downloader.env`（首次執行會由 `deploy/ec2/env.example` 複製）：

- `SECRET_KEY`：正式環境必改（可用 `openssl rand -hex 32` 產生）
- `CORS_ORIGINS`：填入前端 Vercel 網址，例如 `https://your-app.vercel.app`
- `DATABASE_URL`：先用預設 SQLite 即可；若改 PostgreSQL 填入連線字串
- `OPENSUBTITLES_API_KEY`：選用
- `YTDLP_COOKIES`：YouTube 被擋時可選用

套用設定並重啟服務：

```bash
sudo systemctl daemon-reload
sudo systemctl restart stream-downloader-api
sudo systemctl status stream-downloader-api --no-pager
```

#### 4) 驗證後端

```bash
curl http://127.0.0.1:8000/docs
curl "http://127.0.0.1:8000/api/subs/search?q=test&lang=zht"
curl "http://<EC2_PUBLIC_IP>/api/subs/search?q=test&lang=zht"
```

> 若需 HTTPS，建議綁網域後用 Certbot 申請憑證（Ubuntu：`sudo apt install certbot python3-certbot-nginx`；Amazon Linux：`sudo dnf install certbot python3-certbot-nginx`）。

### 前端（Vercel）步驟

1. 在 [Vercel](https://vercel.com) 匯入本專案。
2. **Root Directory**：設為 `frontend`。
3. 在 **Environment Variables** 新增：
   - 名稱：`VITE_API_BASE`
   - 值：`http://<EC2_PUBLIC_IP>/api`（有 SSL 時改 `https://<your-domain>/api`）
4. 重新部署前端。

本地開發不需設定 `VITE_API_BASE`，會沿用 Vite proxy 的 `/api` 轉發到本機後端。

### 前後端串接與驗證

1. 開啟前端網址，測試登入與影片下載流程。
2. 未登入直接測試字幕頁與搜尋（`/subtitles`）。
3. EC2 查看日誌：

```bash
sudo journalctl -u stream-downloader-api -f
```

### 補充：舊版 Render 部署

若你仍想用 Render，可參考專案根目錄 `render.yaml` 做 Blueprint 部署。

---

## 注意事項

- 下載內容僅供個人合理使用，請遵守各平台服務條款與著作權法。
- **正式部署**請修改後端 `SECRET_KEY`（建議使用環境變數），並設定適當的 CORS 來源。
