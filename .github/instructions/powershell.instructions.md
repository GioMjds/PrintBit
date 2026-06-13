---
applyTo: 'scripts/**/*.ps1,**/*.ps1'
---

# PrintBit — PowerShell script conventions

## Runtime target

- All scripts run on **Windows PowerShell 5.1** (not PowerShell Core 7+) in the kiosk environment.
- Do not use PowerShell 7+ syntax or cmdlets unless the script is explicitly marked PS7+.

## Encoding

- Always save scripts as **UTF-8 with BOM** (`UTF8BOM` encoding) to avoid PowerShell 5.1 character issues.
- When writing file output from scripts, explicitly specify `-Encoding UTF8` or use `[System.IO.File]::WriteAllText` with UTF-8 BOM.

## Kiosk user context

- The kiosk runs under the `printbit` Windows user account.
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

## Kiosk lockdown

- USB mass storage is disabled by design in lockdown mode — scripts must not attempt to re-enable it.
- Shell Launcher / Assigned Access configuration targets the kiosk browser and PrintBit app only.
