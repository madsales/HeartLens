#!/usr/bin/env bash
# HeartLens Auto-Poster installer (macOS / Linux / WSL).
#   ./install.sh            install into this directory
#   ./install.sh --link     also expose `heartlens-autopost` globally
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINK=0
for arg in "$@"; do
  case "$arg" in
    --link) LINK=1 ;;
    -h|--help) echo "usage: ./install.sh [--link]"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[36m==>\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!  \033[0m%s\n' "$1"; }
die()  { printf '\033[31mx  \033[0m%s\n' "$1" >&2; exit 1; }

command -v node >/dev/null 2>&1 || die "Node.js is not installed. Get Node 20 or newer from https://nodejs.org"

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  die "Node 20+ is required (found $(node -v)). This package uses the built-in fetch and test runner."
fi
say "Node $(node -v) - OK"

# There are no runtime dependencies, so there is nothing to download.
say "No dependencies to install (this package ships with zero of them)."

cd "$DIR"
if [ ! -f .env ]; then
  cp .env.example .env
  say "Created .env from the template."
else
  say ".env already exists - left untouched."
fi

mkdir -p data
chmod 600 .env 2>/dev/null || warn "Could not chmod .env to 600 - check its permissions yourself."

if [ "$LINK" -eq 1 ]; then
  if npm link >/dev/null 2>&1; then
    say "Linked globally: run \`heartlens-autopost\` from anywhere."
  else
    warn "npm link failed (often a permissions issue). Use ./autopost.sh instead, or run: sudo npm link"
  fi
fi

cat > autopost.sh <<'LAUNCHER'
#!/usr/bin/env bash
# Convenience launcher so you never have to remember the path.
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/bin/heartlens-autopost.js" "$@"
LAUNCHER
chmod +x autopost.sh

echo
say "Installed."
node bin/heartlens-autopost.js doctor || true
cat <<'NEXT'

Next
  1. Edit .env and fill in the platforms you want (each block says where to
     get the credentials). You can also skip this entirely -- the outbox
     target writes posts to a file with no credentials at all.
  2. ./autopost.sh doctor      what is wired up
  3. ./autopost.sh postnow     a dry run, so nothing is actually sent
  4. Set DRY_RUN=false in .env when the previews look right
  5. ./autopost.sh serve       dashboard + scheduler, one-click posting

NEXT
