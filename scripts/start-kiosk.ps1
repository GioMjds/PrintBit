<#
.SYNOPSIS
    PrintBit Kiosk Startup Script
    Self-elevates to Administrator, starts the PrintBit server,
    and launches Microsoft Edge in fullscreen kiosk mode.

.DESCRIPTION
    Drop this in your scripts\ folder alongside start-kiosk.bat.
    Double-click run.bat (or this file) — no manual "Run as Admin" needed.

.EXAMPLE
    Double-click run.bat   ← easiest
    Right-click → Run with PowerShell
#>

# ── 1. SELF-ELEVATION ────────────────────────────────────────────────────────
$currentPrincipal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = $currentPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "[PrintBit] Not running as admin — re-launching elevated..." -ForegroundColor Yellow
    $psArgs = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`""
    Start-Process powershell.exe -ArgumentList $psArgs -Verb RunAs
    exit
}

# ── 2. RESOLVE PATHS ─────────────────────────────────────────────────────────
$ScriptsDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir  = Split-Path -Parent $ScriptsDir
$Port        = "3000"
$kioskLockdown = if ($env:PRINTBIT_KIOSK_LOCKDOWN) { $env:PRINTBIT_KIOSK_LOCKDOWN } else { 'true' }
$usbExportEnabled = if ($env:PRINTBIT_USB_EXPORT_ENABLED) { $env:PRINTBIT_USB_EXPORT_ENABLED } else { 'false' }

Write-Host ""
Write-Host "╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "║         PrintBit Kiosk Launcher          ║" -ForegroundColor Cyan
Write-Host "╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""
Write-Host "[PrintBit] Project  : $ProjectDir"  -ForegroundColor Gray
Write-Host "[PrintBit] Port     : $Port"         -ForegroundColor Gray
Write-Host "[PrintBit] Lockdown : $kioskLockdown" -ForegroundColor Gray
Write-Host "[PrintBit] USB Export Enabled : $usbExportEnabled" -ForegroundColor Gray
Write-Host ""

# ── 3. VERIFY DEPENDENCIES ───────────────────────────────────────────────────
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "[PrintBit] ERROR: pnpm not found." -ForegroundColor Red
    Write-Host "           Install it with: npm install -g pnpm" -ForegroundColor Yellow
    Read-Host  "           Press Enter to exit"
    exit 1
}

$edgePath = "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edgePath)) {
    $edgePath = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
}
if (-not (Test-Path $edgePath)) {
    Write-Host "[PrintBit] ERROR: Microsoft Edge not found." -ForegroundColor Red
    Read-Host  "           Press Enter to exit"
    exit 1
}

# ── 4. VERIFY WINDOWS TIME (W32Time / NTP) ───────────────────────────────────
Write-Host "[PrintBit] Verifying Windows Time (W32Time)..." -ForegroundColor Yellow
$timeService = Get-Service -Name "W32Time" -ErrorAction SilentlyContinue
if (-not $timeService) {
    Write-Host "[PrintBit] WARNING: W32Time service not found. Trusted timestamps may be unavailable." -ForegroundColor Yellow
} else {
    if ($timeService.Status -ne "Running") {
        Write-Host "[PrintBit] Starting W32Time service..." -ForegroundColor Yellow
        try {
            Start-Service -Name "W32Time" -ErrorAction Stop
            Start-Sleep -Seconds 2
        } catch {
            Write-Host "[PrintBit] WARNING: Failed to start W32Time: $($_.Exception.Message)" -ForegroundColor Yellow
        }
    }

    try {
        $w32Status = & w32tm /query /status 2>&1
        $sourceLine = $w32Status | Where-Object { $_ -match '^\s*Source:\s*' } | Select-Object -First 1
        if ($sourceLine) {
            Write-Host "[PrintBit] Time source: $sourceLine" -ForegroundColor Gray
            if ($sourceLine -match 'Local CMOS Clock|Free-running System Clock') {
                Write-Host "[PrintBit] WARNING: System clock not NTP-synced. Financial actions may be blocked." -ForegroundColor Yellow
            }
        } else {
            Write-Host "[PrintBit] WARNING: Could not determine Windows time source." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "[PrintBit] WARNING: w32tm status query failed: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

# ── 5. START PRINTBIT SERVER ─────────────────────────────────────────────────
Write-Host "[PrintBit] Starting server (pnpm run dev)..." -ForegroundColor Green

$serverProc = Start-Process cmd.exe `
    -ArgumentList "/c cd /d `"$ProjectDir`" && set PRINTBIT_KIOSK_LOCKDOWN=$kioskLockdown && set PRINTBIT_USB_EXPORT_ENABLED=$usbExportEnabled && pnpm run dev" `
    -WindowStyle Minimized `
    -PassThru

Write-Host "[PrintBit] Server PID: $($serverProc.Id)" -ForegroundColor Gray

# ── 6. WAIT FOR SERVER ───────────────────────────────────────────────────────
Write-Host "[PrintBit] Waiting for server on port $Port..." -ForegroundColor Yellow

$maxWait  = 30   # seconds
$interval = 1
$elapsed  = 0
$ready    = $false

while ($elapsed -lt $maxWait) {
    $conn = $null
    try {
        $conn = New-Object System.Net.Sockets.TcpClient
        $conn.Connect("127.0.0.1", [int]$Port)
        $ready = $true
        break
    } catch {
        Start-Sleep -Seconds $interval
        $elapsed += $interval
        Write-Host "  ...still waiting ($elapsed/$maxWait s)" -ForegroundColor DarkGray
    } finally {
        if ($conn) { $conn.Dispose() }
    }
}

if (-not $ready) {
    Write-Host "[PrintBit] WARNING: Server did not respond after $maxWait s — launching browser anyway." -ForegroundColor Yellow
}

# ── 7. RESOLVE LOCAL IP ──────────────────────────────────────────────────────
# Prefer hotspot-style ranges (e.g. 192.168.5.x / 192.168.137.x) so the
# kiosk URL matches what clients on the Wi‑Fi hotspot can actually reach.
$ipCandidates = Get-NetIPAddress -AddressFamily IPv4 |
    Where-Object { $_.IPAddress -notmatch "^127\." -and $_.PrefixOrigin -ne "WellKnown" }
$preferred = $ipCandidates |
    Where-Object { $_.IPAddress -like "192.168.5.*" -or $_.IPAddress -like "192.168.137.*" } |
    Select-Object -First 1
if (-not $preferred) {
    $preferred = $ipCandidates | Select-Object -First 1
}
$localIP = if ($preferred) { $preferred.IPAddress } else { $null }

$kioskUrl = if ($localIP) { "http://${localIP}:${Port}" } else { "http://localhost:${Port}" }
Write-Host "[PrintBit] Kiosk URL: $kioskUrl" -ForegroundColor Cyan

# ── 8. LAUNCH EDGE IN KIOSK MODE ─────────────────────────────────────────────
Write-Host "[PrintBit] Launching Edge in kiosk mode..." -ForegroundColor Green

Start-Process $edgePath -ArgumentList @(
    "--kiosk", $kioskUrl,
    "--edge-kiosk-type=fullscreen",
    "--no-first-run",
    "--disable-infobars"
)

Write-Host ""
Write-Host "[PrintBit] ✓ Kiosk is live at $kioskUrl" -ForegroundColor Green
Write-Host ""

# Keep the window open briefly so any errors are visible, then fade out
Start-Sleep -Seconds 4
