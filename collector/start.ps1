[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js 20+ is required. Install Node.js LTS before running the collector."
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'tenants.json'))) {
  throw "collector\tenants.json not found. Copy tenants.example.json to tenants.json and fill it in - see collector\README.md."
}

$nodeModules = Join-Path $PSScriptRoot 'node_modules'
if (-not (Test-Path $nodeModules)) {
  Write-Host 'Installing collector dependencies...' -ForegroundColor Cyan
  npm install
}

Write-Host "`nStarting IAM Intelligence Collector..." -ForegroundColor Cyan
npm start
