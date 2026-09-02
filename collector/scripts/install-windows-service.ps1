[CmdletBinding()]
param(
  [string]$ServiceName = 'IAMIntelligenceCollector',
  [string]$NssmPath
)

# Installs the collector as a real Windows Service using NSSM (nssm.cc) - starts
# automatically at boot (no login required, no open terminal), restarts itself if
# the process crashes, and runs as SYSTEM. This is what makes the collector
# "unattended" in the sense its cert-based auth was built for - .\start.ps1 alone
# only runs it for as long as that terminal stays open.
#
# NSSM is a small, well-known third-party tool, not something this script can
# safely download and execute on your behalf - grab it yourself from
# https://nssm.cc/download (the win64 build), so you can see what you're running.
# Point -NssmPath at nssm.exe if it isn't already on PATH.

$ErrorActionPreference = 'Stop'
$collectorDir = Split-Path -Parent $PSScriptRoot

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  throw "Installing a Windows Service requires an elevated (Run as Administrator) PowerShell session. Re-run this script from an admin prompt."
}

$nssm = $NssmPath
if (-not $nssm) {
  $found = Get-Command nssm -ErrorAction SilentlyContinue
  if ($found) { $nssm = $found.Source }
}
if (-not $nssm -or -not (Test-Path $nssm)) {
  throw "nssm.exe not found. Download it from https://nssm.cc/download (win64 build), then re-run this script with -NssmPath 'C:\path\to\nssm.exe' (or add its folder to PATH first)."
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "Node.js 22.5+ is required and must be on PATH." }

if (-not (Test-Path (Join-Path $collectorDir 'tenants.json'))) {
  throw "collector\tenants.json not found. Copy tenants.example.json to tenants.json and fill it in - see collector\README.md - before installing the service."
}

$nodeModules = Join-Path $collectorDir 'node_modules'
if (-not (Test-Path $nodeModules)) {
  Write-Host 'Installing collector dependencies...' -ForegroundColor Cyan
  Push-Location $collectorDir
  try { npm install } finally { Pop-Location }
}

$logDir = Join-Path $collectorDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
  Write-Host "Service '$ServiceName' already exists - stopping it before reconfiguring." -ForegroundColor Yellow
  & $nssm stop $ServiceName | Out-Null
  & $nssm remove $ServiceName confirm | Out-Null
}

Write-Host "Installing service '$ServiceName'..." -ForegroundColor Cyan
& $nssm install $ServiceName $node (Join-Path $collectorDir 'index.js')
& $nssm set $ServiceName AppDirectory $collectorDir
& $nssm set $ServiceName AppStdout (Join-Path $logDir 'collector.out.log')
& $nssm set $ServiceName AppStderr (Join-Path $logDir 'collector.err.log')
& $nssm set $ServiceName AppRotateFiles 1
& $nssm set $ServiceName AppRotateBytes 5242880
& $nssm set $ServiceName Start SERVICE_AUTO_START
# Restart automatically on crash (not on a clean exit), capped so a persistent
# failure doesn't spin the service endlessly - matches what "unattended
# collection" should mean in production.
& $nssm set $ServiceName AppExit Default Restart
& $nssm set $ServiceName AppRestartDelay 15000
& $nssm set $ServiceName AppThrottle 5000

Start-Service -Name $ServiceName
Write-Host "`nService '$ServiceName' installed and started." -ForegroundColor Green
Write-Host "Status:   Get-Service $ServiceName"
Write-Host "Logs:     $logDir\collector.out.log / collector.err.log"
Write-Host "Restart:  Restart-Service $ServiceName"
Write-Host "Remove:   .\uninstall-windows-service.ps1"
