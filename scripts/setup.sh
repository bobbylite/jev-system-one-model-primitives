#!/usr/bin/env bash
# Idempotent project setup: safe to run on a fresh machine and on every launch.
#   scripts/setup.sh          Python venv + deps, npm deps, .env, UI build
#   scripts/setup.sh --no-build   same, but skip the UI build (for `npm run dev`)
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "error: $*" >&2; exit 1; }

# VS Code tasks don't always inherit your shell profile, so check the usual tool locations too.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

# --- Node (needed by Vite and tldraw) ---------------------------------------
command -v node >/dev/null || fail "node not found on PATH ($PATH). Install Node 22.12+ (https://nodejs.org/)."
command -v npm >/dev/null || fail "npm not found. It ships with Node."
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' \
  || fail "Node 22.12+ required, found $(node -v) at $(command -v node). Upgrade it (e.g. 'nvm install 22' or 'brew upgrade node')."

# --- Python -----------------------------------------------------------------
if command -v uv >/dev/null; then
  # uv downloads a suitable Python itself if needed, and venvs it creates have no pip.
  # Honors uv.lock.
  uv sync --quiet
else
  PY=""
  for c in python3.13 python3.12 python3.11 python3; do
    if command -v "$c" >/dev/null && "$c" -c 'import sys; sys.exit(sys.version_info < (3, 11))'; then PY="$c"; break; fi
  done
  [ -n "$PY" ] || fail "Python 3.11+ required, but python3 is $(python3 -V 2>&1) at $(command -v python3 || echo '<none>'). Install Python 3.11+ or uv (https://docs.astral.sh/uv/)."
  [ -x .venv/bin/python ] || { echo "Creating .venv with $("$PY" -V)"; "$PY" -m venv .venv; }
  .venv/bin/python -m pip install --quiet --disable-pip-version-check -e .
fi

# --- .env -------------------------------------------------------------------
if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env. Put your TYPESAFE_API_KEY in it (https://console.typesafe.ai/)."
fi
grep -qE '^TYPESAFE_API_KEY=.+' .env && ! grep -q 'your-key-here' .env \
  || echo "warning: TYPESAFE_API_KEY in .env is not set; Jev requests will fail until it is." >&2

# --- front end --------------------------------------------------------------
npm install --no-audit --no-fund
if [ "${1:-}" != "--no-build" ]; then
  npm run build
fi
echo "Setup complete."
