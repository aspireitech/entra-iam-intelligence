[CmdletBinding()]
param(
  [string]$ServiceName = 'IAMIntelligenceCollector',
  [string]$NssmPath
)

$ErrorActionPreference = 'Stop'

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
if (-not $isAdmin) {
  throw "Removing a Windows Service requires an elevated (Run as Administrator) PowerShell session. Re-run this script from an admin prompt."
}

$nssm = $NssmPath
if (-not $nssm) {
  $found = Get-Command nssm -ErrorAction SilentlyContinue
  if ($found) { $nssm = $found.Source }
}
if (-not $nssm -or -not (Test-Path $nssm)) {
  throw "nssm.exe not found. Pass -NssmPath 'C:\path\to\nssm.exe' if it isn't on PATH."
}

$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $existing) {
  Write-Host "Service '$ServiceName' is not installed - nothing to do." -ForegroundColor Yellow
  return
}

& $nssm stop $ServiceName | Out-Null
& $nssm remove $ServiceName confirm | Out-Null
Write-Host "Service '$ServiceName' removed." -ForegroundColor Green
