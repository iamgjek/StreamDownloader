# Stream Downloader

會員制影片下載服務：支援 YouTube、missav 及多數 yt-dlp 相容網站，可依檔名搜尋與下載字幕。

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

- **Python** 3.10+
- **Node.js** 18+

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

### 1. 後端（需先啟動）

```bash
cd backend
python3 -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

- **API**：`http://127.0.0.1:8000`
- **資料庫**：`backend/users.db`（SQLite）

### 2. 前端

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

---

## 使用方式

1. 開啟 http://localhost:5173
2. 點選「登入 / 加入會員」完成註冊或登入
3. **影片下載**：在「影片下載」頁貼上網址，選擇類型（僅影片 .mkv／僅字幕／影片+字幕 ZIP），點「開始下載」，完成後檔案存至瀏覽器下載位置
4. **字幕下載**：在「字幕下載」頁輸入檔名或片名搜尋，從結果中選擇並下載
5. **管理後台**：管理員登入後可前往 `/dashboard` 查看會員與下載紀錄（預設管理員：id `admin`，密碼 `1qaz2wsx`）

---

## 技術說明

| 層級 | 技術與說明 |
|------|------------|
| **後端** | FastAPI、SQLAlchemy（SQLite）、JWT 登入；yt-dlp 下載影片（.mkv）與字幕；下載採 job 制、即時回報進度；missav 由本機解析 m3u8 後以 yt-dlp 下載 |
| **前端** | React 18、TypeScript、Vite、深色風格；專案名稱 Stream Downloader；首頁含介紹與操作說明 |
| **管理** | `/dashboard` 僅管理員可進入，可查看會員與下載紀錄 |

---

## 注意事項

- 下載內容僅供個人合理使用，請遵守各平台服務條款與著作權法。
- **正式部署**請修改後端 `SECRET_KEY`（建議使用環境變數），並設定適當的 CORS 來源。
