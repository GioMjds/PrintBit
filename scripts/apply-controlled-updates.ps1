#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Applies controlled Windows Update policy for PrintBit kiosks.

.DESCRIPTION
  Configures standalone kiosks to:
  - Defer feature/quality updates
  - Exclude driver updates from Windows quality updates
  - Schedule installs inside a maintenance window
  - Prevent automatic reboots while an operator is logged in

  Original registry values are snapshotted into:
  HKLM:\SOFTWARE\PrintBit\ControlledUpdates
#>

[CmdletBinding()]
param(
  [ValidateRange(0, 365)][int]$FeatureDeferDays = 30,
  [ValidateRange(0, 30)][int]$QualityDeferDays = 7,
  [ValidateRange(0, 7)][int]$MaintenanceInstallDay = 0,
  [ValidateRange(0, 23)][int]$MaintenanceInstallHour = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$helpersModule = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'kiosk-helpers.psm1'
Import-Module $helpersModule -Force

function Test-RegistryValueExists {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if (-not (Test-Path $Path)) { return $false }
  $item = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $false }
  return ($item.PSObject.Properties.Name -contains $Name)
}

function Save-OriginalDwordValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $suffix = Get-StateKeySuffix -Path $Path -Name $Name
  $existsStateName = "OriginalExists_$suffix"
  $valueStateName = "OriginalValue_$suffix"

  if (Test-RegistryValueExists -Path $printBitState -Name $existsStateName) {
    return
  }

  $current = Get-DwordValueOrNull -Path $Path -Name $Name
  if ($null -eq $current) {
    Set-DwordValue -Path $printBitState -Name $existsStateName -Value 0
    return
  }

  Set-DwordValue -Path $printBitState -Name $existsStateName -Value 1
  Set-DwordValue -Path $printBitState -Name $valueStateName -Value $current
}

$windowsUpdatePolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
$autoUpdatePolicy    = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
$printBitState       = 'HKLM:\SOFTWARE\PrintBit\ControlledUpdates'

Ensure-RegistryKey -Path $printBitState

$policyTargets = @(
  @{ Path = $windowsUpdatePolicy; Name = 'DeferFeatureUpdates';                Value = 1 },
  @{ Path = $windowsUpdatePolicy; Name = 'DeferFeatureUpdatesPeriodInDays';    Value = $FeatureDeferDays },
  @{ Path = $windowsUpdatePolicy; Name = 'DeferQualityUpdates';                Value = 1 },
  @{ Path = $windowsUpdatePolicy; Name = 'DeferQualityUpdatesPeriodInDays';    Value = $QualityDeferDays },
  @{ Path = $windowsUpdatePolicy; Name = 'ExcludeWUDriversInQualityUpdate';    Value = 1 },
  @{ Path = $autoUpdatePolicy;    Name = 'NoAutoUpdate';                       Value = 0 },
  @{ Path = $autoUpdatePolicy;    Name = 'AUOptions';                          Value = 4 },
  @{ Path = $autoUpdatePolicy;    Name = 'ScheduledInstallDay';                Value = $MaintenanceInstallDay },
  @{ Path = $autoUpdatePolicy;    Name = 'ScheduledInstallTime';               Value = $MaintenanceInstallHour },
  @{ Path = $autoUpdatePolicy;    Name = 'NoAutoRebootWithLoggedOnUsers';      Value = 1 }
)

Write-Host "[PrintBit] Applying controlled Windows update policy..." -ForegroundColor Cyan

foreach ($target in $policyTargets) {
  Save-OriginalDwordValue -Path $target.Path -Name $target.Name
  Set-DwordValue -Path $target.Path -Name $target.Name -Value ([int]$target.Value)
}

Set-DwordValue -Path $printBitState -Name 'Applied' -Value 1
Set-DwordValue -Path $printBitState -Name 'ConfigFeatureDeferDays' -Value $FeatureDeferDays
Set-DwordValue -Path $printBitState -Name 'ConfigQualityDeferDays' -Value $QualityDeferDays
Set-DwordValue -Path $printBitState -Name 'ConfigMaintenanceInstallDay' -Value $MaintenanceInstallDay
Set-DwordValue -Path $printBitState -Name 'ConfigMaintenanceInstallHour' -Value $MaintenanceInstallHour
New-ItemProperty -Path $printBitState -Name 'AppliedAtUtc' -Value ([DateTime]::UtcNow.ToString('o')) -PropertyType String -Force | Out-Null
New-ItemProperty -Path $printBitState -Name 'Version' -Value '1' -PropertyType String -Force | Out-Null

Write-Host ""
Write-Host "[PrintBit] [OK] Controlled update policy applied." -ForegroundColor Green
Write-Host "[PrintBit]   Maintenance install schedule: day=$MaintenanceInstallDay hour=$MaintenanceInstallHour" -ForegroundColor Gray
Write-Host "[PrintBit]   Next steps:" -ForegroundColor Cyan
Write-Host "[PrintBit]   1) Run scripts\verify-controlled-updates.ps1" -ForegroundColor Gray
Write-Host "[PrintBit]   2) Run scripts\verify-printer-driver-version.ps1" -ForegroundColor Gray
Write-Host ""
