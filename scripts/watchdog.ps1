#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [switch]$RunOnce,
    [string]$KioskUser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptsDir
$StateDir = Join-Path $ProjectDir "uploads\watchdog"
$StatePath = Join-Path $StateDir "state.json"
$HeartbeatPath = Join-Path $StateDir "watchdog-heartbeat.json"

function Get-EnvInt {
    param(
        [string]$Name,
        [int]$Default
    )
    $raw = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
    $parsed = 0
    if ([int]::TryParse($raw, [ref]$parsed) -and $parsed -gt 0) {
        return $parsed
    }
    return $Default
}

$PollIntervalMs = Get-EnvInt -Name "PRINTBIT_WATCHDOG_POLL_INTERVAL_MS" -Default 5000
$RequestTimeoutMs = Get-EnvInt -Name "PRINTBIT_WATCHDOG_HTTP_TIMEOUT_MS" -Default 3000
$RestartBaseDelayMs = Get-EnvInt -Name "PRINTBIT_WATCHDOG_RESTART_BASE_DELAY_MS" -Default 2000
$RestartMaxDelayMs = Get-EnvInt -Name "PRINTBIT_WATCHDOG_RESTART_MAX_DELAY_MS" -Default 60000
$FailureThreshold = Get-EnvInt -Name "PRINTBIT_WATCHDOG_FAILURE_ALERT_THRESHOLD" -Default 5
$Port = Get-EnvInt -Name "PRINTBIT_WATCHDOG_PORT" -Default 3000
$HealthUrl = "http://127.0.0.1:$Port/api/watchdog/health"
$ReportUrl = "http://127.0.0.1:$Port/api/watchdog/report"

function Resolve-PnpmRunDevCommand {
    $pnpmCmd = Get-Command "pnpm.cmd" -ErrorAction SilentlyContinue
    if ($pnpmCmd) {
        return "`"$($pnpmCmd.Source)`" run dev"
    }
    $pnpm = Get-Command "pnpm" -ErrorAction SilentlyContinue
    if ($pnpm) {
        return "`"$($pnpm.Source)`" run dev"
    }
    $corepackCmd = Get-Command "corepack.cmd" -ErrorAction SilentlyContinue
    if ($corepackCmd) {
        return "`"$($corepackCmd.Source)`" pnpm run dev"
    }
    $corepack = Get-Command "corepack" -ErrorAction SilentlyContinue
    if ($corepack) {
        return "`"$($corepack.Source)`" pnpm run dev"
    }
    return $null
}

$PnpmRunDevCommand = Resolve-PnpmRunDevCommand

function Get-NetworkProvider {
    $raw = [Environment]::GetEnvironmentVariable("PRINTBIT_NETWORK_PROVIDER")
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return "mypublicwifi"
    }
    return $raw.Trim().ToLowerInvariant()
}

function Get-Esp32KioskIp {
    $raw = [Environment]::GetEnvironmentVariable("PRINTBIT_ESP32_KIOSK_IP")
    if ([string]::IsNullOrWhiteSpace($raw)) {
        return "192.168.4.2"
    }
    return $raw.Trim()
}

function Should-ManageEdge {
    $raw = [Environment]::GetEnvironmentVariable("PRINTBIT_WATCHDOG_MANAGE_EDGE")
    if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $disabledTokens = @("0", "false", "no", "off")
        if ($disabledTokens -contains $raw.Trim().ToLowerInvariant()) {
            return $false
        }
    }
    try {
        $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
        if ($null -ne $currentIdentity -and $currentIdentity.Name -eq "NT AUTHORITY\SYSTEM") {
            return $false
        }
        # When a specific kiosk account is configured, only manage Edge from within
        # that account's interactive session — not from any other elevated context.
        $effectiveKioskUser = if (-not [string]::IsNullOrWhiteSpace($KioskUser)) {
            $KioskUser.Trim()
        } else {
            [Environment]::GetEnvironmentVariable("PRINTBIT_KIOSK_USER")
        }
        if (-not [string]::IsNullOrWhiteSpace($effectiveKioskUser)) {
            $kioskShort   = $effectiveKioskUser -replace '^[^\\]+\\', ''
            $currentShort = $currentIdentity.Name -replace '^[^\\]+\\', ''
            if ($kioskShort -ne $currentShort) {
                return $false
            }
        }
    } catch {
        return $false
    }
    return $true
}

