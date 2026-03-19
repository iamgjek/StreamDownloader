# AWS 部署文件（EC2 + RDS PostgreSQL）

本文件示範如何把 `Stream Downloader` 部署到 AWS：

- **EC2**：跑後端 FastAPI（systemd）並用 **Nginx** 反向代理
- **RDS PostgreSQL**：替代預設 SQLite（透過環境變數 `DATABASE_URL` 連線）

專案內已提供一鍵部署腳本與模板，位置：

- `deploy/ec2/setup.sh`
- `deploy/ec2/env.example`
- `deploy/ec2/nginx.conf`
- `deploy/ec2/stream-downloader-api.service`

---

## 架構概覽

1. 使用者瀏覽器
2. Nginx（EC2）：
   - `/api/*` 反向代理到 `http://127.0.0.1:8000/api/*`
   - `/docs`、`/openapi.json` 反向代理到 FastAPI
3. FastAPI（EC2）：
   - 透過 `DATABASE_URL` 連到 RDS PostgreSQL
   - 啟動時自動 `create_all` / 補欄位（用於既有 DB 升級）
4. RDS PostgreSQL（資料庫）

---

## 前置條件

1. AWS 帳號
2. 一個可對外存取的網域或至少可用於測試的入口（本文件 Nginx 先以 `80` 為主）
3. EC2 可使用 OS 套件安裝（`apt/dnf/yum` 任一）

建議 OS：Ubuntu 22.04 / Amazon Linux 皆可（`setup.sh` 會判斷套件管理器）。

---

## 1) 建立 RDS PostgreSQL

### 1.1 建立資料庫

- Engine：PostgreSQL
- DB Instance：依預算選擇

### 1.2 設定 DB Subnet Group（若使用私有子網）

- 確保 EC2 與 RDS 使用同一個 VPC
- 選擇包含 EC2 所在子網的 subnet（或至少能互通的 subnets）

### 1.3 安全群組（Security Group）設定

建議做法：**RDS 入站只允許 EC2 的安全群組在 5432 連入**。

- RDS SG inbound：
  - Port：`5432`
  - Source：**EC2 的 SG**（而不是 0.0.0.0/0）

### 1.4 取得必要資訊

- `RDS endpoint`（例如：`mydb.xxxxx.rds.amazonaws.com`）
- DB 名稱
- DB 使用者帳密
- 是否強制 SSL（如果你有開啟 RDS 的強制 SSL 或 server 要求）

---

## 2) 建立 EC2（FastAPI + Nginx）

### 2.1 設定安全群組（Security Group）

最常見需求（可依你的情境調整）：

- Inbound
  - `22`：SSH（建議限制為你的 IP）
  - `80`：HTTP（對外）
  - `443`：HTTPS（如你有做 SSL；本 repo 的 Nginx 範本目前以 80 為主）
- Outbound
  - 允許到 RDS 的 `5432`（通常預設允許即可）

---

## 3) EC2 上部署後端與 Nginx

> 以下假設你把專案 repo clone 下來後，目錄結構符合此 repo。

### 3.1 安裝/準備

在 EC2 上以 root（或 sudo）執行：

```bash
sudo bash deploy/ec2/setup.sh
```

`deploy/ec2/setup.sh` 會做以下事：

- 安裝系統套件（python3/ffmpeg/nginx/git/curl...）
- 建立後端 venv 並安裝 `backend/requirements.txt`
- 建立 systemd 服務（`stream-downloader-api`）
- 安裝 Nginx site（反向代理 `/api` 與 `/docs`）
- 啟動 `stream-downloader-api`

---

## 4) 設定環境變數（/etc/stream-downloader.env）

`setup.sh` 若發現 `/etc/stream-downloader.env` 不存在，會先從：

- `deploy/ec2/env.example`

複製並建立。

請編輯：

```bash
sudo nano /etc/stream-downloader.env
```

### 4.1 必填

- `SECRET_KEY`
  - 請改成隨機長字串，例如：

```bash
openssl rand -hex 32
```

- `CORS_ORIGINS`
  - 填入你的前端網域（或用逗號分隔多個）
  - 例如：
    - `https://stream.i-design.app`

### 4.2 `DATABASE_URL`：RDS PostgreSQL 連線字串

後端使用 SQLAlchemy，`DATABASE_URL` 建議使用 PostgreSQL 格式。此專案也會把 `postgres://` 自動轉成 `postgresql://`。

範例（不含 SSL）：

```bash
DATABASE_URL=postgres://USER:PASSWORD@RDS_ENDPOINT:5432/DBNAME
```

範例（需要 SSL；常見於 RDS 強制 SSL 或你想加強安全）：

```bash
DATABASE_URL=postgres://USER:PASSWORD@RDS_ENDPOINT:5432/DBNAME?sslmode=require
```

> 你實際要不要加 `?sslmode=require`，取決於你 RDS 的設定與連線需求。

---

## 5) 重啟服務並驗證

### 5.1 重啟

```bash
sudo systemctl restart stream-downloader-api
sudo systemctl status stream-downloader-api --no-pager
```

如果你要看 log：

```bash
sudo journalctl -u stream-downloader-api -f
```

### 5.2 檢查 API

```bash
curl http://127.0.0.1:8000/docs
curl "http://127.0.0.1:8000/api/subs/search?q=test&lang=zht"
curl "http://<EC2_PUBLIC_IP>/api/subs/search?q=test&lang=zht"
```

---

## 6) Nginx 設定說明（目前模板）

模板檔案：`deploy/ec2/nginx.conf`

目前會把：

- `/api/*` → `http://127.0.0.1:8000/api/*`
- `/docs`、`/openapi.json` → FastAPI 對應路徑

若你要上 HTTPS：

- 建議改 Nginx 配置後再搭配 Certbot/憑證（或改用 ALB + ACM）
- 本文件先不展開 HTTPS 細節，因為 repo 目前 Nginx site 範本以 `listen 80` 為主

---

## 7) 常見問題（排錯）

### 7.1 後端啟動失敗 / DB 連線錯誤

檢查：

1. `/etc/stream-downloader.env` 的 `DATABASE_URL` 是否正確（endpoint/DB/user/pass/dbname）
2. RDS SG 是否允許 EC2 SG 在 `5432` 連入
3. VPC / Subnet 是否互通
4. 若 RDS 強制 SSL，是否需要在 `DATABASE_URL` 加上 `sslmode=require`

可用：

```bash
sudo journalctl -u stream-downloader-api -f
```

### 7.2 前端無法呼叫 API（CORS）

檢查 `CORS_ORIGINS` 是否包含你的前端網域（含協定 `https://`）。

---

## 8) 升級/變更資料庫

後端啟動時會：

- `Base.metadata.create_all(bind=engine)`：自動建立缺少的表
- 針對舊資料庫做少量欄位補遷移（例如 `is_admin`、`download_logs` 的 `og_title/og_description`）

因此通常只需要：

1. 更新程式碼
2. `sudo systemctl restart stream-downloader-api`

