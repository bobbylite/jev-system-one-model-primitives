#!/usr/bin/env bash
# Idempotent project setup: safe to run on a fresh machine and on every launch.
#   scripts/setup.sh              npm deps, .dev.vars, UI build
#   scripts/setup.sh --no-build   same, but skip the UI build (for `npm run dev`)
set -euo pipefail
cd "$(dirname "$0")/.."

fail() { echo "error: $*" >&2; exit 1; }

# VS Code tasks don't always inherit your shell profile, so check the usual tool locations too.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

command -v node >/dev/null || fail "node not found on PATH ($PATH). Install Node 22.12+ (https://nodejs.org/)."
command -v npm >/dev/null || fail "npm not found. It ships with Node."
node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' \
  || fail "Node 22.12+ required, found $(node -v) at $(command -v node). Upgrade it (e.g. 'nvm install 22' or 'brew upgrade node')."

if [ ! -f .dev.vars ]; then
  cp .dev.vars.example .dev.vars
  echo "Created .dev.vars. Put your TYPESAFE_API_KEY in it (https://console.typesafe.ai/)."
fi
if grep -qE '^JEV_MOCK=true' .dev.vars; then
  echo "note: JEV_MOCK=true, so wrangler dev will not call Jev."
elif grep -qE '^TYPESAFE_API_KEY=.+' .dev.vars && ! grep -q 'your-key-here' .dev.vars; then
  :
else
  echo "warning: TYPESAFE_API_KEY in .dev.vars is not set. Jev POSTs return 503 (switched off) until it is. Set JEV_MOCK=true for canned answers under wrangler dev." >&2
fi

npm install --no-audit --no-fund
if [ "${1:-}" != "--no-build" ]; then
  npm run build
fi
echo "Setup complete."