$ManageEdge = Should-ManageEdge

function Get-KioskLocalIp {
    if ((Get-NetworkProvider) -eq "esp32") {
        return (Get-Esp32KioskIp)
    }

    $ipCandidates = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notmatch '^127\.' -and
        $_.PrefixOrigin -ne 'WellKnown'
    }
    $preferred = $ipCandidates |
        Where-Object {
            $_.IPAddress -like "192.168.4.*" -or
            $_.IPAddress -like "192.168.5.*" -or
            $_.IPAddress -like "192.168.137.*"
        } |
        Select-Object -First 1
    if (-not $preferred) {
        $preferred = $ipCandidates | Select-Object -First 1
    }
    if ($preferred) { return [string]$preferred.IPAddress }
    return "127.0.0.1"
}

if (-not (Test-Path $StateDir)) {
    New-Item -ItemType Directory -Path $StateDir | Out-Null
}

function Read-State {
    if (-not (Test-Path $StatePath)) {
        return [pscustomobject]@{
            running = $true
            watchdogPid = $PID
            consecutiveFailures = 0
            recoveryAttempts = 0
            backoffDelayMs = 0
            nextRecoveryAt = $null
            lastAction = "startup"
            lastError = $null
            lastUpdatedAt = (Get-Date).ToString("o")
        }
    }
    try {
        return (Get-Content -Path $StatePath -Raw | ConvertFrom-Json)
    } catch {
        return [pscustomobject]@{
            running = $true
            watchdogPid = $PID
            consecutiveFailures = 0
            recoveryAttempts = 0
            backoffDelayMs = 0
            nextRecoveryAt = $null
            lastAction = "state_parse_error"
            lastError = $_.Exception.Message
            lastUpdatedAt = (Get-Date).ToString("o")
        }
    }
}

function Write-State {
    param(
        [pscustomobject]$State
    )
    $State.running = $true
    $State.watchdogPid = $PID
    $State.lastUpdatedAt = (Get-Date).ToString("o")
    $State | ConvertTo-Json -Depth 6 | Set-Content -Path $StatePath -Encoding UTF8
}

function Update-Heartbeat {
    param(
        [string]$Status,
        [string]$Message
    )
    [pscustomobject]@{
        watchdogPid = $PID
        status = $Status
        message = $Message
        timestamp = (Get-Date).ToString("o")
    } | ConvertTo-Json -Depth 4 | Set-Content -Path $HeartbeatPath -Encoding UTF8
}

function Send-WatchdogReport {
    param(
        [pscustomobject]$State
    )
    $payload = [pscustomobject]@{
        running = $true
        watchdogPid = $PID
        consecutiveFailures = [int]$State.consecutiveFailures
        recoveryAttempts = [int]$State.recoveryAttempts
        backoffDelayMs = [int]$State.backoffDelayMs
        nextRecoveryAt = $State.nextRecoveryAt
        lastAction = [string]$State.lastAction
        lastError = $State.lastError
    } | ConvertTo-Json -Depth 4
    try {
        Invoke-RestMethod -Method Post -Uri $ReportUrl -ContentType "application/json" -Body $payload -TimeoutSec ([Math]::Max(1, [int]([Math]::Ceiling($RequestTimeoutMs / 1000.0)))) | Out-Null
    } catch {
        Write-Warning "[Watchdog] Failed to post report: $($_.Exception.Message)"
    }
}

function Get-BackoffDelayMs {
    param(
        [int]$ConsecutiveFailures
    )
    if ($ConsecutiveFailures -le 0) { return 0 }
    $delay = [double]$RestartBaseDelayMs * [Math]::Pow(2, $ConsecutiveFailures - 1)
    $bounded = [Math]::Min([double]$RestartMaxDelayMs, $delay)
    return [int][Math]::Floor($bounded)
}

