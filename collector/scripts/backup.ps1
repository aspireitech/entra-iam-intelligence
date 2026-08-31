[CmdletBinding()]
param(
  [string]$OutDir = (Join-Path $PSScriptRoot '..\backups')
)

$ErrorActionPreference = 'Stop'
$CollectorRoot = Split-Path -Parent $PSScriptRoot
# Resolve a custom output dir relative to the caller's original working directory,
# before cd'ing into the collector dir (matches restore.ps1's path handling).
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$OutDir = (Resolve-Path $OutDir).Path
Set-Location $CollectorRoot

Write-Host "=== IAM Intelligence Collector backup ===" -ForegroundColor Cyan

$missing = @()
if (-not (Test-Path 'tenants.json')) { $missing += 'tenants.json' }
if (-not (Test-Path 'certs') -or -not (Get-ChildItem certs -Filter *.pem -ErrorAction SilentlyContinue)) { $missing += 'certs/*.pem' }
if ($missing.Count) {
  Write-Host "Nothing to back up yet - missing: $($missing -join ', ')" -ForegroundColor Yellow
  exit 1
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $OutDir "collector-backup-$stamp.zip"

$staging = Join-Path ([System.IO.Path]::GetTempPath()) "iam-collector-backup-$stamp"
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  Copy-Item 'tenants.json' $staging
  Copy-Item 'certs' (Join-Path $staging 'certs') -Recurse
  if (Test-Path 'data') { Copy-Item 'data' (Join-Path $staging 'data') -Recurse }

  Compress-Archive -Path (Join-Path $staging '*') -DestinationPath $archive -Force
} finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

$size = [math]::Round((Get-Item $archive).Length / 1MB, 2)
Write-Host "`nBackup written: $archive ($size MB)" -ForegroundColor Green
Write-Host "Contains: tenants.json, certs/ (INCLUDING THE PRIVATE KEY), data/ (SQLite history + latest snapshots)." -ForegroundColor Yellow
Write-Host "Store/transport this archive as securely as you would the private key alone - encrypted storage, restricted access, never email." -ForegroundColor Yellow
Write-Host "Restore on a new machine with: .\scripts\restore.ps1 -Archive '$archive'" -ForegroundColor Cyan
