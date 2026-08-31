[CmdletBinding()]
param(
  [string]$Prefix = 'http://127.0.0.1:8765/',
  [string]$AgentToken = '',
  [int]$StaleDays = 90
)

$ErrorActionPreference = 'Stop'
Import-Module ActiveDirectory

function Write-JsonResponse {
  param($Context, $StatusCode, $Payload)
  $json = $Payload | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $Context.Response.StatusCode = $StatusCode
  $Context.Response.ContentType = 'application/json; charset=utf-8'
  $Context.Response.Headers.Add('Access-Control-Allow-Origin','*')
  $Context.Response.Headers.Add('Access-Control-Allow-Headers','X-IAM-Agent-Token,Content-Type')
  $Context.Response.ContentLength64 = $bytes.Length
  $Context.Response.OutputStream.Write($bytes,0,$bytes.Length)
  $Context.Response.OutputStream.Close()
}

function Test-Authorized {
  param($Context)
  if ([string]::IsNullOrWhiteSpace($AgentToken)) { return $true }
  return [string]$Context.Request.Headers['X-IAM-Agent-Token'] -eq $AgentToken
}

function Get-ADSnapshot {
  $now = Get-Date
  $cutoff = $now.AddDays(-$StaleDays)
  $domain = Get-ADDomain
  $forest = Get-ADForest
  $users = @(Get-ADUser -Filter * -Properties Enabled,LastLogonDate,PasswordLastSet,Manager,WhenCreated,UserPrincipalName,SamAccountName)
  $groups = @(Get-ADGroup -Filter * -Properties GroupScope,GroupCategory,WhenCreated)
  $computers = @(Get-ADComputer -Filter * -Properties Enabled,LastLogonDate,OperatingSystem,OperatingSystemVersion,WhenCreated)
  $dcs = @(Get-ADDomainController -Filter * | Select-Object HostName,IPv4Address,Site,OperatingSystem,IsGlobalCatalog,IsReadOnly)

  $enabledUsers = @($users | Where-Object Enabled)
  $disabledUsers = @($users | Where-Object { -not $_.Enabled })
  $staleUsers = @($enabledUsers | Where-Object { -not $_.LastLogonDate -or $_.LastLogonDate -lt $cutoff })
  $noManager = @($enabledUsers | Where-Object { [string]::IsNullOrWhiteSpace($_.Manager) })
  $staleComputers = @($computers | Where-Object { $_.Enabled -and (-not $_.LastLogonDate -or $_.LastLogonDate -lt $cutoff) })

  $privilegedGroupNames = @('Domain Admins','Enterprise Admins','Schema Admins','Administrators','Account Operators','Backup Operators','Server Operators','Print Operators')
  $privilegedGroups = @($groups | Where-Object { $privilegedGroupNames -contains $_.Name })
  $privilegedMemberships = @()
  foreach ($group in $privilegedGroups) {
    try {
      $members = @(Get-ADGroupMember -Identity $group.DistinguishedName -Recursive | Where-Object objectClass -eq 'user')
      foreach ($member in $members) { $privilegedMemberships += [pscustomobject]@{ Group=$group.Name; User=$member.SamAccountName } }
    } catch {}
  }

  [pscustomobject]@{
    source = 'ad'
    domain = $domain.DNSRoot
    forest = $forest.Name
    domainControllerCount = $dcs.Count
    userCount = $users.Count
    enabledUserCount = $enabledUsers.Count
    disabledUserCount = $disabledUsers.Count
    groupCount = $groups.Count
    computerCount = $computers.Count
    staleUserCount = $staleUsers.Count
    staleComputerCount = $staleComputers.Count
    usersWithoutManager = $noManager.Count
    privilegedUsers = @($privilegedMemberships | Select-Object -ExpandProperty User -Unique).Count
    privilegedGroupCount = $privilegedGroups.Count
    domainControllers = $dcs
    collectedAt = (Get-Date).ToUniversalTime().ToString('o')
    staleDays = $StaleDays
  }
}

$listener = [Net.HttpListener]::new()
$listener.Prefixes.Add($Prefix)
$listener.Start()
Write-Host "IAM AD Agent listening on $Prefix"
Write-Host "Press Ctrl+C to stop."

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    if ($context.Request.HttpMethod -eq 'OPTIONS') {
      $context.Response.StatusCode = 204
      $context.Response.Headers.Add('Access-Control-Allow-Origin','*')
      $context.Response.Headers.Add('Access-Control-Allow-Headers','X-IAM-Agent-Token,Content-Type')
      $context.Response.Headers.Add('Access-Control-Allow-Methods','GET,OPTIONS')
      $context.Response.Close()
      continue
    }

    if (-not (Test-Authorized $context)) {
      Write-JsonResponse $context 401 @{ error='Unauthorized' }
      continue
    }

    switch ($context.Request.Url.AbsolutePath) {
      '/health' {
        Write-JsonResponse $context 200 @{ status='ok'; version='1.0.0'; domain=(Get-ADDomain).DNSRoot; collectedAt=(Get-Date).ToUniversalTime().ToString('o') }
      }
      '/snapshot' {
        Write-JsonResponse $context 200 (Get-ADSnapshot)
      }
      default {
        Write-JsonResponse $context 404 @{ error='Not found'; endpoints=@('/health','/snapshot') }
      }
    }
  } catch {
    try { Write-JsonResponse $context 500 @{ error=$_.Exception.Message } } catch {}
  }
}
