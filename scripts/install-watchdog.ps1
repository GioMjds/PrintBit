#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [switch]$Uninstall,
    [switch]$AtStartup,
    [switch]$RunAsSystem,
    [string]$KioskUser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = "PrintBit Watchdog"
$VerifyTaskName = "PrintBit Watchdog Verifier"
$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$WatchdogScript = Join-Path $ScriptsDir "watchdog.ps1"
$VerifyScript = Join-Path $ScriptsDir "verify-watchdog.ps1"

function Resolve-TaskAccount {
    param([Parameter(Mandatory)][string]$UserInput)
    $raw = $UserInput.Trim()
    if ([string]::IsNullOrWhiteSpace($raw)) { throw "[PrintBit] -KioskUser cannot be empty." }
    $candidates = [System.Collections.Generic.List[string]]::new()
    $candidates.Add($raw)
    if ($raw.StartsWith(".\")) {
        $candidates.Add("$env:COMPUTERNAME\$($raw.Substring(2))")
    } elseif ($raw -notmatch "[\\@]") {
        $candidates.Add("$env:COMPUTERNAME\$raw")
    }
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $tried = [System.Collections.Generic.List[string]]::new()
    foreach ($c in $candidates) {
        if (-not $seen.Add($c)) { continue }
        $null = $tried.Add($c)
        try {
            $acct = New-Object System.Security.Principal.NTAccount($c)
            $sid  = $acct.Translate([System.Security.Principal.SecurityIdentifier])
            return [pscustomobject]@{
                AccountName = $sid.Translate([System.Security.Principal.NTAccount]).Value
                Sid         = $sid.Value
            }
        } catch { continue }
    }
    $attempted = if ($tried.Count -gt 0) { ([string[]]$tried) -join ", " } else { $raw }
    throw "[PrintBit] Failed to resolve kiosk user '$raw'. Attempted: [$attempted]. Use an existing local account like '.\PrintBitKiosk' or '$env:COMPUTERNAME\PrintBitKiosk'."
}

if (-not [string]::IsNullOrWhiteSpace($KioskUser) -and ($AtStartup -or $RunAsSystem)) {
    throw "[PrintBit] -KioskUser cannot be combined with -AtStartup or -RunAsSystem."
}

$kioskUserNormalized = if ([string]::IsNullOrWhiteSpace($KioskUser)) { $null } else { $KioskUser.Trim() }
$kioskAccount        = if ($kioskUserNormalized) { Resolve-TaskAccount -UserInput $kioskUserNormalized } else { $null }
$resolvedKioskUser   = if ($kioskAccount) { $kioskAccount.AccountName } else { $null }


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

$watchdogArg = if ($kioskUserNormalized) {
    "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`" -KioskUser `"$resolvedKioskUser`""
} else {
    "-NoProfile -ExecutionPolicy Bypass -File `"$WatchdogScript`""
}
$watchdogAction = New-ScheduledTaskAction `
    -Execute "powershell.exe" `
    -Argument $watchdogArg

$watchdogTrigger = if ($kioskUserNormalized) {
    New-ScheduledTaskTrigger -AtLogOn -User $resolvedKioskUser
} elseif ($AtStartup) {
    New-ScheduledTaskTrigger -AtStartup
} else {
    New-ScheduledTaskTrigger -AtLogOn
}
$watchdogSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1)

$useSystemPrincipal = $AtStartup -or $RunAsSystem
$principal = if ($kioskUserNormalized) {
    New-ScheduledTaskPrincipal `
        -UserId $resolvedKioskUser `
        -RunLevel Limited `
        -LogonType Interactive
} elseif ($useSystemPrincipal) {
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

$watchdogDescription = if ($kioskUserNormalized) {
    "PrintBit watchdog for health polling and self-healing scoped to kiosk account ($resolvedKioskUser)."
} elseif ($AtStartup) {
    "PrintBit watchdog loop for health polling and self-healing at startup."
} else {
    "PrintBit watchdog loop for health polling and self-healing."
}

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $watchdogAction `
    -Trigger $watchdogTrigger `
    -Settings $watchdogSettings `
    -Principal $principal `
    -Description $watchdogDescription | Out-Null

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

$TASK_UPDATE = 4
$TASK_LOGON_INTERACTIVE_TOKEN = 3
$TASK_LOGON_SERVICE_ACCOUNT = 5
$verifyLogonType = if ($kioskUserNormalized -or -not $useSystemPrincipal) {
    $TASK_LOGON_INTERACTIVE_TOKEN
} else {
    $TASK_LOGON_INTERACTIVE_TOKEN
}

$svc = New-Object -ComObject "Schedule.Service"
$svc.Connect()
$taskDef = $svc.GetFolder("\").GetTask($VerifyTaskName).Definition
$taskDef.Triggers.Item(1).Repetition.Interval = "PT2M"
$taskDef.Triggers.Item(1).Repetition.Duration = ""   # empty = run indefinitely
$svc.GetFolder("\").RegisterTaskDefinition(
    $VerifyTaskName, $taskDef, $TASK_UPDATE, $null, $null, $verifyLogonType
) | Out-Null

Start-ScheduledTask -TaskName $TaskName
Start-ScheduledTask -TaskName $VerifyTaskName

Write-Host ""
Write-Host "[PrintBit] Watchdog scheduled tasks installed." -ForegroundColor Green
Write-Host "[PrintBit]   - $TaskName" -ForegroundColor Cyan
Write-Host "[PrintBit]   - $VerifyTaskName" -ForegroundColor Cyan
if ($kioskUserNormalized) {
    Write-Host "[PrintBit]   Principal: $resolvedKioskUser (Assigned Access kiosk account)." -ForegroundColor Cyan
    Write-Host "[PrintBit]   SID: $($kioskAccount.Sid)" -ForegroundColor Gray
    Write-Host "[PrintBit]   Trigger: at logon of $resolvedKioskUser only." -ForegroundColor Cyan
} elseif ($useSystemPrincipal) {
    Write-Host "[PrintBit]   Principal: SYSTEM (startup-safe across kiosk/admin users)." -ForegroundColor Cyan
} else {
    Write-Host "[PrintBit]   Principal: $env:USERNAME (interactive user)." -ForegroundColor Cyan
}
Write-Host "[PrintBit] To uninstall: .\scripts\install-watchdog.ps1 -Uninstall" -ForegroundColor DarkGray
Write-Host ""