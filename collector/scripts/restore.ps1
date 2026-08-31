[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$CollectorRoot = Split-Path -Parent $PSScriptRoot

Write-Host "=== IAM Intelligence Collector restore ===" -ForegroundColor Cyan

# Resolve to an absolute path BEFORE changing directory, so a path relative to
# the caller's original working directory still works.
if (-not (Test-Path $Archive)) { throw "Backup archive not found: $Archive" }
$Archive = (Resolve-Path $Archive).Path
Set-Location $CollectorRoot

$existing = @()
if (Test-Path 'tenants.json') { $existing += 'tenants.json' }
if (Test-Path 'data') { $existing += 'data\' }
if ((Get-ChildItem certs -Filter *.pem -ErrorAction SilentlyContinue)) { $existing += 'certs\*.pem' }
if ($existing.Count -and -not $Force) {
  throw "This machine already has collector state present ($($existing -join ', ')). Re-run with -Force to overwrite it with the backup's contents, or move/rename the existing files first if you want to keep them."
}

$staging = Join-Path ([System.IO.Path]::GetTempPath()) "iam-collector-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
New-Item -ItemType Directory -Force -Path $staging | Out-Null
try {
  Expand-Archive -Path $Archive -DestinationPath $staging -Force

  Copy-Item (Join-Path $staging 'tenants.json') '.' -Force
  New-Item -ItemType Directory -Force -Path 'certs' | Out-Null
  Copy-Item (Join-Path $staging 'certs\*') 'certs' -Recurse -Force
  if (Test-Path (Join-Path $staging 'data')) {
    New-Item -ItemType Directory -Force -Path 'data' | Out-Null
    Copy-Item (Join-Path $staging 'data\*') 'data' -Recurse -Force
  }
} finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "`nRestored tenants.json, certs/, and data/ (history + latest snapshots)." -ForegroundColor Green
Write-Host "History picks up exactly where the old server left off - no gap, no reset." -ForegroundColor Green
Write-Host "Next: .\start.ps1 (installs dependencies on first run, then starts the collector)." -ForegroundColor Cyan
Write-Host "The certificate's public key is unchanged, so no Entra app-registration or admin-consent changes are needed." -ForegroundColor Cyan
