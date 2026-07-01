$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Printing

$iterations = 5
$results = @()

for ($i = 1; $i -le $iterations; $i++) {
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $ps = New-Object System.Printing.LocalPrintServer
  $queue = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')
  $queue.Refresh()
  $jobs = $queue.GetPrintJobInfoCollection()
  $sw.Stop()
  Write-Host ("Iter {0}: {1} ms ({2} jobs)" -f $i, $sw.ElapsedMilliseconds, $jobs.Count)
}