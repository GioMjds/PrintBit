#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Registers PrintBit as a Windows Scheduled Task for kiosk startup.

.DESCRIPTION
    Creates a scheduled task "PrintBit Kiosk" that:
    - Triggers at user logon or machine startup
    - Runs with highest privileges
    - Launches start-kiosk.bat from the scripts\ directory
    - Supports SYSTEM principal for cross-account kiosk deployments

.EXAMPLE
    # Run from Administrator PowerShell:
    .\scripts\install-startup.ps1

    # To remove the task later:
    .\scripts\install-startup.ps1 -Uninstall
#>

param(
    [switch]$Uninstall,
    [switch]$AtStartup,
    [switch]$RunAsSystem
)

$TaskName = "PrintBit Kiosk"
$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BatPath = Join-Path $ScriptsDir "start-kiosk.bat"

if ($Uninstall) {
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
        Write-Host "[PrintBit] Scheduled task '$TaskName' removed." -ForegroundColor Green
    } else {
        Write-Host "[PrintBit] Task '$TaskName' not found -- nothing to remove." -ForegroundColor Yellow
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
    -Argument ("/c `"" + $BatPath + "`"") `
    -WorkingDirectory (Split-Path $BatPath)

$Trigger = if ($AtStartup) {
    New-ScheduledTaskTrigger -AtStartup
} else {
    New-ScheduledTaskTrigger -AtLogOn
}

$Settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$useSystemPrincipal = $AtStartup -or $RunAsSystem
$Principal = if ($useSystemPrincipal) {
    New-ScheduledTaskPrincipal `
        -UserId "SYSTEM" `
        -RunLevel Highest `
        -LogonType ServiceAccount
} else {
    New-ScheduledTaskPrincipal `
        -UserId $env:USERNAME `
        -RunLevel Highest `
        -LogonType Interactive
}

$TaskDescription = if ($AtStartup) {
    "Starts PrintBit kiosk launcher at machine startup (SYSTEM principal)."
} elseif ($RunAsSystem) {
    "Starts PrintBit kiosk launcher at logon using SYSTEM principal."
} else {
    "Starts PrintBit server with MyPublicWiFi hotspot on login."
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $Action `
    -Trigger $Trigger `
    -Settings $Settings `
    -Principal $Principal `
    -Description $TaskDescription | Out-Null

Write-Host ""
Write-Host "[PrintBit] Scheduled task '$TaskName' installed!" -ForegroundColor Green
if ($useSystemPrincipal) {
    if ($AtStartup) {
        Write-Host "[PrintBit]   Runs at machine startup as SYSTEM." -ForegroundColor Cyan
    } else {
        Write-Host "[PrintBit]   Runs at logon as SYSTEM." -ForegroundColor Cyan
    }
} else {
    Write-Host "[PrintBit]   Runs at logon as $env:USERNAME with admin privileges." -ForegroundColor Cyan
}
Write-Host "[PrintBit]   To remove: .\scripts\install-startup.ps1 -Uninstall" -ForegroundColor DarkGray
Write-Host ""
