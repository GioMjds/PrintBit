#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Reverts controlled Windows Update policy for PrintBit kiosks.

.DESCRIPTION
  Restores registry values changed by apply-controlled-updates.ps1
  using saved original values in:
  HKLM:\SOFTWARE\PrintBit\ControlledUpdates
#>

[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Ensure-RegistryKey {
  param([Parameter(Mandatory = $true)][string]$Path)
  if (-not (Test-Path $Path)) {
    New-Item -Path $Path -Force | Out-Null
  }
}

function Set-DwordValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][int]$Value
  )
  Ensure-RegistryKey -Path $Path
  New-ItemProperty -Path $Path -Name $Name -Value $Value -PropertyType DWord -Force | Out-Null
}

function Remove-RegistryValueIfExists {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )
  if (-not (Test-Path $Path)) { return }
  $item = Get-ItemProperty -Path $Path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return }
  if ($item.PSObject.Properties.Name -contains $Name) {
    Remove-ItemProperty -Path $Path -Name $Name -Force -ErrorAction SilentlyContinue
  }
}

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

function Get-StateKeySuffix {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )
  return (($Path + '__' + $Name) -replace '[^A-Za-z0-9_]', '_')
}

function Restore-DwordValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  $suffix = Get-StateKeySuffix -Path $Path -Name $Name
  $existsStateName = "OriginalExists_$suffix"
  $valueStateName = "OriginalValue_$suffix"

  $originalExists = Get-DwordOrNull -Path $printBitState -Name $existsStateName
  if ($null -eq $originalExists) {
    Write-Warning "[PrintBit] Missing original-state metadata for $Path::$Name. Leaving current value unchanged."
    return
  }

  if ($originalExists -eq 1) {
    $originalValue = Get-DwordOrNull -Path $printBitState -Name $valueStateName
    if ($null -eq $originalValue) {
      throw "[PrintBit] Original value metadata missing for $Path::$Name while exists flag indicates present."
    }
    Set-DwordValue -Path $Path -Name $Name -Value $originalValue
  } else {
    Remove-RegistryValueIfExists -Path $Path -Name $Name
  }

  Remove-RegistryValueIfExists -Path $printBitState -Name $existsStateName
  Remove-RegistryValueIfExists -Path $printBitState -Name $valueStateName
}

$windowsUpdatePolicy = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate'
$autoUpdatePolicy    = 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU'
$printBitState       = 'HKLM:\SOFTWARE\PrintBit\ControlledUpdates'

Write-Host "[PrintBit] Reverting controlled Windows update policy..." -ForegroundColor Cyan

if (-not (Test-Path $printBitState)) {
  throw "[PrintBit] Cannot revert controlled updates because state key '$printBitState' does not exist. Run apply-controlled-updates.ps1 first."
}

$policyTargets = @(
  @{ Path = $windowsUpdatePolicy; Name = 'DeferFeatureUpdates' },
  @{ Path = $windowsUpdatePolicy; Name = 'DeferFeatureUpdatesPeriodInDays' },
  @{ Path = $windowsUpdatePolicy; Name = 'DeferQualityUpdates' },
  @{ Path = $windowsUpdatePolicy; Name = 'DeferQualityUpdatesPeriodInDays' },
  @{ Path = $windowsUpdatePolicy; Name = 'ExcludeWUDriversInQualityUpdate' },
  @{ Path = $autoUpdatePolicy;    Name = 'NoAutoUpdate' },
  @{ Path = $autoUpdatePolicy;    Name = 'AUOptions' },
  @{ Path = $autoUpdatePolicy;    Name = 'ScheduledInstallDay' },
  @{ Path = $autoUpdatePolicy;    Name = 'ScheduledInstallTime' },
  @{ Path = $autoUpdatePolicy;    Name = 'NoAutoRebootWithLoggedOnUsers' }
)

foreach ($target in $policyTargets) {
  Restore-DwordValue -Path $target.Path -Name $target.Name
}

Set-DwordValue -Path $printBitState -Name 'Applied' -Value 0
Remove-RegistryValueIfExists -Path $printBitState -Name 'ConfigFeatureDeferDays'
Remove-RegistryValueIfExists -Path $printBitState -Name 'ConfigQualityDeferDays'
Remove-RegistryValueIfExists -Path $printBitState -Name 'ConfigMaintenanceInstallDay'
Remove-RegistryValueIfExists -Path $printBitState -Name 'ConfigMaintenanceInstallHour'
New-ItemProperty -Path $printBitState -Name 'RevertedAtUtc' -Value ([DateTime]::UtcNow.ToString('o')) -PropertyType String -Force | Out-Null

Write-Host ""
Write-Host "[PrintBit] [OK] Controlled update policy reverted." -ForegroundColor Green
Write-Host ""
