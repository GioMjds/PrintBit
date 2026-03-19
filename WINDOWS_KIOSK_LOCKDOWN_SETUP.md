# Windows Kiosk Lockdown Setup & Installation Guide (Issue #38)

This guide is for preparing a **Windows tablet** for PrintBit kiosk deployment with lockdown controls.

## 1) Target environment

- Windows 10/11 tablet (kiosk device)
- Dedicated kiosk local user account
- Separate admin/service account for maintenance

## 2) Required software and drivers

Install these first:

- Node.js 20.x LTS
- pnpm `10.13.1`
- Git
- Microsoft Edge (latest stable)
- `bin/SumatraPDF.exe` present in project
- MyPublicWiFi
- Printer driver package (production printer)
- Scanner driver + NAPS2 (`C:\Program Files\NAPS2\NAPS2.Console.exe`)
- Serial/USB drivers for coin acceptor / hopper controller

## 3) PrintBit app installation

From the project root:

```powershell
pnpm install
pnpm run build
pnpm exec tsc --noEmit
```

Validate launcher scripts exist:

- `scripts\start-kiosk.ps1`
- `scripts\start-kiosk.bat`
- `scripts\install-startup.ps1`

## 4) Startup automation

Run as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1
```

This installs the scheduled task `PrintBit Kiosk` for auto-start at login.

## 5) Lockdown policy target (planned profile)

For Issue #38, target these controls:

- Use **Assigned Access (single-app kiosk)** as primary shell restriction
- Disable escape vectors (task switching/start/task manager/settings/system tray where policy allows)
- Suppress notifications/action center popups
- Block USB mass storage at OS level
- Keep PrintBit scan delivery on wireless/QR path (USB export disabled in lockdown)

## 5.1) App lockdown environment flags

Set these environment values on kiosk startup:

- `PRINTBIT_KIOSK_LOCKDOWN=true`
- `PRINTBIT_USB_EXPORT_ENABLED=false`

These are already set by `scripts\run.bat` and defaulted by kiosk startup scripts.

## 5.2) Apply / verify / revert lockdown scripts

Run as Administrator from project root:

```powershell
pnpm run lockdown:apply
pnpm run lockdown:verify
```

For maintenance windows:

```powershell
pnpm run lockdown:revert
```

Then re-apply and verify before returning the device to public use.

## 6) Assigned Access setup checklist (tablet)

1. Create/sign in dedicated kiosk user.
2. Configure Assigned Access to Edge kiosk experience for PrintBit URL.
3. Ensure PrintBit startup task works under kiosk login.
4. Reboot and verify kiosk returns directly to locked app flow.

## 7) Development-phase rehearsal (before tablet transfer)

Run a rehearsal on a Windows dev machine:

1. Apply lockdown profile in test user context.
2. Launch kiosk via `scripts\run.bat` or scheduled task.
3. Verify users cannot escape to desktop/settings/system tools.
4. Verify print/copy/scan core flows still work.
5. Verify USB mass storage is blocked and scan USB export is unavailable.
6. Record pass/fail and remediation notes.

## 8) Validation checklist

- Kiosk auto-start works after reboot
- PrintBit reachable in kiosk mode
- Alt+Tab/Win-key/task switching vectors blocked (as supported by edition/policy)
- Notifications do not disrupt kiosk flow
- Settings/Task Manager inaccessible for kiosk user
- USB storage blocked
- Core transaction flow (upload, pay, print) still succeeds

## 9) Maintenance / break-glass expectations

- Use admin/service account only for updates and troubleshooting.
- Keep a documented rollback path to temporarily relax lockdown for servicing.
- Re-apply lockdown after maintenance and re-run validation checklist.

## 10) Notes

- Shell Launcher can be considered only if Windows edition supports it and Assigned Access is insufficient.
- This guide is paired with `plan.md` tasks for implementing scripts, app-level USB gating, and formal verification artifacts.
- `apply-kiosk-lockdown.ps1` includes an optional `-DisableWinKeys` flag to apply Scancode Map key blocking (requires reboot).
