#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Registers PrintBit as a Windows Scheduled Task that runs at user login
    with Administrator privileges. This ensures the server and MyPublicWiFi
    hotspot start automatically when the kiosk machine boots.

.DESCRIPTION
    Creates a scheduled task "PrintBit Kiosk" that:
    - Triggers at user logon
    - Runs with highest privileges (admin)
    - Launches start-kiosk.bat from the scripts\ directory

.EXAMPLE
    # Run from Administrator PowerShell:
    .\scripts\install-startup.ps1

    # To remove the task later:
    .\scripts\install-startup.ps1 -Uninstall
#>

param(
    [switch]$Uninstall
)

$TaskName = "PrintBit Kiosk"
$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatPath = Join-Path $ScriptsDir "start-kiosk.bat"

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[PrintBit] Scheduled task '$TaskName' removed." -ForegroundColor Green
    } else {
        Write-Host "[PrintBit] Task '$TaskName' not found — nothing to remove." -ForegroundColor Yellow
    }
    return
}

if (-not (Test-Path $BatPath)) {
    Write-Error "[PrintBit] start-kiosk.bat not found at: $BatPath"
    return
}

# Remove existing task if present (idempotent)
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "[PrintBit] Replacing existing task..."
}

$Action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$BatPath`"" `
    -WorkingDirectory (Split-Path $BatPath)

$Trigger = New-ScheduledTaskTrigger -AtLogOn

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$Principal = New-ScheduledTaskPrincipal `
    -UserId $env:USERNAME `
    -RunLevel Highest `
    -LogonType Interactive

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description "Starts PrintBit server with MyPublicWiFi hotspot on login." | Out-Null

Write-Host ""
Write-Host "[PrintBit] ✓ Scheduled task '$TaskName' installed!" -ForegroundColor Green
Write-Host "[PrintBit]   Runs at logon as $env:USERNAME with admin privileges." -ForegroundColor Cyan
Write-Host "[PrintBit]   To remove: .\scripts\install-startup.ps1 -Uninstall" -ForegroundColor DarkGray
Write-Host ""
