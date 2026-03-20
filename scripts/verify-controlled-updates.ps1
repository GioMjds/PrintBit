#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Verifies controlled Windows Update policy for PrintBit kiosks.

.DESCRIPTION
  Checks registry-based policy values applied by apply-controlled-updates.ps1.
  Prints PASS/FAIL checks and exits non-zero when any policy drifts.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-DwordOrNull {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if (-not (Test-Path $Path)) { return $null }
  $item = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $null }
  if ($item.PSObject.Properties.Name -contains $Name) {
    return [int]$item.$Name
  }
  return $null
}

function Write-Check {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][bool]$Passed,
    [Parameter(Mandatory = $true)][string]$Detail
  )
  $prefix = if ($Passed) { '[PASS]' } else { '[FAIL]' }
  $color = if ($Passed) { 'Green' } else { 'Red' }
  Write-Host "$prefix $Name - $Detail" -ForegroundColor $color
}

$windowsUpdatePolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
$autoUpdatePolicy    = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
$printBitState       = 'HKLM:\SOFTWARE\PrintBit\ControlledUpdates'

$applied = Get-DwordOrNull -Path $printBitState -Name 'Applied'
$featureDefer = Get-DwordOrNull -Path $windowsUpdatePolicy -Name 'DeferFeatureUpdates'
$featureDays = Get-DwordOrNull -Path $windowsUpdatePolicy -Name 'DeferFeatureUpdatesPeriodInDays'
$qualityDefer = Get-DwordOrNull -Path $windowsUpdatePolicy -Name 'DeferQualityUpdates'
$qualityDays = Get-DwordOrNull -Path $windowsUpdatePolicy -Name 'DeferQualityUpdatesPeriodInDays'
$excludeDrivers = Get-DwordOrNull -Path $windowsUpdatePolicy -Name 'ExcludeWUDriversInQualityUpdate'
$noAutoUpdate = Get-DwordOrNull -Path $autoUpdatePolicy -Name 'NoAutoUpdate'
$auOptions = Get-DwordOrNull -Path $autoUpdatePolicy -Name 'AUOptions'
$scheduledDay = Get-DwordOrNull -Path $autoUpdatePolicy -Name 'ScheduledInstallDay'
$scheduledTime = Get-DwordOrNull -Path $autoUpdatePolicy -Name 'ScheduledInstallTime'
$noAutoRebootLoggedOn = Get-DwordOrNull -Path $autoUpdatePolicy -Name 'NoAutoRebootWithLoggedOnUsers'

$expectedFeatureDays = Get-DwordOrNull -Path $printBitState -Name 'ConfigFeatureDeferDays'
if ($null -eq $expectedFeatureDays) { $expectedFeatureDays = 30 }
$expectedQualityDays = Get-DwordOrNull -Path $printBitState -Name 'ConfigQualityDeferDays'
if ($null -eq $expectedQualityDays) { $expectedQualityDays = 7 }
$expectedScheduleDay = Get-DwordOrNull -Path $printBitState -Name 'ConfigMaintenanceInstallDay'
if ($null -eq $expectedScheduleDay) { $expectedScheduleDay = 0 }
$expectedScheduleHour = Get-DwordOrNull -Path $printBitState -Name 'ConfigMaintenanceInstallHour'
if ($null -eq $expectedScheduleHour) { $expectedScheduleHour = 3 }

$checks = @()
$checks += [pscustomobject]@{ Name = 'PrintBit controlled-updates state applied'; Passed = ($applied -eq 1); Detail = "Applied=$applied" }
$checks += [pscustomobject]@{ Name = 'Feature updates deferred'; Passed = ($featureDefer -eq 1); Detail = "DeferFeatureUpdates=$featureDefer" }
$checks += [pscustomobject]@{ Name = 'Feature defer days match'; Passed = ($featureDays -eq $expectedFeatureDays); Detail = "DeferFeatureUpdatesPeriodInDays=$featureDays expected=$expectedFeatureDays" }
$checks += [pscustomobject]@{ Name = 'Quality updates deferred'; Passed = ($qualityDefer -eq 1); Detail = "DeferQualityUpdates=$qualityDefer" }
$checks += [pscustomobject]@{ Name = 'Quality defer days match'; Passed = ($qualityDays -eq $expectedQualityDays); Detail = "DeferQualityUpdatesPeriodInDays=$qualityDays expected=$expectedQualityDays" }
$checks += [pscustomobject]@{ Name = 'Driver updates excluded from WU'; Passed = ($excludeDrivers -eq 1); Detail = "ExcludeWUDriversInQualityUpdate=$excludeDrivers" }
$checks += [pscustomobject]@{ Name = 'Automatic updates enabled with schedule'; Passed = ($noAutoUpdate -eq 0); Detail = "NoAutoUpdate=$noAutoUpdate" }
$checks += [pscustomobject]@{ Name = 'Scheduled install mode'; Passed = ($auOptions -eq 4); Detail = "AUOptions=$auOptions" }
$checks += [pscustomobject]@{ Name = 'Scheduled install day matches'; Passed = ($scheduledDay -eq $expectedScheduleDay); Detail = "ScheduledInstallDay=$scheduledDay expected=$expectedScheduleDay" }
$checks += [pscustomobject]@{ Name = 'Scheduled install hour matches'; Passed = ($scheduledTime -eq $expectedScheduleHour); Detail = "ScheduledInstallTime=$scheduledTime expected=$expectedScheduleHour" }
$checks += [pscustomobject]@{ Name = 'No auto-restart with logged-on users'; Passed = ($noAutoRebootLoggedOn -eq 1); Detail = "NoAutoRebootWithLoggedOnUsers=$noAutoRebootLoggedOn" }

Write-Host ""
Write-Host "[PrintBit] Controlled Windows update verification" -ForegroundColor Cyan
Write-Host ""

foreach ($check in $checks) {
  Write-Check -Name $check.Name -Passed ([bool]$check.Passed) -Detail $check.Detail
}

$failCount = ($checks | Where-Object { -not $_.Passed }).Count
Write-Host ""
if ($failCount -eq 0) {
  Write-Host "[PrintBit] [OK] All controlled-update checks passed." -ForegroundColor Green
  exit 0
}

Write-Host "[PrintBit] [!!] $failCount controlled-update check(s) failed." -ForegroundColor Red
exit 1
