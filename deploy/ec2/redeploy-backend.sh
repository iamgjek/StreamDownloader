#!/usr/bin/env bash
set -euo pipefail

# 使用方式（在 EC2 上）：
# 1) cd 到你的專案目錄（例如 /opt/stream-downloader）
# 2) 拉取最新程式碼（例如 git pull）
# 3) 執行：sudo bash deploy/ec2/redeploy-backend.sh
#
# 目的：只重新部署後端（更新 venv 套件 + 重啟 systemd 服務）

if [[ $EUID -ne 0 ]]; then
  echo "請用 root 執行，例如：sudo bash deploy/ec2/redeploy-backend.sh"
  exit 1
fi

ROOT_DIR="${APP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
APP_USER="${APP_USER:-ubuntu}"
APP_GROUP="${APP_GROUP:-ubuntu}"
BACKEND_DIR="$ROOT_DIR/backend"
VENV_DIR="$BACKEND_DIR/venv"

ENV_FILE="/etc/stream-downloader.env"
SYSTEMD_SERVICE="stream-downloader-api"

echo "==> 確認後端目錄"
if [[ ! -d "$BACKEND_DIR" ]]; then
  echo "找不到後端目錄：$BACKEND_DIR"
  exit 1
fi

echo "==> 建立 venv（若不存在）"
if [[ ! -d "$VENV_DIR" ]]; then
  sudo -u "$APP_USER" bash -lc "cd \"$BACKEND_DIR\" && python3 -m venv venv"
fi

echo "==> 安裝 requirements（使用已存在 venv）"
sudo -u "$APP_USER" bash -lc "\"$VENV_DIR/bin/python3\" -m pip install --upgrade pip"
sudo -u "$APP_USER" bash -lc "\"$VENV_DIR/bin/python3\" -m pip install -r \"$BACKEND_DIR/requirements.txt\""

echo "==> 重啟 systemd：$SYSTEMD_SERVICE"
systemctl restart "$SYSTEMD_SERVICE"

echo "==> 查看狀態"
systemctl --no-pager --full status "$SYSTEMD_SERVICE" || true

echo "完成。建議驗證："
echo "  curl http://127.0.0.1:8000/docs"

