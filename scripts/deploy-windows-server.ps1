#Requires -RunAsAdministrator
<#
.SYNOPSIS
  End-to-end deployment of IAM Intelligence (dashboard + optional collector) onto a
  fresh Windows Server: Node.js, IIS, the reverse proxy for the collector, the
  collector itself as a Windows Service, and (optionally) a real trusted HTTPS
  certificate via win-acme (Let's Encrypt).

.DESCRIPTION
  This turns the manual steps in RUNBOOK.md and collector\README.md into one
  repeatable, logged script. It is idempotent - safe to re-run - it checks
  "is this already done?" before doing each step, the same pattern the rest of
  this repo's setup scripts already use.

  IMPORTANT - things this script CANNOT do for you, because they require a
  human in the Entra admin center, not a server-side command:
    - Creating the Entra app registration
    - Uploading the collector's certificate to that app registration
    - Granting admin consent for the application permissions
  It stops and tells you exactly when you've reached that point.

  This has not been run end-to-end in an automated test (no Windows machine
  was available to the assistant that wrote it) - it is built from the same
  commands already documented and manually verified in RUNBOOK.md and
  collector\README.md, wired together and logged. Watch the first real run
  closely and check the log file it writes.

.PARAMETER SiteName
  IIS site name AND app pool name AND Windows Service name base - used
  consistently everywhere instead of IIS's generic "Default Web Site", so
  everything this script touches is clearly this product's, not a leftover
  default.

.PARAMETER HostName
  The public DNS name this dashboard will be reached at (e.g.
  dashboard.yourcompany.com). Required for the HTTPS binding and for the ACME
  certificate step. DNS for this name must already point at this server - the
  script does not and cannot configure DNS.

.PARAMETER RepoPath
  Where to clone/update the git checkout. Defaults to C:\iam-intelligence\src.

.PARAMETER SitePath
  Where IIS actually serves the built dashboard from. Kept separate from
  RepoPath so a rebuild never leaves the live site in a half-copied state -
  the script builds in RepoPath, then robocopies the finished dist\ here only
  after a successful build.

.PARAMETER WithCollector
  Also set up the collector: install its dependencies, generate its
  certificate and collectorToken, install it as a Windows Service (NSSM), and
  wire the IIS reverse proxy (URL Rewrite + ARR) so a remote browser can reach
  it through this same site's HTTPS.

.PARAMETER EnableAcme
  Obtain a real trusted HTTPS certificate from Let's Encrypt via win-acme and
  bind it to the IIS site, with automatic renewal (win-acme installs its own
  scheduled task for this). Requires -HostName and -AcmeEmail, and requires
  that HostName's DNS already resolves to this server on port 80 (Let's
  Encrypt's HTTP-01 challenge needs to reach this machine from the internet).

.PARAMETER AcmeEmail
  Contact address Let's Encrypt will use for renewal/expiry notices. Required
  with -EnableAcme.

.PARAMETER NssmPath
  Path to nssm.exe if you already have it. If omitted and -WithCollector is
  set, the script downloads it from nssm.cc (the tool's own official site -
  same one the manual instructions in collector\README.md point you to).

.EXAMPLE
  .\deploy-windows-server.ps1 -HostName dashboard.contoso.com -WithCollector -EnableAcme -AcmeEmail admin@contoso.com

.EXAMPLE
  # Dashboard only, no collector, no public HTTPS cert (internal-only, plain HTTP or a cert you bind yourself):
  .\deploy-windows-server.ps1 -SiteName IAMIntelligence
#>
[CmdletBinding()]
param(
  [string]$SiteName = 'IAMIntelligence',
  [string]$HostName,
  [string]$RepoUrl = 'https://github.com/aspireitech/entra-iam-intelligence.git',
  [string]$RepoBranch = 'main',
  [string]$RepoPath = 'C:\iam-intelligence\src',
  [string]$SitePath = 'C:\iam-intelligence\site',
  [switch]$WithCollector,
  [switch]$EnableAcme,
  [string]$AcmeEmail,
  [string]$NssmPath,
  [string]$LogDir = 'C:\iam-intelligence\deploy-logs'
)

$ErrorActionPreference = 'Stop'
# PowerShell 7+ can otherwise treat a native command's routine stderr chatter
# (robocopy, nssm, wacs.exe all write informational text there sometimes) as a
# terminating error under $ErrorActionPreference='Stop'. This script checks
# exit codes explicitly where it matters instead - don't let that PS7-only
# behavior second-guess those checks. Harmless on Windows PowerShell 5.1
# (ships with Windows Server), where this variable doesn't exist.
if (Test-Path variable:global:PSNativeCommandUseErrorActionPreference) { $PSNativeCommandUseErrorActionPreference = $false }

# ---------------------------------------------------------------------------
# Logging - every step writes to both the console and a timestamped log file,
# so "did every dependency actually complete" has a durable answer afterwards,
# not just whatever scrolled past in the terminal.
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LogFile = Join-Path $LogDir "deploy-$(Get-Date -Format 'yyyyMMdd-HHmmss').log"
$script:StepResults = [ordered]@{}

function Write-Log {
  param([string]$Message, [ValidateSet('INFO', 'OK', 'WARN', 'ERROR', 'STEP')] [string]$Level = 'INFO')
  $line = "[{0}] [{1}] {2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
  $color = switch ($Level) { 'OK' { 'Green' }; 'WARN' { 'Yellow' }; 'ERROR' { 'Red' }; 'STEP' { 'Cyan' }; default { 'Gray' } }
  Write-Host $line -ForegroundColor $color
  Add-Content -Path $LogFile -Value $line
}

# Wraps one named step: logs start/success/failure, records pass/fail for the
# final summary, and lets the caller decide (via -Critical) whether a failure
# here should stop the whole deployment or just be recorded and skipped past.
function Invoke-Step {
  param(
    [Parameter(Mandatory)] [string]$Name,
    [Parameter(Mandatory)] [scriptblock]$Action,
    [switch]$Critical
  )
  Write-Log "--- $Name ---" -Level STEP
  try {
    & $Action
    $script:StepResults[$Name] = 'OK'
    Write-Log "$Name : OK" -Level OK
  } catch {
    $script:StepResults[$Name] = "FAILED: $($_.Exception.Message)"
    Write-Log "$Name : FAILED - $($_.Exception.Message)" -Level ERROR
    if ($Critical) {
      Write-Log "This step is required for the rest of the deployment - stopping here. See $LogFile for full detail." -Level ERROR
      Write-Summary
      exit 1
    }
  }
}

function Write-Summary {
  Write-Log "===================== DEPLOYMENT SUMMARY =====================" -Level STEP
  foreach ($key in $script:StepResults.Keys) {
    $result = $script:StepResults[$key]
    $level = if ($result -eq 'OK') { 'OK' } else { 'ERROR' }
    Write-Log ("{0,-55} {1}" -f $key, $result) -Level $level
  }
  Write-Log "Full log: $LogFile" -Level INFO
}

Write-Log "IAM Intelligence deployment starting. Site='$SiteName' HostName='$HostName' WithCollector=$WithCollector EnableAcme=$EnableAcme" -Level STEP
Write-Log "Log file: $LogFile"

if ($EnableAcme -and (-not $HostName -or -not $AcmeEmail)) {
  throw "-EnableAcme requires both -HostName and -AcmeEmail."
}

# ---------------------------------------------------------------------------
# 1. Prerequisites: elevation, OS check
# ---------------------------------------------------------------------------
Invoke-Step -Critical -Name 'Elevation check' -Action {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)
  if (-not $isAdmin) { throw "Must run from an elevated (Run as Administrator) PowerShell session." }
  Write-Log "Running elevated on $(Get-CimInstance Win32_OperatingSystem | Select-Object -ExpandProperty Caption)"
}

