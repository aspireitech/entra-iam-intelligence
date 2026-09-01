#!/usr/bin/env bash
set -euo pipefail

# Capture the caller's original directory BEFORE any cd, so a relative
# --restore= path resolves against where the user actually ran this from,
# not against the repo root or collector dir this script cd's into later.
CALLER_PWD="$(pwd)"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

WITH_COLLECTOR=0
RESTORE_ARCHIVE=""
for arg in "$@"; do
  case "$arg" in
    --with-collector) WITH_COLLECTOR=1 ;;
    --restore=*) RESTORE_ARCHIVE="${arg#--restore=}"; WITH_COLLECTOR=1 ;;
  esac
done
if [ -n "$RESTORE_ARCHIVE" ]; then
  [ -f "$RESTORE_ARCHIVE" ] || { echo "Backup archive not found: $RESTORE_ARCHIVE" >&2; exit 1; }
  case "$RESTORE_ARCHIVE" in
    /*) : ;; # already absolute
    *) RESTORE_ARCHIVE="$CALLER_PWD/$RESTORE_ARCHIVE" ;;
  esac
fi
cd "$REPO_ROOT"

echo "=== IAM Intelligence - fresh server bootstrap ==="
echo "This sets up the dashboard, and optionally the collector, on a new machine."
echo "It never starts a long-running process for you - starting the collector as a"
echo "persistent service (systemd, a container, etc.) is a decision you make explicitly."

echo ""
echo "--- Dashboard ---"
bash "$REPO_ROOT/scripts/setup.sh"

if [ "$WITH_COLLECTOR" -ne 1 ]; then
  read -r -p $'\nAlso set up the multi-tenant collector on this machine? (y/N) ' answer
  [[ "$answer" =~ ^[Yy] ]] && WITH_COLLECTOR=1
fi
if [ "$WITH_COLLECTOR" -ne 1 ]; then
  echo ""
  echo "Skipping collector setup. Re-run with --with-collector later if needed."
  exit 0
fi

echo ""
echo "--- Collector ---"
COLLECTOR_ROOT="$REPO_ROOT/collector"
cd "$COLLECTOR_ROOT"

echo "Installing collector dependencies..."
npm install

if [ -n "$RESTORE_ARCHIVE" ]; then
  echo "Restoring collector state (certs, tenants.json, history) from backup..."
  bash "$COLLECTOR_ROOT/scripts/restore.sh" "$RESTORE_ARCHIVE"
else
  if [ ! -f "certs/collector.pem" ]; then
    # Pure JavaScript (no openssl, no Visual Studio) - see scripts/generate-cert.js.
    echo "Generating a new certificate (collector/certs/collector.pem + .key)..."
    node scripts/generate-cert.js
    echo "Certificate generated. You still need to upload the PUBLIC key (collector/certs/collector.pem)"
    echo "to the Entra app registration's Certificates & secrets blade and grant admin consent - see collector/README.md."
  else
    echo "Certificate already present - leaving it as is."
  fi

  if [ ! -f "tenants.json" ]; then
    cp tenants.example.json tenants.json
    echo "Created collector/tenants.json from the example - EDIT IT before starting: set collectorToken and the tenant ID(s)."
  else
    echo "collector/tenants.json already present - leaving it as is."
  fi
fi

echo ""
echo "=== Bootstrap complete ==="
echo "Dashboard:  ./scripts/start.sh       (from $REPO_ROOT)"
echo "Collector:  ./collector/start.sh     (from $REPO_ROOT)"
if [ -z "$RESTORE_ARCHIVE" ]; then
  echo "Before starting the collector: finish collector/tenants.json, upload the certificate, grant admin consent per tenant."
fi
