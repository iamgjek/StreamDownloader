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

---

## 9) 更新程式碼後「快速重部署後端」（建議）

當你更新了後端程式（例如：新增欄位/記錄邏輯、修改進度訊息格式、字幕下載記錄等），建議在 EC2 上用以下方式重部署後端：

1. 登入 EC2 後進入專案目錄（例如 `/opt/stream-downloader`）
2. 拉最新程式碼（例如 `git pull`）
3. 執行：

```bash
sudo bash deploy/ec2/redeploy-backend.sh
```

此腳本會：

- 若 `backend/venv` 不存在就建立
- 重新安裝 `backend/requirements.txt` 依賴
- 重啟 `stream-downloader-api`
- 顯示服務狀態與建議驗證方式（`/docs`）

如果你只改前端（而前端是用 Vercel 部署），EC2 通常不需要重部署後端。

---

## 10) Push 後自動部署（GitHub Actions）

專案已提供 `.github/workflows/deploy-backend.yml`：

- 當 `main` 分支有 push，且變更包含 `backend/**` 或 `deploy/ec2/**` 時，自動 SSH 到 EC2 部署後端
- 也可在 GitHub → Actions → **Deploy Backend to EC2** → **Run workflow** 手動觸發

### 10.1 前端（Vercel）

前端位於 `frontend/`，建議在 [Vercel Dashboard](https://vercel.com) 將此 GitHub repo 連結起來：

- **Root Directory** 設為 `frontend`
- 之後每次 push 到 `main`（或你設定的 production branch），Vercel 會自動 build 並部署
- 目前 `frontend/vercel.json` 會把 `/api/*` 轉發到 EC2

### 10.2 後端（EC2）— 一次性設定

#### A. EC2 要能拉 GitHub 程式碼

在 EC2 上（以 `ubuntu` 使用者）建立 deploy key，並加到 repo 的 **Deploy keys**（Read-only 即可）：

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
# 到 GitHub repo → Settings → Deploy keys → Add deploy key
```

設定 git remote 使用 SSH（若尚未設定）：

```bash
cd /opt/stream-downloader
git remote set-url origin git@github.com:iamgjek/StreamDownloader.git

cat >> ~/.ssh/config <<'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config
ssh -T git@github.com
```

#### B. GitHub Repository Secrets

到 GitHub repo → **Settings** → **Secrets and variables** → **Actions**，新增：

| Secret | 說明 | 範例 |
|--------|------|------|
| `EC2_HOST` | EC2 公網 IP 或網域 | `13.212.87.50` |
| `EC2_USER` | SSH 使用者（Amazon Linux 用 `ec2-user`，Ubuntu 用 `ubuntu`） | `ec2-user` |
| `EC2_SSH_KEY` | 可 SSH 登入 EC2 的私鑰（完整 PEM 內容） | `-----BEGIN OPENSSH PRIVATE KEY-----...` |
| `EC2_APP_DIR` | （選填）專案在 EC2 上的路徑 | `/opt/stream-downloader` |

`EC2_SSH_KEY` 通常是你建立 EC2 時下載的 `.pem` 檔內容；請勿提交到 repo。

#### C. EC2 安全群組

確保 EC2 的 Security Group 允許 GitHub Actions runner 透過 **SSH (22)** 連入（建議限制為你的 IP；若要用 Actions，可暫時允許 `0.0.0.0/0` 或改用 [GitHub IP ranges](https://api.github.com/meta) 做更嚴格限制）。

### 10.3 驗證

1. 修改 `backend/` 任一檔案後 push 到 `main`
2. 到 GitHub → **Actions** 查看 workflow 是否成功
3. 確認 API 正常：

```bash
curl "http://<EC2_PUBLIC_IP>/api/subs/search?q=test&lang=zht"
```