# ---------------------------------------------------------------------------
# 2. Node.js
# ---------------------------------------------------------------------------
Invoke-Step -Critical -Name 'Node.js installed (20+)' -Action {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
      throw "Node.js is not installed and winget is not available to install it automatically. Install Node.js 22 LTS manually from https://nodejs.org/en/download/ and re-run this script."
    }
    Write-Log "Node.js not found - installing via winget..."
    winget install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements | Out-String | ForEach-Object { Write-Log $_ }
    # winget updates PATH for new shells, not this one - refresh from the
    # registry so `node`/`npm` resolve without requiring a manual restart.
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Get-Command node -ErrorAction SilentlyContinue
    if (-not $node) { throw "Node.js install via winget did not put node.exe on PATH - open a fresh elevated PowerShell window and re-run this script." }
  }
  $version = (& node --version)
  $major = [int]($version.TrimStart('v').Split('.')[0])
  if ($major -lt 20) { throw "Node.js $version found, but 20+ is required (22.5+ if -WithCollector)." }
  if ($WithCollector -and $major -lt 22) { Write-Log "Node.js $version found - collector needs 22.5+ for its built-in SQLite. Consider upgrading." -Level WARN }
  Write-Log "Node.js $version, npm $(& npm --version)"
}

Invoke-Step -Critical -Name 'Git installed' -Action {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      Write-Log "Git not found - installing via winget..."
      winget install --id Git.Git --exact --accept-package-agreements --accept-source-agreements | Out-String | ForEach-Object { Write-Log $_ }
      $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw "Git is required. Install Git for Windows manually and re-run." }
  }
  Write-Log (& git --version)
}

