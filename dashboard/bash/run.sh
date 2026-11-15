#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -d .venv || ! -d node_modules ]]; then
  echo "Dependencies not found; running setup first."
  ./bash/setup.sh
fi

source .venv/bin/activate

pids=()
cleaned_up=false

cleanup() {
  if [[ "$cleaned_up" == true ]]; then
    return
  fi
  cleaned_up=true

  if ((${#pids[@]})); then
    kill "${pids[@]}" 2>/dev/null || true
    for pid in "${pids[@]}"; do
      wait "$pid" 2>/dev/null || true
    done
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

port_in_use() {
  command -v lsof >/dev/null && lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

if port_in_use 8000; then
  echo "FastAPI is already running on http://localhost:8000; reusing it."
else
  echo "Starting FastAPI on http://localhost:8000"
  # Keep one process so Ctrl-C can cleanly stop it.
  python -m uvicorn APIcall:app --app-dir src --port 8000 &
  pids+=("$!")
fi

if port_in_use 5174; then
  echo "Vite is already running on http://localhost:5174; reusing it."
else
  echo "Starting Vite on http://localhost:5174"
  npm run dev
fi