function Get-NodeServerProcess {
    try {
        $candidates = Get-CimInstance Win32_Process -Filter "Name='node.exe'"
        foreach ($proc in $candidates) {
            $cmd = [string]$proc.CommandLine
            if ($cmd -match "src\\server\.ts|dist\\server\.js|pnpm run dev") {
                return $proc
            }
        }
        return $null
    } catch {
        return $null
    }
}

function Stop-ProcessSafely {
    param(
        [int]$ProcessId
    )
    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
    } catch {
        Write-Warning "[Watchdog] Failed to stop PID ${ProcessId}: $($_.Exception.Message)"
    }
}

function Ensure-ServerRunning {
    param(
        [pscustomobject]$State,
        [string]$Reason
    )
    $existing = Get-NodeServerProcess
    if ($null -ne $existing) {
        return $false
    }

    if ([string]::IsNullOrWhiteSpace($PnpmRunDevCommand)) {
        $State.lastAction = "server_start_failed"
        $State.lastError = "pnpm/corepack is not available in PATH for the watchdog task account."
        return $false
    }

    try {
        $runCommand = "/c cd /d `"$ProjectDir`" && $PnpmRunDevCommand"
        $proc = Start-Process `
            -FilePath "cmd.exe" `
            -ArgumentList $runCommand `
            -WorkingDirectory $ProjectDir `
            -WindowStyle Hidden `
            -PassThru
        if ($null -ne $proc) {
            Start-Sleep -Milliseconds 250
            if ($proc.HasExited) {
                $State.lastAction = "server_start_failed"
                $State.lastError = "Server process exited immediately while handling $Reason."
                return $false
            }
            $State.lastAction = "server_started"
            $State.lastError = $null
            return $true
        }
        $State.lastAction = "server_start_failed"
        $State.lastError = "Unable to start server process ($Reason)."
        return $false
    } catch {
        $State.lastAction = "server_start_failed"
        $State.lastError = $_.Exception.Message
        return $false
    }
}

function Ensure-EdgeRunning {
    param(
        [pscustomobject]$State
    )
    $currentKioskUrl = "http://$(Get-KioskLocalIp):$Port"
    try {
        $escapedUrl = [Regex]::Escape($currentKioskUrl)
        $kioskEdges = @(
            Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
                Where-Object {
                    $cmd = [string]$_.CommandLine
                    $cmd -match "--kiosk"
                }
        )
        foreach ($kioskEdge in $kioskEdges) {
            if ([string]$kioskEdge.CommandLine -match $escapedUrl) {
                return $false
            }
        }
        foreach ($kioskEdge in $kioskEdges) {
            Stop-ProcessSafely -ProcessId ([int]$kioskEdge.ProcessId)
        }
        if ($kioskEdges.Count -gt 0) {
            Start-Sleep -Milliseconds 500
        }
    } catch {
        Write-Warning "[Watchdog] Failed to inspect Edge command line: $($_.Exception.Message)"
    }
    try {
        Start-Process "msedge.exe" -ArgumentList @("--kiosk", $currentKioskUrl, "--edge-kiosk-type=fullscreen", "--no-first-run", "--disable-infobars")
        $State.lastAction = "edge_started"
        $State.lastError = $null
        return $true
    } catch {
        $State.lastAction = "edge_start_failed"
        $State.lastError = $_.Exception.Message
        return $false
    }
}

function Restart-Server {
    param(
        [pscustomobject]$State,
        [string]$Reason
    )
    $server = Get-NodeServerProcess
    if ($null -ne $server) {
        Stop-ProcessSafely -ProcessId ([int]$server.ProcessId)
        Start-Sleep -Milliseconds 500
    }
    return (Ensure-ServerRunning -State $State -Reason $Reason)
}

Write-Host "[Watchdog] Starting PrintBit watchdog loop on $HealthUrl"
if (-not [string]::IsNullOrWhiteSpace($KioskUser)) {
    Write-Host "[Watchdog] Kiosk account: $KioskUser"
}
$state = Read-State
$state.running = $true
$state.watchdogPid = $PID
$state.lastAction = "watchdog_started"
$state.lastError = $null
Write-State -State $state
Update-Heartbeat -Status "running" -Message "Watchdog started."
Send-WatchdogReport -State $state

