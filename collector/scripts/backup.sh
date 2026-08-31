#!/usr/bin/env bash
set -euo pipefail

COLLECTOR_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Resolve a custom output dir relative to the caller's original working directory,
# before cd'ing into the collector dir (matches restore.sh's path handling).
if [ -n "${1:-}" ]; then
  mkdir -p "$1"
  OUT_DIR="$(cd "$1" && pwd)"
else
  OUT_DIR="$COLLECTOR_ROOT/backups"
fi
cd "$COLLECTOR_ROOT"

echo "=== IAM Intelligence Collector backup ==="

missing=()
[ -f tenants.json ] || missing+=("tenants.json")
compgen -G "certs/*.pem" > /dev/null || missing+=("certs/*.pem")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Nothing to back up yet - missing: ${missing[*]}"
  exit 1
fi

mkdir -p "$OUT_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
archive="$OUT_DIR/collector-backup-$stamp.tar.gz"

tar_args=(tenants.json certs)
[ -d data ] && tar_args+=(data)
tar -czf "$archive" "${tar_args[@]}"

size=$(du -h "$archive" | cut -f1)
echo ""
echo "Backup written: $archive ($size)"
echo "Contains: tenants.json, certs/ (INCLUDING THE PRIVATE KEY), data/ (SQLite history + latest snapshots)."
echo "Store/transport this archive as securely as you would the private key alone - encrypted storage, restricted access, never email."
echo "Restore on a new machine with: ./scripts/restore.sh '$archive'"
