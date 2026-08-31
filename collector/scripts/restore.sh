#!/usr/bin/env bash
set -euo pipefail

COLLECTOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "=== IAM Intelligence Collector restore ==="

ARCHIVE=""
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    *) ARCHIVE="$arg" ;;
  esac
done
if [ -z "$ARCHIVE" ]; then
  echo "Usage: ./scripts/restore.sh <path-to-backup.tar.gz> [--force]" >&2
  exit 1
fi
# Resolve to an absolute path BEFORE cd'ing into the collector dir, so a path
# relative to the caller's original working directory still works.
[ -f "$ARCHIVE" ] || { echo "Backup archive not found: $ARCHIVE" >&2; exit 1; }
ARCHIVE="$(cd "$(dirname "$ARCHIVE")" && pwd)/$(basename "$ARCHIVE")"
cd "$COLLECTOR_ROOT"

existing=()
[ -f tenants.json ] && existing+=("tenants.json")
[ -d data ] && existing+=("data/")
compgen -G "certs/*.pem" > /dev/null && existing+=("certs/*.pem")
if [ ${#existing[@]} -gt 0 ] && [ "$FORCE" -ne 1 ]; then
  echo "This machine already has collector state present (${existing[*]}). Re-run with --force to overwrite it with the backup's contents, or move/rename the existing files first if you want to keep them." >&2
  exit 1
fi

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT
tar -xzf "$ARCHIVE" -C "$staging"

cp "$staging/tenants.json" .
mkdir -p certs
cp -R "$staging/certs/." certs/
if [ -d "$staging/data" ]; then
  mkdir -p data
  cp -R "$staging/data/." data/
fi

echo ""
echo "Restored tenants.json, certs/, and data/ (history + latest snapshots)."
echo "History picks up exactly where the old server left off - no gap, no reset."
echo "Next: ./start.sh (installs dependencies on first run, then starts the collector)."
echo "The certificate's public key is unchanged, so no Entra app-registration or admin-consent changes are needed."
