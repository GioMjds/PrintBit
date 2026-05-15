---
applyTo: 'scripts/**/*.ps1,**/*.ps1'
---

# PrintBit — PowerShell script conventions

## Runtime target

- All scripts run on **Windows PowerShell 5.1** (not PowerShell Core 7+) in the kiosk environment.
- Do not use PowerShell 7+ syntax or cmdlets unless the script is explicitly marked PS7+.

### How to mark PS7+ scripts

- Scripts that require PowerShell 7+ must include a top-of-file marker comment exactly as follows:

  # Requires: PowerShell 7+

  This marker makes the requirement explicit for reviewers and automation. Scripts without this exact marker must remain compatible with PowerShell 5.1.

### Cross-version compatibility

- When a script must support both PowerShell 5.1 and 7+, prefer writing version-gated code paths. Example pattern:

```powershell
if ($PSVersionTable.PSVersion.Major -ge 7) {
	# PS7+ implementation
} else {
	# PS5.1-compatible implementation
}
```

- Where possible, isolate PS7+-only functionality into separate scripts marked with the `# Requires: PowerShell 7+` header and call them conditionally.

## Encoding

- Always save scripts as **UTF-8 with BOM** (`UTF8BOM` encoding) to avoid PowerShell 5.1 character issues.
- When writing file output from scripts, explicitly specify `-Encoding UTF8` or use `[System.IO.File]::WriteAllText` with UTF-8 BOM.

## Kiosk user context

- The kiosk runs under the `PrintBitKiosk` Windows user account.
- Scripts that configure Assigned Access, Shell Launcher, or lockdown settings must target this account explicitly.
- Do not assume the running user is an admin; scripts that require elevation must call `Start-Process -Verb RunAs`.

## Watchdog and scheduled tasks

- Task names follow the pattern `PrintBit*` (e.g., `PrintBitWatchdog`, `PrintBitStartup`).
- Do not delete or overwrite existing scheduled tasks without checking for their existence first.
- Use `-Force` flags only when the user has explicitly requested overwrite behavior.

## Error handling

- Use `$ErrorActionPreference = 'Stop'` at the top of critical scripts.
- Wrap destructive operations in `try/catch` with meaningful error messages.
- Log to `%TEMP%\printbit-*.log` for diagnosability.

- If logging to `%TEMP%` fails (for example, due to permissions or full disk), fall back to an alternative directory such as `C:\Logs\PrintBit`:

```powershell
$logPath = "$env:TEMP\printbit-$((Get-Date).ToString('yyyyMMdd-HHmmss')).log"
try {
	New-Item -Path (Split-Path $logPath) -ItemType Directory -Force | Out-Null
	"Starting script" | Out-File -FilePath $logPath -Encoding utf8
} catch {
	$fallbackDir = 'C:\Logs\PrintBit'
	New-Item -Path $fallbackDir -ItemType Directory -Force | Out-Null
	$logPath = Join-Path $fallbackDir "printbit-$((Get-Date).ToString('yyyyMMdd-HHmmss')).log"
	"Starting script (fallback)" | Out-File -FilePath $logPath -Encoding utf8
}
```

- Ensure fallback directories are writable by the `PrintBitKiosk` account and rotate or prune logs to avoid disk growth.

## Kiosk lockdown

- USB mass storage is disabled by design in lockdown mode — scripts must not attempt to re-enable it.
- Shell Launcher / Assigned Access configuration targets the kiosk browser and PrintBit app only.
