#!/usr/bin/env bash
set -euo pipefail

# 使用方式（在 EC2 上）
# 1) git clone 專案到 /opt/stream-downloader（或自訂路徑）
# 2) cd /opt/stream-downloader
# 3) bash deploy/ec2/setup.sh

if [[ $EUID -ne 0 ]]; then
  echo "請用 root 執行，例如：sudo bash deploy/ec2/setup.sh"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_DIR="${APP_DIR:-$ROOT_DIR}"
APP_USER="${APP_USER:-ubuntu}"
APP_GROUP="${APP_GROUP:-ubuntu}"
BACKEND_DIR="$APP_DIR/backend"
ENV_FILE="/etc/stream-downloader.env"
SYSTEMD_FILE="/etc/systemd/system/stream-downloader-api.service"
NGINX_SITE="/etc/nginx/sites-available/stream-downloader"
NGINX_LINK="/etc/nginx/sites-enabled/stream-downloader"

echo "==> 安裝系統套件"
apt-get update
apt-get install -y python3 python3-venv python3-pip ffmpeg nginx git curl

echo "==> 建立後端 venv 並安裝 requirements"
mkdir -p "$BACKEND_DIR/data"
chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
sudo -u "$APP_USER" bash -lc "cd \"$BACKEND_DIR\" && python3 -m venv venv"
sudo -u "$APP_USER" bash -lc "cd \"$BACKEND_DIR\" && venv/bin/python3 -m pip install --upgrade pip"
sudo -u "$APP_USER" bash -lc "cd \"$BACKEND_DIR\" && venv/bin/python3 -m pip install -r requirements.txt"

echo "==> 產生環境變數檔（若不存在）"
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$APP_DIR/deploy/ec2/env.example" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "已建立 $ENV_FILE，請先編輯 SECRET_KEY / CORS_ORIGINS 等設定後再啟動服務。"
fi

echo "==> 安裝 systemd 服務"
cp "$APP_DIR/deploy/ec2/stream-downloader-api.service" "$SYSTEMD_FILE"
sed -i "s|^User=.*|User=$APP_USER|g" "$SYSTEMD_FILE"
sed -i "s|^Group=.*|Group=$APP_GROUP|g" "$SYSTEMD_FILE"
sed -i "s|^WorkingDirectory=.*|WorkingDirectory=$BACKEND_DIR|g" "$SYSTEMD_FILE"
sed -i "s|^ExecStart=.*|ExecStart=$BACKEND_DIR/scripts/run_prod.sh|g" "$SYSTEMD_FILE"
systemctl daemon-reload
systemctl enable stream-downloader-api

echo "==> 安裝 Nginx site"
cp "$APP_DIR/deploy/ec2/nginx.conf" "$NGINX_SITE"
ln -sf "$NGINX_SITE" "$NGINX_LINK"
if [[ -f /etc/nginx/sites-enabled/default ]]; then
  rm -f /etc/nginx/sites-enabled/default
fi
nginx -t
systemctl enable nginx
systemctl restart nginx

echo "==> 啟動 API 服務"
systemctl restart stream-downloader-api
systemctl --no-pager --full status stream-downloader-api || true

echo "完成。建議驗證："
echo "  curl http://127.0.0.1:8000/docs"
echo "  curl http://<EC2_PUBLIC_IP>/api/subs/search?q=test&lang=zht"
