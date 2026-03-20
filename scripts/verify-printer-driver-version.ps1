#Requires -RunAsAdministrator
<#
.SYNOPSIS
  Verifies installed/default printer driver version against pinned baseline.

.DESCRIPTION
  Reads scripts\printer-driver-baseline.json and enforces an exact match on:
  - Driver version
  - Driver provider
  - Driver name
  - Win32_Printer.DriverName (driverNameFromPrinter)

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

$installedPrinters = Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop
if ($null -eq $installedPrinters -or $installedPrinters.Count -lt 1) {
  Exit-WithError -Message "No printers found on this kiosk."
}

Write-Host ""
Write-Host "[PrintBit] Printer driver pin verification" -ForegroundColor Cyan
Write-Host "[PrintBit] Baseline file: $BaselinePath" -ForegroundColor Gray
Write-Host ""

$failures = @()
foreach ($printerConfig in $baseline.printers) {
  $printer = $installedPrinters | Where-Object { $_.Name -eq $printerConfig.name } | Select-Object -First 1
  if ($null -eq $printer) {
    Write-Host "[FAIL] Printer '$($printerConfig.name)' - not installed" -ForegroundColor Red
    $failures += "Printer '$($printerConfig.name)' not installed"
    continue
  }

  $driverNameEscaped = [string]$printer.DriverName
  if ($driverNameEscaped -eq '') {
    Write-Host "[FAIL] Printer '$($printer.Name)' - missing DriverName in Win32_Printer." -ForegroundColor Red
    $failures += "Printer '$($printer.Name)' missing DriverName"
    continue
  }

  try {
    $driverFilter = "Name='$($driverNameEscaped.Replace("'", "''"))'"
    $driver = Get-CimInstance -ClassName Win32_PrinterDriver -Filter $driverFilter -ErrorAction Stop | Select-Object -First 1
  } catch {
    Write-Host "[FAIL] Printer '$($printer.Name)' - failed Win32_PrinterDriver lookup for '$($printer.DriverName)': $($_.Exception.Message)" -ForegroundColor Red
    $failures += "Printer '$($printer.Name)' driver lookup failed"
    continue
  }

  if ($null -eq $driver) {
    Write-Host "[FAIL] Printer '$($printer.Name)' - driver '$($printer.DriverName)' not found in Win32_PrinterDriver." -ForegroundColor Red
    $failures += "Printer '$($printer.Name)' driver not found"
    continue
  }

  $actual = [pscustomobject]@{
    name                  = [string]$printer.Name
    driverNameFromPrinter = [string]$printer.DriverName
    provider              = [string]$driver.DriverProviderName
    driverName            = [string]$driver.Name
    driverVersion         = [string]$driver.DriverVersion
  }

  $expected = [pscustomobject]@{
    name                  = [string]$printerConfig.name
    driverNameFromPrinter = [string]$printerConfig.driverNameFromPrinter
    provider              = [string]$printerConfig.provider
    driverName            = [string]$printerConfig.driverName
    driverVersion         = [string]$printerConfig.driverVersion
  }

  $checks = @(
    @{ Label = "[$($printerConfig.name)] Printer name";             Actual = $actual.name;                  Expected = $expected.name },
    @{ Label = "[$($printerConfig.name)] Win32_Printer.DriverName"; Actual = $actual.driverNameFromPrinter; Expected = $expected.driverNameFromPrinter },
    @{ Label = "[$($printerConfig.name)] Driver provider";          Actual = $actual.provider;              Expected = $expected.provider },
    @{ Label = "[$($printerConfig.name)] Driver name";              Actual = $actual.driverName;            Expected = $expected.driverName },
    @{ Label = "[$($printerConfig.name)] Driver version";           Actual = $actual.driverVersion;         Expected = $expected.driverVersion }
  )

  foreach ($check in $checks) {
    $passed = ($check.Actual -eq $check.Expected)
    $prefix = if ($passed) { '[PASS]' } else { '[FAIL]' }
    $color = if ($passed) { 'Green' } else { 'Red' }
    Write-Host "$prefix $($check.Label) - actual='$($check.Actual)' expected='$($check.Expected)'" -ForegroundColor $color
    if (-not $passed) {
      $failures += $check.Label
    }
  }
}

Write-Host ""
if ($failures.Count -eq 0) {
  Write-Host "[PrintBit] [OK] Driver pin verification passed for all baseline entries." -ForegroundColor Green
  exit 0
}

Write-Host "[PrintBit] [!!] Driver pin verification failed for: $($failures -join ', ')." -ForegroundColor Red
exit 1
