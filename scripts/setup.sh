#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== Entra IAM Intelligence bootstrap ==="

command -v git >/dev/null 2>&1 || { echo "Git is required."; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js LTS from https://nodejs.org/en/download/ and rerun this script."
  exit 1
fi
command -v npm >/dev/null 2>&1 || { echo "npm is required and normally ships with Node.js."; exit 1; }

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js $(node --version) detected. Node.js 20+ is required; Node.js 24 LTS is recommended."
  exit 1
fi

echo "Node.js: $(node --version)"
echo "npm:     $(npm --version)"
echo "Git:     $(git --version)"

if [ ! -f "$REPO_ROOT/package.json" ]; then
  echo "package.json not found. Run from the cloned repository."
  exit 1
fi

if [ ! -f "$REPO_ROOT/.env.local" ]; then
  read -r -p "Enter the Microsoft Entra SPA Application (client) ID (press Enter to configure later): " CLIENT_ID
  cat > "$REPO_ROOT/.env.local" <<EOF
# Local-only configuration. Never commit this file.
VITE_ENTRA_CLIENT_ID=$CLIENT_ID
VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/organizations
EOF
  echo "Created .env.local"
else
  echo ".env.local already exists; keeping it unchanged."
fi

NEEDS_INSTALL=0
if [ ! -d "$REPO_ROOT/node_modules" ] || [ ! -f "$REPO_ROOT/node_modules/.package-lock.json" ]; then
  NEEDS_INSTALL=1
elif [ "$REPO_ROOT/package.json" -nt "$REPO_ROOT/node_modules/.package-lock.json" ]; then
  NEEDS_INSTALL=1
fi

if [ "$NEEDS_INSTALL" -eq 1 ]; then
  echo "Installing project dependencies..."
  npm install
else
  echo "Project dependencies already installed; skipping npm install."
fi

echo "Running production build validation..."
npm run build

echo "Bootstrap complete. Run ./scripts/start.sh to launch the app."
echo "Expected URL: http://localhost:5173"
