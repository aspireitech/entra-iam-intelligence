[CmdletBinding()]
param(
  [switch]$WithCollector,
  [switch]$RestoreFromBackup,
  [string]$BackupArchive
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot

# Resolve a relative -BackupArchive path against the caller's original location
# BEFORE changing directory anywhere below - otherwise it silently resolves
# against the repo root or collector dir instead of where the user actually ran this from.
if ($BackupArchive) {
  if (-not (Test-Path $BackupArchive)) { throw "Backup archive not found: $BackupArchive" }
  $BackupArchive = (Resolve-Path $BackupArchive).Path
}
Set-Location $RepoRoot

Write-Host "=== IAM Intelligence - fresh server bootstrap ===" -ForegroundColor Cyan
Write-Host "This sets up the dashboard, and optionally the collector, on a new machine." -ForegroundColor DarkGray
Write-Host "It never starts a long-running process for you - starting the collector as a" -ForegroundColor DarkGray
Write-Host "persistent service (NSSM, Task Scheduler, etc.) is a decision you make explicitly." -ForegroundColor DarkGray

# 1. Dashboard (SPA)
Write-Host "`n--- Dashboard ---" -ForegroundColor Yellow
& "$PSScriptRoot\setup.ps1"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# 2. Collector (optional)
if (-not $WithCollector) {
  $answer = Read-Host "`nAlso set up the multi-tenant collector on this machine? (y/N)"
  $WithCollector = $answer -match '^[Yy]'
}
if (-not $WithCollector) {
  Write-Host "`nSkipping collector setup. Run this script again with -WithCollector later if needed." -ForegroundColor DarkGray
  exit 0
}

Write-Host "`n--- Collector ---" -ForegroundColor Yellow
$CollectorRoot = Join-Path $RepoRoot 'collector'
Set-Location $CollectorRoot

if ($RestoreFromBackup) {
  if (-not $BackupArchive) { throw "-RestoreFromBackup requires -BackupArchive <path>." }
  Write-Host "Restoring collector state (certs, tenants.json, history) from backup..." -ForegroundColor Cyan
  & "$CollectorRoot\scripts\restore.ps1" -Archive $BackupArchive
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} else {
  # Fresh install: generate a certificate if one doesn't already exist.
  $certPem = Join-Path $CollectorRoot 'certs\collector.pem'
  if (-not (Test-Path $certPem)) {
    if (Get-Command openssl -ErrorAction SilentlyContinue) {
      Write-Host "Generating a new certificate (collector/certs/collector.pem + .key)..." -ForegroundColor Cyan
      New-Item -ItemType Directory -Force -Path (Join-Path $CollectorRoot 'certs') | Out-Null
      openssl req -x509 -newkey rsa:2048 -keyout (Join-Path $CollectorRoot 'certs\collector.key') `
        -out $certPem -days 730 -nodes -subj "/CN=IAM Intelligence Collector"
      Write-Host "Certificate generated. You still need to upload the PUBLIC key (collector/certs/collector.pem)" -ForegroundColor Yellow
      Write-Host "to the Entra app registration's Certificates & secrets blade and grant admin consent - see collector/README.md." -ForegroundColor Yellow
    } else {
      Write-Host "openssl not found on PATH (it ships with Git for Windows - try a 'Git Bash' terminal, or install Git for Windows)." -ForegroundColor Red
      Write-Host "Generate the certificate manually per collector/README.md before running the collector." -ForegroundColor Red
    }
  } else {
    Write-Host "Certificate already present - leaving it as is." -ForegroundColor Green
  }

  $tenantsJson = Join-Path $CollectorRoot 'tenants.json'
  if (-not (Test-Path $tenantsJson)) {
    Copy-Item (Join-Path $CollectorRoot 'tenants.example.json') $tenantsJson
    Write-Host "Created collector/tenants.json from the example - EDIT IT before starting: set collectorToken and the tenant ID(s)." -ForegroundColor Yellow
  } else {
    Write-Host "collector/tenants.json already present - leaving it as is." -ForegroundColor Green
  }
}

Write-Host "Installing collector dependencies (includes better-sqlite3, prebuilt binary)..." -ForegroundColor Cyan
npm install

Write-Host "`n=== Bootstrap complete ===" -ForegroundColor Green
Write-Host "Dashboard:  .\scripts\start.ps1          (from $RepoRoot)" -ForegroundColor Cyan
Write-Host "Collector:  .\collector\start.ps1        (from $RepoRoot)" -ForegroundColor Cyan
if (-not $RestoreFromBackup) {
  Write-Host "Before starting the collector: finish collector/tenants.json, upload the certificate, grant admin consent per tenant." -ForegroundColor Yellow
}
