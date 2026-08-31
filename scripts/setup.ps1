[CmdletBinding()]
param(
  [switch]$InstallNode,
  [switch]$Reconfigure,
  [switch]$InstallOnly
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "`n=== IAM Intelligence bootstrap ===" -ForegroundColor Cyan

function Get-MajorVersion([string]$Version) { return [int](($Version.TrimStart('v').Split('.')[0])) }
function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw "$Name is not installed or is not on PATH. $InstallHint" }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if ($InstallNode -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Installing Node.js LTS with winget..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    Write-Host "Close and reopen PowerShell if node is still not on PATH." -ForegroundColor Yellow
  } else {
    throw "Node.js 20+ is required. Run .\scripts\setup.ps1 -InstallNode or install Node.js LTS manually."
  }
}

Require-Command node 'Install Node.js LTS.'
Require-Command npm 'npm is bundled with Node.js.'
Require-Command git 'Install Git for Windows.'

$nodeVersion = node --version
$npmVersion = npm --version
$nodeMajor = Get-MajorVersion $nodeVersion
if ($nodeMajor -lt 20) { throw "Node.js $nodeVersion detected. Node.js 20+ is required." }

Write-Host "Node.js : $nodeVersion" -ForegroundColor Green
Write-Host "npm     : $npmVersion" -ForegroundColor Green
Write-Host "Git     : $(git --version)" -ForegroundColor Green

if (-not (Test-Path "$RepoRoot\package.json")) { throw "package.json was not found. Run from the cloned repository." }

$envFile = Join-Path $RepoRoot '.env.local'
$defaultClientId = 'ab342dfc-cab4-45f3-acdb-3e49d606f418'
$defaultAuthority = 'https://login.microsoftonline.com/organizations'

if ($Reconfigure -or -not (Test-Path $envFile)) {
  Write-Host "`nIAM Intelligence Entra configuration" -ForegroundColor Yellow
  Write-Host "Configured product App Registration: $defaultClientId" -ForegroundColor DarkGray
  Write-Host "The application will sign users in first and request monitoring permissions only when Connect Tenant is selected." -ForegroundColor DarkGray
  @(
    '# Local-only configuration. Never commit this file.'
    "VITE_ENTRA_CLIENT_ID=$defaultClientId"
    "VITE_ENTRA_AUTHORITY=$defaultAuthority"
  ) | Set-Content -Path $envFile -Encoding UTF8
  Write-Host '.env.local configured for IAM Intelligence.' -ForegroundColor Green
} else {
  Write-Host '.env.local already exists; keeping it unchanged.' -ForegroundColor Green
}

$nodeModules = Join-Path $RepoRoot 'node_modules'
$lockFile = Join-Path $RepoRoot 'package-lock.json'
$needsInstall = -not (Test-Path $nodeModules) -or -not (Test-Path $lockFile)
if (-not $needsInstall -and (Test-Path $lockFile)) {
  $packageJsonTime = (Get-Item "$RepoRoot\package.json").LastWriteTimeUtc
  $lockTime = (Get-Item $lockFile).LastWriteTimeUtc
  $needsInstall = $packageJsonTime -gt $lockTime
}

if ($needsInstall) {
  Write-Host 'Installing project dependencies...' -ForegroundColor Cyan
  npm install
} else {
  Write-Host 'Project dependencies already installed; skipping npm install.' -ForegroundColor Green
}

Write-Host 'Running production build validation...' -ForegroundColor Cyan
npm run build

Write-Host "`nBootstrap complete." -ForegroundColor Green
Write-Host 'Run .\scripts\start.ps1 to launch the local web app.' -ForegroundColor Cyan
Write-Host 'Expected URL: http://localhost:5173' -ForegroundColor Cyan

if ($InstallOnly) { exit 0 }