# ---------------------------------------------------------------------------
# 3. Get the code
# ---------------------------------------------------------------------------
Invoke-Step -Critical -Name 'Clone or update repository' -Action {
  New-Item -ItemType Directory -Path (Split-Path -Parent $RepoPath) -Force | Out-Null
  if (Test-Path (Join-Path $RepoPath '.git')) {
    Write-Log "Repository already present at $RepoPath - fetching latest $RepoBranch..."
    Push-Location $RepoPath
    try {
      git fetch origin $RepoBranch
      git checkout $RepoBranch
      git reset --hard "origin/$RepoBranch"
    } finally { Pop-Location }
  } else {
    Write-Log "Cloning $RepoUrl (branch $RepoBranch) into $RepoPath..."
    git clone --branch $RepoBranch $RepoUrl $RepoPath
  }
  Write-Log "Repository at commit $(git -C $RepoPath rev-parse --short HEAD)"
}

# ---------------------------------------------------------------------------
# 4. Dashboard: configure, install, build
# ---------------------------------------------------------------------------
Invoke-Step -Critical -Name 'Dashboard: configure .env.production' -Action {
  $envFile = Join-Path $RepoPath '.env.production'
  if (-not (Test-Path $envFile)) {
    $lines = @(
      '# Generated by deploy-windows-server.ps1 - do not commit.'
      'VITE_ENTRA_CLIENT_ID=ab342dfc-cab4-45f3-acdb-3e49d606f418'
      'VITE_ENTRA_AUTHORITY=https://login.microsoftonline.com/organizations'
    )
    if ($WithCollector) {
      $lines += 'VITE_COLLECTOR_URL=https://REPLACE-WITH-YOUR-HOSTNAME/collector-api'
      $lines += 'VITE_COLLECTOR_TOKEN=REPLACE-AFTER-COLLECTOR-SETUP-BELOW'
      if ($HostName) { $lines[-2] = "VITE_COLLECTOR_URL=https://$HostName/collector-api" }
    }
    $lines | Set-Content -Path $envFile -Encoding UTF8
    Write-Log "Created $envFile - review it (especially VITE_COLLECTOR_TOKEN once step 7 below prints the real token) before relying on it long-term." -Level WARN
  } else {
    Write-Log "$envFile already exists - leaving it unchanged. Delete it first if you want this script to regenerate it."
  }
}

Invoke-Step -Critical -Name 'Dashboard: npm install' -Action {
  Push-Location $RepoPath
  try { npm install 2>&1 | ForEach-Object { Write-Log $_ } } finally { Pop-Location }
}

Invoke-Step -Critical -Name 'Dashboard: npm run build' -Action {
  Push-Location $RepoPath
  try { npm run build 2>&1 | ForEach-Object { Write-Log $_ } } finally { Pop-Location }
  if (-not (Test-Path (Join-Path $RepoPath 'dist\index.html'))) { throw "Build did not produce dist\index.html." }
}

