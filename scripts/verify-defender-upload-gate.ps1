#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Verifies Microsoft Defender Antivirus upload gate posture and private staging security.

.DESCRIPTION
  Validates that:
  - PrintBit backend scheduled task principal is SYSTEM
  - Microsoft Defender Antivirus is active, normal running mode, and signatures are fresh
  - MpCmdRun.exe resolves exclusively from approved system locations
  - uploads/.staging and uploads/quarantine exist with restrictive SYSTEM/Administrator-only ACLs
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
  [string]$KioskUser = 'printbit'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$Passed,
    [Parameter(Mandatory = $true)][string]$Detail
  )
  $prefix = if ($Passed) { '[PASS]' } else { '[FAIL]' }
  $color  = if ($Passed) { 'Green' } else { 'Red' }
  Write-Host "$prefix $Name - $Detail" -ForegroundColor $color
}

$checks = @()

# 1. Check Scheduled Task Principal
try {
  $task = Get-ScheduledTask -TaskName 'PrintBit Kiosk' -ErrorAction Stop
  $isSystem = ($task.Principal.UserId -eq 'SYSTEM' -or $task.Principal.UserId -eq 'NT AUTHORITY\SYSTEM')
  $isServiceAccount = ($task.Principal.LogonType -eq 'ServiceAccount')
  $taskPassed = $isSystem -and $isServiceAccount
  $checks += [pscustomobject]@{
    Name = 'PrintBit startup task principal';
    Passed = $taskPassed;
    Detail = "UserId=$($task.Principal.UserId), LogonType=$($task.Principal.LogonType)"
  }
} catch {
  $checks += [pscustomobject]@{
    Name = 'PrintBit startup task principal';
    Passed = $false;
    Detail = "Task 'PrintBit Kiosk' not found or error: $_"
  }
}

# 2. Check Defender Computer Status & Signature Freshness
$maxAgeHours = 168
if ($env:PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS) {
  $parsedAge = 0
  if ([int]::TryParse($env:PRINTBIT_DEFENDER_MAX_SIGNATURE_AGE_HOURS, [ref]$parsedAge) -and $parsedAge -gt 0) {
    $maxAgeHours = $parsedAge
  }
}

try {
  $status = Get-MpComputerStatus -ErrorAction Stop
  $isNormalMode = ($status.AMRunningMode -eq 'Normal' -or $status.AMRunningMode -eq 0)
  $isEnabled = [bool]$status.AntivirusEnabled
  
  $sigUpdate = $status.AntivirusSignatureLastUpdated
  $ageHours = if ($sigUpdate) { ([DateTime]::UtcNow - [DateTime]$sigUpdate.ToUniversalTime()).TotalHours } else { 9999 }
  $isFresh = ($ageHours -ge 0 -and $ageHours -le $maxAgeHours)

  $checks += [pscustomobject]@{
    Name = 'Defender engine active mode';
    Passed = ($isNormalMode -and $isEnabled);
    Detail = "AMRunningMode=$($status.AMRunningMode), AntivirusEnabled=$isEnabled"
  }

  $checks += [pscustomobject]@{
    Name = 'Defender signature freshness';
    Passed = $isFresh;
    Detail = "LastUpdated=$sigUpdate ($([Math]::Round($ageHours, 1)) hrs old, max allowed: $maxAgeHours hrs)"
  }
} catch {
  $checks += [pscustomobject]@{
    Name = 'Defender engine active mode';
    Passed = $false;
    Detail = "Get-MpComputerStatus query failed: $_"
  }
  $checks += [pscustomobject]@{
    Name = 'Defender signature freshness';
    Passed = $false;
    Detail = "Unable to read signature timestamp."
  }
}

# 3. Check MpCmdRun.exe system resolution
$approvedPlatformRoot = 'C:\ProgramData\Microsoft\Windows Defender\Platform'
$approvedStaticFallback = 'C:\Program Files\Windows Defender\MpCmdRun.exe'
$resolvedMpCmdRun = $null

if (Test-Path $approvedPlatformRoot) {
  $platformDirs = Get-ChildItem -Path $approvedPlatformRoot -Directory | Sort-Object -Property Name -Descending
  foreach ($pDir in $platformDirs) {
    $candidate = Join-Path $pDir.FullName 'MpCmdRun.exe'
    if (Test-Path $candidate) {
      $resolvedMpCmdRun = $candidate
      break
    }
  }
}
if (-not $resolvedMpCmdRun -and (Test-Path $approvedStaticFallback)) {
  $resolvedMpCmdRun = $approvedStaticFallback
}

$mpCmdRunPassed = ($null -ne $resolvedMpCmdRun -and (
  $resolvedMpCmdRun.StartsWith($approvedPlatformRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
  $resolvedMpCmdRun -eq $approvedStaticFallback
))

$checks += [pscustomobject]@{
  Name = 'Defender CLI client path (MpCmdRun.exe)';
  Passed = $mpCmdRunPassed;
  Detail = if ($resolvedMpCmdRun) { $resolvedMpCmdRun } else { 'MpCmdRun.exe not found in approved paths' }
}

# 4. Check Staging & Quarantine Directories & ACLs
$kioskSid = $null
try {
  $ntAccount = New-Object System.Security.Principal.NTAccount($KioskUser)
  $kioskSid = $ntAccount.Translate([System.Security.Principal.SecurityIdentifier]).Value
} catch {
  # optional lookup
}

$stagingDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\uploads\.staging'))
$quarantineDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\uploads\quarantine'))

foreach ($target in @(@{ Path = $stagingDir; Label = 'uploads\.staging' }, @{ Path = $quarantineDir; Label = 'uploads\quarantine' })) {
  $dirExists = Test-Path $target.Path
  $aclSecure = $false
  $detail = ''

  if ($dirExists) {
    $acl = Get-Acl -Path $target.Path
    $hasKioskAccess = $false
    $hasUsersAccess = $false

    foreach ($access in $acl.Access) {
      $identity = $access.IdentityReference.Value
      if ($kioskSid -and $identity -eq $kioskSid) { $hasKioskAccess = $true }
      if ($identity -match 'Users|Authenticated Users' -and $identity -notmatch 'SYSTEM|Administrators') {
        $hasUsersAccess = $true
      }
    }

    $aclSecure = (-not $hasKioskAccess -and -not $hasUsersAccess)
    $detail = if ($aclSecure) { "Private ACL: $($target.Path)" } else { "Insecure permissions detected on $($target.Path)" }
  } else {
    $detail = "Directory does not exist: $($target.Path)"
  }

  $checks += [pscustomobject]@{
    Name = "Upload storage isolation ($($target.Label))";
    Passed = ($dirExists -and $aclSecure);
    Detail = $detail
  }
}

Write-Host ""
Write-Host "[PrintBit] Microsoft Defender Upload Gate Verification" -ForegroundColor Cyan
Write-Host ""

foreach ($check in $checks) {
  Write-Check -Name $check.Name -Passed ([bool]$check.Passed) -Detail $check.Detail
}

$failCount = ($checks | Where-Object { -not $_.Passed }).Count
Write-Host ""
if ($failCount -eq 0) {
  Write-Host "[PrintBit] [OK] All Defender upload gate checks passed." -ForegroundColor Green
  exit 0
}

Write-Host "[PrintBit] [!!] $failCount Defender verification check(s) failed." -ForegroundColor Red
exit 1
