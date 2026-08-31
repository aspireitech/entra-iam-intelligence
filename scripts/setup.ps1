[CmdletBinding()]
param(
  [switch]$InstallNode
)

$ErrorActionPreference = 'Stop'
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

Write-Host "`n=== Entra IAM Intelligence bootstrap ===" -ForegroundColor Cyan

function Get-MajorVersion([string]$Version) {
  return [int](($Version.TrimStart('v').Split('.')[0]))
}

function Require-Command([string]$Name, [string]$InstallHint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is not installed or is not on PATH. $InstallHint"
  }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  if ($InstallNode -and (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "Node.js not found. Installing Node.js LTS with winget..." -ForegroundColor Yellow
    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements
    Write-Host "Restart PowerShell after installation if node is still not on PATH." -ForegroundColor Yellow
  } else {
    throw "Node.js 20+ is required. Install the Node.js LTS release, then rerun this script. Official downloads: https://nodejs.org/en/download/"
  }
}

Require-Command node 'Install Node.js LTS from https://nodejs.org/en/download/'
Require-Command npm 'npm is installed with Node.js.'
Require-Command git 'Install Git for Windows from https://git-scm.com/download/win'

$nodeVersion = node --version
$npmVersion = npm --version
$nodeMajor = Get-MajorVersion $nodeVersion
if ($nodeMajor -lt 20) { throw "Node.js $nodeVersion detected. Node.js 20+ is required. Node.js 24 LTS is recommended." }

Write-Host "Node.js : $nodeVersion" -ForegroundColor Green
Write-Host "npm     : $npmVersion" -ForegroundColor Green
Write-Host "Git     : $(git --version)" -ForegroundColor Green

if (-not (Test-Path "$RepoRoot\package.json")) { throw "package.json was not found. Run this script from the cloned repository." }

$envFile = Join-Path $RepoRoot '.env.local'
if (-not (Test-Path $envFile)) {
  $clientId = Read-Host 'Enter the Microsoft Entra SPA Application (client) ID (press Enter to configure later)'
  $authority = 'https://login.microsoftonline.com/organizations'
  @("# Local-only configuration. Never commit this file.", "VITE_ENTRA_CLIENT_ID=$clientId", "VITE_ENTRA_AUTHORITY=$authority") | Set-Content -Path $envFile -Encoding UTF8
  Write-Host "Created .env.local" -ForegroundColor Green
} else {
  Write-Host ".env.local already exists; keeping it unchanged." -ForegroundColor Green
}

$nodeModules = Join-Path $RepoRoot 'node_modules'
$npmStamp = Join-Path $nodeModules '.package-lock.json'
$packageJsonTime = (Get-Item "$RepoRoot\package.json").LastWriteTimeUtc
$needsInstall = -not (Test-Path $nodeModules) -or -not (Test-Path $npmStamp)
if (-not $needsInstall) {
  $needsInstall = $packageJsonTime -gt (Get-Item $npmStamp).LastWriteTimeUtc
}

if ($needsInstall) {
  Write-Host "Installing project dependencies..." -ForegroundColor Cyan
  npm install
} else {
  Write-Host "Project dependencies already installed; skipping npm install." -ForegroundColor Green
}

Write-Host "Running production build validation..." -ForegroundColor Cyan
npm run build

Write-Host "`nBootstrap complete." -ForegroundColor Green
Write-Host "Run .\scripts\start.ps1 to launch the local web app." -ForegroundColor Cyan
Write-Host "Expected URL: http://localhost:5173" -ForegroundColor Cyan
