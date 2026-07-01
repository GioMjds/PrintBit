$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Printing

# Submit a real print job to the spooler via AddJob
$ps = New-Object System.Printing.LocalPrintServer
$queue = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')
$queue.Refresh()
$addedJob = $queue.AddJob('PrintBit Bench Job')
Write-Host ("Submitted job #{0}" -f $addedJob.JobIdentifier)

# Give the spooler a moment to settle
Start-Sleep -Milliseconds 500

# Warm connection
$queue.Refresh() | Out-Null

function Time-Action {
  param([string]$Label, [scriptblock]$Action)
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  try { & $Action | Out-Null } catch { Write-Warning "$Label threw: $_" }
  $sw.Stop()
  Write-Host ("  {0}: {1} ms" -f $Label, $sw.ElapsedMilliseconds)
}

# Find the job
$job = $queue.GetPrintJobInfoCollection() | Where-Object { $_.JobIdentifier -eq $addedJob.JobIdentifier } | Select-Object -First 1
if (-not $job) { Write-Error "Job disappeared."; exit 1 }

Write-Host "`nWarm-path Pause/Resume:"
Time-Action "Pause 1"  { $job.Pause() }
Start-Sleep -Milliseconds 300
Time-Action "Resume 1" { $job.Resume() }
Start-Sleep -Milliseconds 300
Time-Action "Pause 2"  { $job.Pause() }
Start-Sleep -Milliseconds 300
Time-Action "Resume 2" { $job.Resume() }
Start-Sleep -Milliseconds 300
Time-Action "Pause 3"  { $job.Pause() }
Start-Sleep -Milliseconds 300
Time-Action "Resume 3" { $job.Resume() }

# Cancel
$queue.Refresh()
$job = $queue.GetPrintJobInfoCollection() | Where-Object { $_.JobIdentifier -eq $addedJob.JobIdentifier } | Select-Object -First 1
if ($job) {
  $job.Cancel()
  Write-Host "`nCancelled job #$($addedJob.JobIdentifier)"
}