if (-not $ManageEdge) {
    Write-Host "[Watchdog] Edge management disabled for this execution context."
}

while ($true) {
    $health = $null
    $healthOk = $false
    $healthError = $null

    try {
        $health = Invoke-RestMethod -Method Get -Uri $HealthUrl -SkipHttpErrorCheck -TimeoutSec ([Math]::Max(1, [int]([Math]::Ceiling($RequestTimeoutMs / 1000.0))))
        $healthOk = $true
    } catch {
        $healthError = $_.Exception.Message
        $healthOk = $false
    }

    $didRecovery = $false
    if ($healthOk) {
        $isUnhealthy = ([string]$health.status -eq "unhealthy")
        if ($isUnhealthy) {
            $state.consecutiveFailures = [int]$state.consecutiveFailures + 1
            $state.recoveryAttempts = [int]$state.recoveryAttempts + 1
            $state.backoffDelayMs = Get-BackoffDelayMs -ConsecutiveFailures ([int]$state.consecutiveFailures)
            $state.nextRecoveryAt = (Get-Date).AddMilliseconds($state.backoffDelayMs).ToString("o")
            $state.lastAction = "health_unhealthy_detected"
            $state.lastError = "Health endpoint returned unhealthy."
            Write-State -State $state
            Send-WatchdogReport -State $state

            if ($state.backoffDelayMs -gt 0) {
                Start-Sleep -Milliseconds $state.backoffDelayMs
            }

            $didRecovery = Restart-Server -State $state -Reason "health_unhealthy"
            if ($ManageEdge) {
                $null = Ensure-EdgeRunning -State $state
            }
            if ($didRecovery) {
                $state.lastAction = "recovery_restart_performed"
                $state.lastError = $null
            } else {
                $state.lastAction = "recovery_restart_skipped_or_failed"
            }
        } else {
            $state.consecutiveFailures = 0
            $state.backoffDelayMs = 0
            $state.nextRecoveryAt = $null
            $state.lastAction = "health_ok"
            $state.lastError = $null
            $null = Ensure-ServerRunning -State $state -Reason "health_ok_ensure"
            if ($ManageEdge) {
                $null = Ensure-EdgeRunning -State $state
            }
        }
    } else {
        $state.consecutiveFailures = [int]$state.consecutiveFailures + 1
        $state.recoveryAttempts = [int]$state.recoveryAttempts + 1
        $state.backoffDelayMs = Get-BackoffDelayMs -ConsecutiveFailures ([int]$state.consecutiveFailures)
        $state.nextRecoveryAt = (Get-Date).AddMilliseconds($state.backoffDelayMs).ToString("o")
        $state.lastAction = "health_unreachable"
        $state.lastError = $healthError
        Write-State -State $state
        Send-WatchdogReport -State $state

        if ($state.backoffDelayMs -gt 0) {
            Start-Sleep -Milliseconds $state.backoffDelayMs
        }

        $didRecovery = Restart-Server -State $state -Reason "health_unreachable"
        if ($ManageEdge) {
            $null = Ensure-EdgeRunning -State $state
        }
        if ($didRecovery) {
            $state.lastAction = "recovery_restart_after_unreachable"
            $state.lastError = $null
        } else {
            $state.lastAction = "recovery_restart_failed_after_unreachable"
        }
    }

    if ([int]$state.consecutiveFailures -ge $FailureThreshold) {
        Write-Warning "[Watchdog] Failure threshold reached: $($state.consecutiveFailures)"
    }

    Write-State -State $state
    Update-Heartbeat -Status "running" -Message "Loop complete. action=$($state.lastAction)"
    Send-WatchdogReport -State $state

    if ($RunOnce) { break }
    Start-Sleep -Milliseconds $PollIntervalMs
}

Write-Host "[Watchdog] Exiting watchdog loop."