#!/usr/bin/env bash
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
PY="$DIR/.venv/bin/python3"
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 not found" >&2
  exit 1
fi
if [ ! -d "$DIR/.venv" ]; then
  python3 -m venv "$DIR/.venv"
fi
"$PY" -m pip install -U pip setuptools wheel >/dev/null
"$PY" -m pip install -e ".[dev]"
if ! command -v node >/dev/null 2>&1; then
  echo "node not found" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found" >&2
  exit 1
fi
if [ -d "$DIR/webui" ]; then
  cd "$DIR/webui"
  npm install
  cd "$DIR"
fi
export MEMPALACE_CONFIG_DIR="$DIR/.mempalace"
export MEMPALACE_PALACE_PATH="$DIR/.mempalace/palace"
export CHROMA_TELEMETRY_ENABLED=false
export POSTHOG_DISABLED=1
mkdir -p "$MEMPALACE_PALACE_PATH"
free_port() {
  p="$1"
  if command -v lsof >/dev/null 2>&1; then
    pid="$(lsof -ti tcp:$p || true)"
    if [ -n "${pid:-}" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  fi
}
free_port 8000
free_port 5174
trap 'kill 0' INT TERM
"$PY" -m mempalace.api_server --host 127.0.0.1 --port 8000 &
API_PID=$!
if [ -d "$DIR/webui" ]; then
  cd "$DIR/webui"
  npm run dev -- --host 127.0.0.1 --port 5174 &
  WEB_PID=$!
  cd "$DIR"
else
  WEB_PID=""
fi
for i in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:8000/api/health" >/dev/null; then
    break
  fi
  sleep 0.5
done
if [ -n "${WEB_PID:-}" ]; then
  for i in $(seq 1 60); do
    if curl -sf "http://127.0.0.1:5174" >/dev/null; then
      break
    fi
    sleep 0.5
  done
fi
echo "API:  http://127.0.0.1:8000"
if [ -n "${WEB_PID:-}" ]; then
  echo "Web:  http://127.0.0.1:5174"
fi
wait
