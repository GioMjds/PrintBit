# Measures the wall-clock time for the same System.Printing.Pause()/Resume()
# calls the kiosk uses against the default printer. Run multiple iterations
# to surface variance. Cancels the test job at the end.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Printing

$printerName = $null
try {
  $ps = New-Object System.Printing.LocalPrintServer
  $printerName = $ps.DefaultPrintQueue.FullName
} catch {
  Write-Error "Could not read default printer."
  exit 1
}

if (-not $printerName) {
  Write-Error "No default printer configured."
  exit 1
}

Write-Host "Using printer: $printerName"

# Submit a synthetic multi-page test job so there is something to pause.
$tempDir = Join-Path $env:TEMP "printbit-bench"
New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
$testPdf = Join-Path $tempDir "bench.pdf"

# Use the synthetic PDF if it already exists; otherwise generate one.
if (-not (Test-Path $testPdf)) {
  & (Join-Path (Split-Path $PSCommandPath -Parent) "make-bench-pdf.ps1")
  if (-not (Test-Path $testPdf)) {
    Write-Error "Failed to create test PDF."
    exit 2
  }
}

Write-Host "Submitting test job from: $testPdf"
# Submit a raw print job via the Win32 API. The simplest way from PowerShell
# is to use the PrintQueue.AddJob() method, which creates an empty spool job
# the driver can populate. This avoids needing a PDF reader installed.
try {
  $ps = New-Object System.Printing.LocalPrintServer
  $queue = New-Object System.Printing.PrintQueue($ps, $printerName)
  $queue.Refresh()
  $addedJob = $queue.AddJob("PrintBit Bench Job")
  Write-Host ("Submitted job #{0}" -f $addedJob.JobIdentifier)
} catch {
  Write-Warning "AddJob() failed: $_"
  Write-Host "Falling back to print-command dispatch..."
  try {
    Get-Content $testPdf -Raw -Encoding Byte | Out-Printer -Name $printerName
    Write-Host "Out-Printer succeeded; waiting for spooler..."
  } catch {
    Write-Error "All submission paths failed: $_"
    exit 2
  }
}

# Wait for the job to appear in the spooler
$ps = New-Object System.Printing.LocalPrintServer
$queue = New-Object System.Printing.PrintQueue($ps, $printerName)
$deadline = (Get-Date).AddSeconds(15)
$job = $null
while ((Get-Date) -lt $deadline -and -not $job) {
  Start-Sleep -Milliseconds 250
  $queue.Refresh()
  foreach ($j in $queue.GetPrintJobInfoCollection()) {
    if ($j.JobIdentifier -gt 0) { $job = $j; break }
  }
}
if (-not $job) {
  Write-Error "No spooler job appeared within 15s."
  exit 3
}

Write-Host ("Latched onto job #{0}" -f $job.JobIdentifier)

function Measure-Action {
  param([string]$Label, [scriptblock]$Action)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try {
    & $Action
    $sw.Stop()
    Write-Host ("  {0}: {1} ms" -f $Label, $sw.ElapsedMilliseconds)
  } catch {
    $sw.Stop()
    Write-Host ("  {0}: FAILED after {1} ms - {2}" -f $Label, $sw.ElapsedMilliseconds, $_.Exception.Message)
  }
}

# Warm-up: first call against the driver is always slow (JIT, etc.)
Write-Host "`n--- Warm-up pass ---"
Measure-Action "Pause (warmup)"  { $job.Pause() }
Start-Sleep -Seconds 2
Measure-Action "Resume (warmup)" { $job.Resume() }

# Real measurements
Write-Host "`n--- Timed pass (5 iterations) ---"
for ($i = 1; $i -le 5; $i++) {
  Start-Sleep -Seconds 2
  Measure-Action "Pause #$i"  { $job.Pause() }
  Start-Sleep -Milliseconds 500
  Measure-Action "Resume #$i" { $job.Resume() }
}

# Cleanup: cancel the test job so we don't leave paper in the printer
Write-Host "`nCleaning up..."
try {
  $queue.Refresh()
  foreach ($j in $queue.GetPrintJobInfoCollection()) {
    if ($j.JobIdentifier -eq $job.JobIdentifier) {
      $j.Cancel()
      Write-Host "Cancelled job #$($j.JobIdentifier)"
    }
  }
} catch {
  Write-Warning "Could not cancel test job: $_"
}