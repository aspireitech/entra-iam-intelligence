#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js LTS before running the collector." >&2
  exit 1
fi

if [ ! -f "tenants.json" ]; then
  echo "collector/tenants.json not found. Copy tenants.example.json to tenants.json and fill it in - see collector/README.md." >&2
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing collector dependencies..."
  npm install
fi

echo "Starting IAM Intelligence Collector..."
npm start