# ---------------------------------------------------------------------------
# 5. IIS
# ---------------------------------------------------------------------------
Invoke-Step -Critical -Name 'IIS: install role and management tools' -Action {
  # Web-Scripting-Tools is the one that actually ships the WebAdministration
  # PowerShell module used throughout this script (New-Website, Get-Website,
  # etc.) - Web-Mgmt-Console only installs the GUI, not the cmdlets.
  $features = @('Web-Server', 'Web-Common-Http', 'Web-Static-Content', 'Web-Default-Doc', 'Web-Http-Errors', 'Web-Http-Logging', 'Web-Mgmt-Console', 'Web-Scripting-Tools')
  $result = Install-WindowsFeature -Name $features -IncludeManagementTools
  Write-Log "IIS feature install result: Success=$($result.Success) RestartNeeded=$($result.RestartNeeded)"
  if ($result.RestartNeeded -eq 'Yes') { Write-Log "Windows reports a restart is needed after installing IIS - reboot and re-run this script if later steps behave oddly." -Level WARN }
  Import-Module WebAdministration -ErrorAction Stop
}

Invoke-Step -Critical -Name "IIS: create site '$SiteName'" -Action {
  New-Item -ItemType Directory -Path $SitePath -Force | Out-Null
  Import-Module WebAdministration -ErrorAction Stop

  if (-not (Test-Path "IIS:\AppPools\$SiteName")) {
    New-WebAppPool -Name $SiteName | Out-Null
    Write-Log "Created app pool '$SiteName'."
  } else {
    Write-Log "App pool '$SiteName' already exists."
  }
  # Static files only (no server-side rendering) - no managed .NET runtime needed.
  Set-ItemProperty "IIS:\AppPools\$SiteName" -Name managedRuntimeVersion -Value ''

  if (-not (Get-Website -Name $SiteName -ErrorAction SilentlyContinue)) {
    $bindingInfo = if ($HostName) { "*:80:$HostName" } else { "*:80:" }
    New-Website -Name $SiteName -PhysicalPath $SitePath -ApplicationPool $SiteName -Port 80 -HostHeader $HostName | Out-Null
    Write-Log "Created site '$SiteName' bound to $bindingInfo -> $SitePath."
  } else {
    Set-ItemProperty "IIS:\Sites\$SiteName" -Name physicalPath -Value $SitePath
    Write-Log "Site '$SiteName' already exists - repointed its physical path to $SitePath."
  }
}

Invoke-Step -Critical -Name 'Deploy: copy dist\ to the live site path' -Action {
  # robocopy /MIR mirrors exactly - deletes anything in SitePath that's no
  # longer in the new build, so a removed asset from a previous release
  # doesn't linger. Exit codes 0-7 are success for /MIR; 8+ is a real failure.
  $result = robocopy (Join-Path $RepoPath 'dist') $SitePath /MIR /NFL /NDL /NP
  if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE." }
  Write-Log "Copied dist\ -> $SitePath (robocopy exit code $LASTEXITCODE, 0-7 is success)."
}

