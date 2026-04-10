[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptsDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptsDir
$LogDir = Join-Path $ProjectDir "uploads\logs"
$LogPath = Join-Path $LogDir "kiosk-server-startup.log"

if (-not (Test-Path $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
}

function Write-StartupLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss.fff")
    Add-Content -Path $LogPath -Value "[$timestamp] $Message"
}

function Get-DevCommandCandidates {
    $candidates = [System.Collections.Generic.List[object]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    $commands = @(
        @{ Name = "pnpm.cmd"; Args = @("run", "dev") },
        @{ Name = "pnpm"; Args = @("run", "dev") },
        @{ Name = "corepack.cmd"; Args = @("pnpm", "run", "dev") },
        @{ Name = "corepack"; Args = @("pnpm", "run", "dev") }
    )

    foreach ($entry in $commands) {
        $resolved = Get-Command $entry.Name -ErrorAction SilentlyContinue
        if ($null -eq $resolved) {
            continue
        }
        $path = [string]$resolved.Source
        if ([string]::IsNullOrWhiteSpace($path)) {
            continue
        }
        $key = "$path|$($entry.Args -join ' ')"
        if (-not $seen.Add($key)) {
            continue
        }
        $candidates.Add([pscustomobject]@{
            Label = $entry.Name
            Path = $path
            Args = [string[]]$entry.Args
        }) | Out-Null
    }

    foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if ([string]::IsNullOrWhiteSpace($root)) {
            continue
        }
        foreach ($entry in @(
            @{ Relative = "nodejs\pnpm.cmd"; Label = "programfiles-pnpm.cmd"; Args = @("run", "dev") },
            @{ Relative = "nodejs\corepack.cmd"; Label = "programfiles-corepack.cmd"; Args = @("pnpm", "run", "dev") }
        )) {
            $path = Join-Path $root $entry.Relative
            if (-not (Test-Path $path)) {
                continue
            }
            $key = "$path|$($entry.Args -join ' ')"
            if (-not $seen.Add($key)) {
                continue
            }
            $candidates.Add([pscustomobject]@{
                Label = $entry.Label
                Path = $path
                Args = [string[]]$entry.Args
            }) | Out-Null
        }
    }

    return $candidates
}

Set-Location -Path $ProjectDir

if ([string]::IsNullOrWhiteSpace($env:PRINTBIT_KIOSK_LOCKDOWN)) {
    $env:PRINTBIT_KIOSK_LOCKDOWN = "true"
}
if ([string]::IsNullOrWhiteSpace($env:PRINTBIT_USB_EXPORT_ENABLED)) {
    $env:PRINTBIT_USB_EXPORT_ENABLED = "false"
}

Write-StartupLog "Starting kiosk server task. user=$([Security.Principal.WindowsIdentity]::GetCurrent().Name) projectDir=$ProjectDir"
Write-StartupLog "Environment PRINTBIT_KIOSK_LOCKDOWN=$($env:PRINTBIT_KIOSK_LOCKDOWN) PRINTBIT_USB_EXPORT_ENABLED=$($env:PRINTBIT_USB_EXPORT_ENABLED)"

$candidates = Get-DevCommandCandidates
if ($candidates.Count -eq 0) {
    $message = "[PrintBit] No pnpm/corepack command is available for this account. Install Node.js (with corepack) for all users."
    Write-StartupLog $message
    throw $message
}

$attemptLabels = [string[]]($candidates | ForEach-Object { $_.Label })
Write-StartupLog "Command candidates: $($attemptLabels -join ', ')"

$errors = [System.Collections.Generic.List[string]]::new()
foreach ($candidate in $candidates) {
    $display = "$($candidate.Path) $($candidate.Args -join ' ')"
    Write-StartupLog "Attempting: $display"
    try {
        & $candidate.Path @($candidate.Args) 2>&1 | Tee-Object -FilePath $LogPath -Append
        $exitCode = $LASTEXITCODE
        if ($null -eq $exitCode -or $exitCode -eq 0) {
            Write-StartupLog "Process exited successfully for: $display"
            exit 0
        }
        $failure = "Command exited with code ${exitCode}: $display"
        $errors.Add($failure) | Out-Null
        Write-StartupLog $failure
    } catch {
        $failure = "Command failed: $display :: $($_.Exception.Message)"
        $errors.Add($failure) | Out-Null
        Write-StartupLog $failure
    }
}

$errorSummary = if ($errors.Count -gt 0) { ([string[]]$errors) -join " | " } else { "unknown" }
$finalMessage = "[PrintBit] Unable to start kiosk server. Tried: $($attemptLabels -join ', '). Errors: $errorSummary"
Write-StartupLog $finalMessage
throw $finalMessage
