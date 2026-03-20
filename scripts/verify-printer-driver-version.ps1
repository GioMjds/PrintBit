#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Verifies installed/default printer driver version against pinned baseline.

.DESCRIPTION
  Reads scripts\printer-driver-baseline.json and enforces an exact match on:
  - Driver version
  - Driver provider
  - Driver name
  - Printer model

  Exit code:
  - 0 when matched
  - 1 on mismatch
  - 2 on configuration/lookup errors
#>

[CmdletBinding()]
param(
  [string]$BaselinePath = (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'printer-driver-baseline.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Exit-WithError {
  param(
    [Parameter(Mandatory = $true)][string]$Message,
    [int]$Code = 2
  )
  Write-Host "[PrintBit] [ERROR] $Message" -ForegroundColor Red
  exit $Code
}

if (-not (Test-Path $BaselinePath)) {
  Exit-WithError -Message "Baseline file not found: $BaselinePath"
}

try {
  $baseline = Get-Content -Path $BaselinePath -Raw | ConvertFrom-Json -ErrorAction Stop
} catch {
  Exit-WithError -Message "Failed to parse baseline JSON '$BaselinePath': $($_.Exception.Message)"
}

if ($null -eq $baseline.printers -or $baseline.printers.Count -lt 1) {
  Exit-WithError -Message "Baseline JSON must contain at least one printer entry in 'printers'."
}

$defaultPrinter = Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop | Where-Object { $_.Default -eq $true } | Select-Object -First 1
if ($null -eq $defaultPrinter) {
  Exit-WithError -Message "No default printer found on this kiosk."
}

$printerConfig = $baseline.printers | Where-Object { $_.name -eq $defaultPrinter.Name } | Select-Object -First 1
if ($null -eq $printerConfig) {
  Exit-WithError -Message "Default printer '$($defaultPrinter.Name)' is not present in baseline file."
}

try {
  $driver = Get-CimInstance -ClassName Win32_PrinterDriver -Filter "Name='$($defaultPrinter.DriverName.Replace("'", "''"))'" -ErrorAction Stop | Select-Object -First 1
} catch {
  Exit-WithError -Message "Failed to query Win32_PrinterDriver for '$($defaultPrinter.DriverName)': $($_.Exception.Message)"
}

if ($null -eq $driver) {
  Exit-WithError -Message "Printer driver '$($defaultPrinter.DriverName)' was not found in Win32_PrinterDriver."
}

$actual = [pscustomobject]@{
  name          = [string]$defaultPrinter.Name
  model         = [string]$defaultPrinter.DriverName
  provider      = [string]$driver.DriverProviderName
  driverName    = [string]$driver.Name
  driverVersion = [string]$driver.DriverVersion
}

$expected = [pscustomobject]@{
  name          = [string]$printerConfig.name
  model         = [string]$printerConfig.model
  provider      = [string]$printerConfig.provider
  driverName    = [string]$printerConfig.driverName
  driverVersion = [string]$printerConfig.driverVersion
}

$checks = @(
  @{ Label = 'Printer name';   Actual = $actual.name;          Expected = $expected.name },
  @{ Label = 'Printer model';  Actual = $actual.model;         Expected = $expected.model },
  @{ Label = 'Driver provider';Actual = $actual.provider;      Expected = $expected.provider },
  @{ Label = 'Driver name';    Actual = $actual.driverName;    Expected = $expected.driverName },
  @{ Label = 'Driver version'; Actual = $actual.driverVersion; Expected = $expected.driverVersion }
)

$failures = @()

Write-Host ""
Write-Host "[PrintBit] Printer driver pin verification" -ForegroundColor Cyan
Write-Host "[PrintBit] Baseline file: $BaselinePath" -ForegroundColor Gray
Write-Host ""

foreach ($check in $checks) {
  $passed = ($check.Actual -eq $check.Expected)
  $prefix = if ($passed) { '[PASS]' } else { '[FAIL]' }
  $color = if ($passed) { 'Green' } else { 'Red' }
  Write-Host "$prefix $($check.Label) - actual='$($check.Actual)' expected='$($check.Expected)'" -ForegroundColor $color
  if (-not $passed) {
    $failures += $check.Label
  }
}

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "[PrintBit] [OK] Driver pin verification passed for '$($actual.name)'." -ForegroundColor Green
  exit 0
}

Write-Host "[PrintBit] [!!] Driver pin verification failed for: $($failures -join ', ')." -ForegroundColor Red
exit 1
