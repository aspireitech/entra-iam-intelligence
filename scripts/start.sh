#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

bash "$REPO_ROOT/scripts/setup.sh"

echo "Starting Entra IAM Intelligence..."
npm run dev
