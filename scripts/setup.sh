#!/usr/bin/env bash
# Idempotent project setup: safe to run on a fresh machine and on every launch.
#   scripts/setup.sh          Python venv + deps, npm deps, .env, UI build
#   scripts/setup.sh --no-build   same, but skip the UI build (for `npm run dev`)
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "error: $*" >&2; exit 1; }

# --- toolchain checks -------------------------------------------------------
command -v python3 >/dev/null || fail "python3 not found. Install Python 3.11+ (https://www.python.org/downloads/)."
python3 -c 'import sys; sys.exit(sys.version_info < (3, 11))' \
  || fail "Python 3.11+ required, found $(python3 -V 2>&1)."

command -v node >/dev/null || fail "node not found. Install Node 22.12+ (https://nodejs.org/)."
command -v npm >/dev/null || fail "npm not found. It ships with Node."
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' \
  || fail "Node 22.12+ required (tldraw and Vite), found $(node -v)."

# --- Python -----------------------------------------------------------------
if command -v uv >/dev/null; then
  # uv-created venvs have no pip, so use uv whenever it's available. Honors uv.lock.
  uv sync --quiet
else
  [ -x .venv/bin/python ] || { echo "Creating .venv"; python3 -m venv .venv; }
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
