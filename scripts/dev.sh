#!/usr/bin/env bash
# 本地開發一鍵啟動：後端（背景）+ 前端（前景）
# 使用方式：從專案根目錄執行 ./scripts/dev.sh

set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> 後端（backend）"
cd "$ROOT/backend"
# 若 venv 已存在但直譯器壞掉（例如專案曾改名或移動），刪除後重建
if [ -d venv ] && ! venv/bin/python3 -c "import sys" 2>/dev/null; then
  echo "    移除損壞的 venv 並重建..."
  rm -rf venv
fi
# Python 3.14 與目前 SQLAlchemy 可能不相容，優先使用 3.12 或 3.11
PYTHON=
for cmd in python3.12 python3.11 python3; do
  if command -v "$cmd" &>/dev/null && "$cmd" -c "import sys; exit(0 if sys.version_info < (3, 14) else 1)" 2>/dev/null; then
    PYTHON="$cmd"
    break
  fi
done
[ -z "$PYTHON" ] && PYTHON=python3
if ! "$PYTHON" -c "import sys; exit(0 if sys.version_info < (3, 14) else 1)" 2>/dev/null; then
  echo "    警告：目前為 Python 3.14，後端可能無法啟動（SQLAlchemy 不相容）。請安裝 Python 3.12 後再執行：brew install python@3.12"
fi
if [ ! -d venv ]; then
  echo "    建立 venv（使用 $PYTHON）..."
  "$PYTHON" -m venv venv
fi
# 使用 venv 內的 python3 -m pip / uvicorn，避免依賴可能壞掉的 shebang
venv/bin/python3 -m pip install -q -r requirements.txt
echo "    啟動 uvicorn (port 8000)..."
venv/bin/python3 -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!
cd "$ROOT"

cleanup() {
  echo ""
  echo "==> 關閉後端 (PID $BACKEND_PID)"
  kill $BACKEND_PID 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM

echo "==> 前端（frontend）"
cd "$ROOT/frontend"
npm install
echo "    啟動 Vite (http://localhost:5173)"
npm run dev

cleanup
