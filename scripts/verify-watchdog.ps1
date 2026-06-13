[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptsDir
$TaskName = "PrintBit Watchdog"
$StateDir = Join-Path $ProjectDir "uploads\watchdog"
$HeartbeatPath = Join-Path $StateDir "watchdog-heartbeat.json"
$MaxHeartbeatAgeMs = 180000

function Read-HeartbeatAgeMs {
    if (-not (Test-Path $HeartbeatPath)) { return [int]::MaxValue }
    try {
        $raw = Get-Content -Path $HeartbeatPath -Raw | ConvertFrom-Json
        $ts = [string]$raw.timestamp
        if ([string]::IsNullOrWhiteSpace($ts)) { return [int]::MaxValue }
        $age = (New-TimeSpan -Start ([datetime]$ts) -End (Get-Date)).TotalMilliseconds
        if ($age -lt 0) { return 0 }
        return [int][Math]::Floor($age)
    } catch {
        return [int]::MaxValue
    }
}

function Ensure-WatchdogTaskRunning {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Write-Warning "[PrintBit] Watchdog task '$TaskName' is missing."
        return $false
    }
    if ($task.State -ne "Running") {
        Write-Warning "[PrintBit] Watchdog task is not running (state: $($task.State)); starting."
        Start-ScheduledTask -TaskName $TaskName
        Start-Sleep -Seconds 2
        return $true
    }
    return $true
}

function Test-WatchdogTriggerConfiguration {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($null -eq $task) {
        Write-Warning "[PrintBit] Watchdog task '$TaskName' is missing."
        return $false
    }
    $triggerKinds = @($task.Triggers | ForEach-Object { $_.CimClass.CimClassName })
    $hasAtStartup = $false
    foreach ($kind in $triggerKinds) {
        if ($kind -eq 'MSFT_TaskBootTrigger') {
            $hasAtStartup = $true
            break
        }
    }
    if (-not $hasAtStartup) {
        Write-Warning "[PrintBit] Watchdog task has no AtStartup trigger. Consider reinstalling with -AtStartup."
    }
    return $true
}

$running = Ensure-WatchdogTaskRunning
$triggerOk = Test-WatchdogTriggerConfiguration
$ageMs = Read-HeartbeatAgeMs

if ($ageMs -gt $MaxHeartbeatAgeMs) {
    Write-Warning "[PrintBit] Watchdog heartbeat stale ($ageMs ms). Restarting watchdog task."
    try {
        Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    } catch {
        Write-Warning "[PrintBit] Failed to stop watchdog task: $($_.Exception.Message)"
    }
    Start-ScheduledTask -TaskName $TaskName
    Start-Sleep -Seconds 2
    $ageAfterRestart = Read-HeartbeatAgeMs
    if ($ageAfterRestart -le $MaxHeartbeatAgeMs) {
        Write-Host "[PrintBit] Watchdog heartbeat recovered after restart. heartbeatAgeMs=$ageAfterRestart" -ForegroundColor Green
        exit 0
    }
    exit 1
}

if (-not $running -or -not $triggerOk) {
    exit 1
}

Write-Host "[PrintBit] Watchdog verifier OK. heartbeatAgeMs=$ageMs" -ForegroundColor Green
exit 0