# ---------------------------------------------------------------------------
# 6. Collector (optional)
# ---------------------------------------------------------------------------
if ($WithCollector) {
  $CollectorDir = Join-Path $RepoPath 'collector'

  Invoke-Step -Critical -Name 'Collector: npm install' -Action {
    Push-Location $CollectorDir
    try { npm install 2>&1 | ForEach-Object { Write-Log $_ } } finally { Pop-Location }
  }

  Invoke-Step -Name 'Collector: generate certificate (Graph auth)' -Action {
    $certPem = Join-Path $CollectorDir 'certs\collector.pem'
    if (Test-Path $certPem) {
      Write-Log "Certificate already present at $certPem - leaving it as is (regenerating invalidates the one already uploaded to Entra)."
    } else {
      node (Join-Path $CollectorDir 'scripts\generate-cert.js') 2>&1 | ForEach-Object { Write-Log $_ }
      if (-not (Test-Path $certPem)) { throw "Certificate generation did not produce $certPem." }
    }
  }

  Invoke-Step -Critical -Name 'Collector: tenants.json + collectorToken' -Action {
    $tenantsJson = Join-Path $CollectorDir 'tenants.json'
    if (-not (Test-Path $tenantsJson)) {
      Copy-Item (Join-Path $CollectorDir 'tenants.example.json') $tenantsJson
      Write-Log "Created tenants.json from the example."
    } else {
      Write-Log "tenants.json already exists - leaving its tenant list/clientId as configured, only checking the token below."
    }
    $config = Get-Content $tenantsJson -Raw | ConvertFrom-Json
    if (-not $config.collectorToken -or $config.collectorToken -eq 'REPLACE-WITH-A-LONG-RANDOM-TOKEN') {
      node (Join-Path $CollectorDir 'scripts\generate-token.js') 2>&1 | ForEach-Object { Write-Log $_ }
      $config = Get-Content $tenantsJson -Raw | ConvertFrom-Json
    }
    Write-Log "collectorToken is set. IMPORTANT: copy it into $RepoPath\.env.production as VITE_COLLECTOR_TOKEN, then re-run this script (or just re-run 'npm run build' + the copy step) so the dashboard is built with the matching token." -Level WARN
    Write-Log "STILL REQUIRED MANUALLY - this script cannot do this part: edit tenants.json's tenant id(s), upload certs\collector.pem to the Entra app registration's Certificates & secrets blade, and grant admin consent for the application permissions. See collector\README.md sections 2-3." -Level WARN
  }

  Invoke-Step -Critical -Name 'Collector: install as Windows Service (NSSM)' -Action {
    $nssm = $NssmPath
    if (-not $nssm) { $found = Get-Command nssm -ErrorAction SilentlyContinue; if ($found) { $nssm = $found.Source } }
    if (-not $nssm -or -not (Test-Path $nssm)) {
      Write-Log "nssm.exe not found - downloading from nssm.cc (the tool's own official site)..."
      $nssmZip = Join-Path $env:TEMP 'nssm.zip'
      Invoke-WebRequest -Uri 'https://nssm.cc/release/nssm-2.24.zip' -OutFile $nssmZip
      $nssmExtract = Join-Path $env:TEMP 'nssm-extract'
      Expand-Archive -Path $nssmZip -DestinationPath $nssmExtract -Force
      $nssm = Get-ChildItem -Path $nssmExtract -Recurse -Filter 'nssm.exe' | Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1 -ExpandProperty FullName
      if (-not $nssm) { throw "Could not find nssm.exe (win64) after extracting the download - check https://nssm.cc/download and pass -NssmPath manually." }
      Write-Log "Downloaded NSSM to $nssm"
    }

    $node = (Get-Command node).Source
    $serviceName = "$SiteName-Collector"
    $logDirSvc = Join-Path $CollectorDir 'logs'
    New-Item -ItemType Directory -Path $logDirSvc -Force | Out-Null

    if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
      Write-Log "Service '$serviceName' already exists - stopping it to reconfigure."
      & $nssm stop $serviceName | Out-Null
      & $nssm remove $serviceName confirm | Out-Null
    }
    & $nssm install $serviceName $node (Join-Path $CollectorDir 'index.js')
    & $nssm set $serviceName AppDirectory $CollectorDir
    & $nssm set $serviceName AppStdout (Join-Path $logDirSvc 'collector.out.log')
    & $nssm set $serviceName AppStderr (Join-Path $logDirSvc 'collector.err.log')
    & $nssm set $serviceName AppRotateFiles 1
    & $nssm set $serviceName AppRotateBytes 5242880
    & $nssm set $serviceName Start SERVICE_AUTO_START
    & $nssm set $serviceName AppExit Default Restart
    & $nssm set $serviceName AppRestartDelay 15000
    & $nssm set $serviceName AppThrottle 5000
    Start-Service -Name $serviceName
    Start-Sleep -Seconds 3
    $svc = Get-Service -Name $serviceName
    if ($svc.Status -ne 'Running') { throw "Service '$serviceName' did not reach Running state (status: $($svc.Status)). Check $logDirSvc\collector.err.log - this is expected to fail until tenants.json's manual Entra steps above are complete." }
    Write-Log "Service '$serviceName' is Running."
  }

  Invoke-Step -Critical -Name 'IIS: install URL Rewrite + ARR (collector reverse proxy)' -Action {
    $needsReset = $false
    if (-not (Get-WebGlobalModule -Name 'RewriteModule' -ErrorAction SilentlyContinue)) {
      Write-Log "Installing URL Rewrite module..."
      $msi = Join-Path $env:TEMP 'urlrewrite.msi'
      Invoke-WebRequest -Uri 'https://download.microsoft.com/download/1/2/8/128E2E22-C1B9-44A4-BE2A-5859ED1D4592/rewrite_amd64_en-US.msi' -OutFile $msi
      Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait
      $needsReset = $true
    } else { Write-Log "URL Rewrite already installed." }

    if (-not (Get-WebGlobalModule -Name 'ApplicationRequestRouting' -ErrorAction SilentlyContinue)) {
      Write-Log "Installing Application Request Routing (ARR)..."
      $msi = Join-Path $env:TEMP 'arr.msi'
      Invoke-WebRequest -Uri 'https://download.microsoft.com/download/e/9/8/e9849d6a-020e-47e4-9fd0-a023e99b54eb/requestRouter_amd64.msi' -OutFile $msi
      Start-Process msiexec.exe -ArgumentList "/i `"$msi`" /quiet /norestart" -Wait
      $needsReset = $true
    } else { Write-Log "ARR already installed." }

    if ($needsReset) {
      Import-Module WebAdministration -ErrorAction Stop
      Set-WebConfigurationProperty -pspath 'MACHINE/WEBROOT/APPHOST' -filter 'system.webServer/proxy' -name 'enabled' -value 'True'
      Write-Log "Restarting IIS to load the newly installed modules (required before web.config's <rewrite> section is safe to add - see collector\README.md)..."
      iisreset | Out-String | ForEach-Object { Write-Log $_ }
    }
  }

  Invoke-Step -Critical -Name 'IIS: write collector reverse-proxy web.config' -Action {
    # Written into the repo's public\ folder (not directly into SitePath) so it
    # survives every future `npm run build` on this server, matching
    # collector\README.md's guidance - Vite copies public\* into dist\ as-is,
    # and the "copy dist to SitePath" step above then carries it to the live site.
    $webConfigPath = Join-Path $RepoPath 'public\web.config'
    @'
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Collector API reverse proxy" stopProcessing="true">
          <match url="^collector-api/(.*)" />
          <action type="Rewrite" url="http://127.0.0.1:8766/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
'@ | Set-Content -Path $webConfigPath -Encoding UTF8
    Write-Log "Wrote $webConfigPath. Rebuilding and redeploying so it reaches the live site..."
    Push-Location $RepoPath
    try { npm run build 2>&1 | ForEach-Object { Write-Log $_ } } finally { Pop-Location }
    $result = robocopy (Join-Path $RepoPath 'dist') $SitePath /MIR /NFL /NDL /NP
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE while redeploying with web.config." }
  }
}

# ---------------------------------------------------------------------------
# 7. ACME / Let's Encrypt certificate (optional)
# ---------------------------------------------------------------------------
if ($EnableAcme) {
  Invoke-Step -Name 'ACME: obtain trusted HTTPS certificate (win-acme)' -Action {
    $wacsDir = 'C:\iam-intelligence\win-acme'
    $wacsExe = Join-Path $wacsDir 'wacs.exe'
    if (-not (Test-Path $wacsExe)) {
      Write-Log "Downloading win-acme (latest release from its official GitHub releases)..."
      $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/win-acme/win-acme/releases/latest' -Headers @{ 'User-Agent' = 'iam-intelligence-deploy-script' }
      $asset = $release.assets | Where-Object { $_.name -match 'win-x64\.pluggable\.zip$' } | Select-Object -First 1
      if (-not $asset) { $asset = $release.assets | Where-Object { $_.name -match 'win-x64.*\.zip$' } | Select-Object -First 1 }
      if (-not $asset) { throw "Could not find a win-x64 zip asset in the latest win-acme release - check https://github.com/win-acme/win-acme/releases and download it manually to $wacsDir." }
      Write-Log "Selected asset: $($asset.name) ($($asset.browser_download_url))"
      New-Item -ItemType Directory -Path $wacsDir -Force | Out-Null
      $zipPath = Join-Path $env:TEMP $asset.name
      Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $zipPath
      Expand-Archive -Path $zipPath -DestinationPath $wacsDir -Force
      if (-not (Test-Path $wacsExe)) { throw "Extracted win-acme but did not find wacs.exe at $wacsExe - check $wacsDir." }
    } else {
      Write-Log "win-acme already present at $wacsExe."
    }

    Write-Log "Requesting a certificate for $HostName via win-acme's IIS plugin - this binds it to site '$SiteName' and installs win-acme's own scheduled task for automatic renewal."
    Write-Log "This requires $HostName's DNS to already point at this server, reachable on port 80 from the internet (Let's Encrypt's HTTP-01 challenge)." -Level WARN
    # --target iis has been win-acme's stable flag for "get a cert for an IIS
    # site" across recent major versions, but CLI flags for command-line tools
    # do shift between versions - if this specific call errors on an
    # unrecognized-argument message rather than a DNS/reachability one, run
    # "wacs.exe --help" (in $wacsDir) and adjust the flags below to match
    # whatever version was just downloaded.
    & $wacsExe --target iis --siteid (Get-Website -Name $SiteName).Id --installation iis --accepttos --emailaddress $AcmeEmail --verbose 2>&1 | ForEach-Object { Write-Log $_ }
    if ($LASTEXITCODE -ne 0) { throw "win-acme exited with code $LASTEXITCODE - see the output above. Common causes: DNS for $HostName doesn't point here yet, port 80 isn't reachable from the internet, or this win-acme version uses different flags (run '$wacsExe --help' to check)." }
    Write-Log "Certificate obtained and bound. win-acme's own scheduled task ('win-acme renew (...)') will renew it automatically before it expires - verify with: Get-ScheduledTask | Where-Object TaskName -like 'win-acme*'"
  }
}

# ---------------------------------------------------------------------------
# 8. Final validation pass
# ---------------------------------------------------------------------------
Invoke-Step -Name 'Validate: dashboard responds over HTTP' -Action {
  $uri = if ($HostName) { "http://$HostName/" } else { "http://localhost/" }
  $response = Invoke-WebRequest -Uri $uri -UseBasicParsing -TimeoutSec 15
  if ($response.StatusCode -ne 200) { throw "Expected HTTP 200 from $uri, got $($response.StatusCode)." }
  Write-Log "$uri responded 200 OK."
}

if ($EnableAcme -and $HostName) {
  Invoke-Step -Name 'Validate: dashboard responds over HTTPS' -Action {
    $response = Invoke-WebRequest -Uri "https://$HostName/" -UseBasicParsing -TimeoutSec 15
    if ($response.StatusCode -ne 200) { throw "Expected HTTPS 200 from https://$HostName/, got $($response.StatusCode)." }
    Write-Log "https://$HostName/ responded 200 OK with a trusted certificate."
  }
}

if ($WithCollector) {
  Invoke-Step -Name 'Validate: collector Windows Service is running' -Action {
    $svc = Get-Service -Name "$SiteName-Collector" -ErrorAction Stop
    if ($svc.Status -ne 'Running') { throw "Service status is $($svc.Status), expected Running." }
    Write-Log "Service '$SiteName-Collector' is Running."
  }
  Invoke-Step -Name 'Validate: collector /health reachable through the reverse proxy' -Action {
    $config = Get-Content (Join-Path $RepoPath 'collector\tenants.json') -Raw | ConvertFrom-Json
    $scheme = if ($EnableAcme -and $HostName) { 'https' } else { 'http' }
    $host_ = if ($HostName) { $HostName } else { 'localhost' }
    $response = Invoke-WebRequest -Uri "$scheme`://$host_/collector-api/health" -Headers @{ 'X-IAM-Collector-Token' = $config.collectorToken } -UseBasicParsing -TimeoutSec 15
    if ($response.StatusCode -ne 200) { throw "Expected HTTP 200, got $($response.StatusCode). A 404 usually means the IIS reverse proxy isn't set up correctly; a 502 means the collector service isn't actually listening yet (expected until the manual Entra steps are done)." }
    Write-Log "Collector reachable through the proxy: $($response.Content)"
  }
}

Write-Summary
Write-Log "Deployment script finished. Review any WARN/ERROR lines above and in $LogFile." -Level STEP
Write-Log "Manual steps that MUST still be done by a human, if not already: (1) create/verify the Entra app registration, (2) upload collector\certs\collector.pem to it and grant admin consent, (3) put the real collectorToken into $RepoPath\.env.production as VITE_COLLECTOR_TOKEN and re-run the build+deploy steps, (4) point $HostName's DNS at this server if you haven't already." -Level WARN
