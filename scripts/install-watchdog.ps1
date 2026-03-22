#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [switch]$Uninstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = "PrintBit Watchdog"
$VerifyTaskName = "PrintBit Watchdog Verifier"
$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WatchdogScript = Join-Path $ScriptsDir "watchdog.ps1"
$VerifyScript = Join-Path $ScriptsDir "verify-watchdog.ps1"

if ($Uninstall) {
    foreach ($name in @($VerifyTaskName, $TaskName)) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "[PrintBit] Removed scheduled task '$name'." -ForegroundColor Green
        } else {
            Write-Host "[PrintBit] Task '$name' not found." -ForegroundColor Yellow
        }
    }
    return
}

if (-not (Test-Path $WatchdogScript)) {
    throw "[PrintBit] watchdog.ps1 not found at $WatchdogScript"
}
if (-not (Test-Path $VerifyScript)) {
    throw "[PrintBit] verify-watchdog.ps1 not found at $VerifyScript"
}

foreach ($name in @($VerifyTaskName, $TaskName)) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $name -Confirm:$false
        Write-Host "[PrintBit] Replacing existing task '$name'..."
    }
}

$watchdogAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`""

$watchdogTrigger = New-ScheduledTaskTrigger -AtLogOn
$watchdogSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -RunLevel Highest `
    -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $watchdogAction `
    -Trigger $watchdogTrigger `
    -Settings $watchdogSettings `
    -Principal $principal `
    -Description "PrintBit watchdog loop for health polling and self-healing." | Out-Null

$verifyAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$VerifyScript`""

$verifyTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date

$verifySettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

Register-ScheduledTask `
    -TaskName $VerifyTaskName `
    -Action $verifyAction `
    -Trigger $verifyTrigger `
    -Settings $verifySettings `
    -Principal $principal `
    -Description "PrintBit secondary watchdog verifier and auto-restart task." | Out-Null

$svc = New-Object -ComObject "Schedule.Service"
$svc.Connect()
$taskDef = $svc.GetFolder("\").GetTask($VerifyTaskName).Definition
$taskDef.Triggers.Item(1).Repetition.Interval = "PT2M"
$taskDef.Triggers.Item(1).Repetition.Duration = ""   # empty = run indefinitely
$svc.GetFolder("\").RegisterTaskDefinition(
    $VerifyTaskName, $taskDef, 4, $null, $null, 3
) | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-ScheduledTask -TaskName $VerifyTaskName

Write-Host ""
Write-Host "[PrintBit] Watchdog scheduled tasks installed." -ForegroundColor Green
Write-Host "[PrintBit]   - $TaskName" -ForegroundColor Cyan
Write-Host "[PrintBit]   - $VerifyTaskName" -ForegroundColor Cyan
Write-Host "[PrintBit] To uninstall: .\scripts\install-watchdog.ps1 -Uninstall" -ForegroundColor DarkGray
Write-Host ""
