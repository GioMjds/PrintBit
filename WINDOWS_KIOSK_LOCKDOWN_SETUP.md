# Windows Kiosk Lockdown Setup & Installation Guide (Issue #38)

This guide is for preparing a **Windows tablet** for PrintBit kiosk deployment with lockdown controls.

## 1) Target environment

- Windows 10/11 tablet (kiosk device)
- Dedicated kiosk local user account (`printbit`)
- Separate admin/service account for maintenance (`printbit-admin`)

## 2) Required software and drivers

Install these first:

- Node.js 22.x LTS (required for built-in `node:sqlite` support)
- pnpm `10.13.1`
- .NET 10 SDK / Runtime (required for C# worker service)
- Git
- Microsoft Edge (latest stable)
- C# Worker Service & SumatraPDF (handles print queue and dispatch in production):
  - SumatraPDF (`SumatraPDF.exe`) placed in `C:\Users\printbit\bin\SumatraPDF.exe` (or configured via worker settings)
- Printer driver package (production printer)
- Scanner driver + NAPS2 (`C:\Program Files\NAPS2\NAPS2.Console.exe`)
- Serial/USB drivers for coin acceptor / hopper controller (Node.js backend communicates with ESP32)

## 2.1) Windows Time Service & NTP baseline

Trusted financial timestamps require reliable time sync on every kiosk.

- Ensure **Windows Time** service exists and runs automatically:

```powershell
sc config w32time start= auto
Start-Service w32time
```

- Configure an NTP peer (example uses `time.windows.com`):

```powershell
w32tm /config /manualpeerlist:"time.windows.com,0x9" /syncfromflags:manual /update
Restart-Service w32time
```

- Force a sync and verify source/status:

```powershell
w32tm /resync
w32tm /query /status
```

- Confirm `Source` is **not** `Local CMOS Clock` or `Free-running System Clock`.

## 3) PrintBit app installation

### 3.1) Node.js Backend App

From the project root:

```powershell
pnpm install
pnpm run build
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

Validate launcher scripts exist:

- `scripts\start-kiosk.ps1`
- `scripts\start-kiosk.bat`
- `scripts\install-startup.ps1`

### 3.2) C# Worker Service (.NET 10)

In production kiosk mode, the C# worker handles printer spooler watching and print job dispatch.

1. Build and publish the C# worker from the `printbit-worker` repository:

   ```powershell
   cd C:\Users\Admin\Desktop\printbit-worker\src\PrintBit.HardwareService
   dotnet publish -c Release -o C:\Users\printbit\printbit-worker-service
   ```

2. Create the queue and utility directory structure under the kiosk user `printbit`:

   ```powershell
   New-Item -ItemType Directory -Path "C:\Users\printbit\printbit-worker\queue" -Force
   New-Item -ItemType Directory -Path "C:\Users\printbit\bin" -Force
   ```

3. Copy `SumatraPDF.exe` to `C:\Users\printbit\bin\SumatraPDF.exe`.
4. Register the C# worker as an auto-start Windows Service (`PrintBitHardware`):

   ```powershell
   sc.exe create PrintBitHardware binPath="C:\Users\printbit\printbit-worker-service\PrintBit.HardwareService.exe" start=auto
   sc.exe start PrintBitHardware
   ```

   _Note:_ Ensure `appsettings.json` in `C:\Users\printbit\printbit-worker-service\appsettings.json` is updated with the correct printer name and queue directory.

### 3.3) Machine-Wide Environment Variables

Configure environment variables for integration between Node.js and C# worker (run as Administrator):

```powershell
# Set the print queue directory watched by the C# worker
setx PRINTBIT_WORKER_QUEUE_DIR "C:\Users\printbit\printbit-worker\queue" /M
# Define the kiosk user name so startup scripts skip managing Edge
setx PRINTBIT_KIOSK_USER ".\printbit" /M
```

## 4) Startup automation

Run as Administrator:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup
```

This installs the scheduled tasks `PrintBit Kiosk` and `PrintBit Watchdog` for machine-start auto-run using the SYSTEM principal (recommended when kiosk and admin users differ). Since `PRINTBIT_KIOSK_USER` is configured, they will run the background server and watchdog without initiating a separate Edge instance in Session 0.

If kiosk login still cannot load `http://192.168.4.2:3000/loading` reliably, you can register startup specifically under the kiosk user logon session:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -KioskUser ".\printbit"
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -KioskUser ".\printbit"
```

This kiosk-user mode starts the server through `scripts\start-kiosk-server.ps1` (compiled runtime via `node dist\server.js`; `build:server` fallback if bundle is missing). If it does not come up, check `uploads\logs\kiosk-server-startup.log` for the startup failure reason.

## 5) Lockdown policy target (planned profile)

For Issue #38, target these controls:

- Use **Assigned Access (single-app kiosk)** as primary shell restriction
- Disable escape vectors (task switching/start/task manager/settings/system tray where policy allows)
- Disable screen-edge swipe gestures (`AllowEdgeSwipe=0`) to reduce kiosk bypass paths
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

## 5.3) Controlled Windows update policy (Issue #39)

Run as Administrator from project root:

```powershell
pnpm run updates:apply
pnpm run updates:verify
```

Defaults applied by `updates:apply`:

- Feature update defer: 30 days
- Quality update defer: 7 days
- Driver updates excluded from Windows Update quality updates
- Scheduled install: Sunday at 03:00
- No automatic reboot while users are logged on

To tune maintenance window values when needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\apply-controlled-updates.ps1 -FeatureDeferDays 30 -QualityDeferDays 7 -MaintenanceInstallDay 0 -MaintenanceInstallHour 3
```

For rollback during troubleshooting:

```powershell
pnpm run updates:revert
```

## 5.4) Printer driver version pinning

1. Update `scripts\printer-driver-baseline.json` with production values (exact match policy).
2. Verify driver pin:

```powershell
pnpm run driver:verify
```

Helpful command to collect current default-printer details before editing baseline:

```powershell
$p = Get-CimInstance Win32_Printer | ? Default
$d = Get-CimInstance Win32_PrinterDriver -Filter ("Name='" + $p.DriverName.Replace("'","''") + "'")
$p | Select-Object Name,DriverName
$d | Select-Object Name,DriverProviderName,DriverVersion
```

## 6) Assigned Access setup checklist (tablet)

1. Create/sign in dedicated local kiosk user (`printbit`).
2. Configure Assigned Access to Edge kiosk experience for PrintBit URL (`http://localhost:3000/loading`).
3. Ensure the C# worker service (`PrintBitHardware`) is installed and started.
4. Ensure the PrintBit startup and watchdog scheduled tasks are installed and enabled for the `printbit` account or machine-start (`SYSTEM`).
5. Reboot and verify the kiosk returns directly to the locked Edge kiosk experience.

## 7) Development-phase rehearsal (before tablet transfer)

Run a rehearsal on a Windows dev machine:

1. Apply lockdown profile in test user context.
2. Launch kiosk via `scripts\run.bat` or scheduled task.
3. Verify users cannot escape to desktop/settings/system tools.
4. Verify print/copy/scan core flows still work (including the C# worker dispatch).
5. Verify USB mass storage is blocked and scan USB export is unavailable.
6. Record pass/fail and remediation notes.

## 8) Validation checklist

- Kiosk auto-start works after reboot
- PrintBit reachable in kiosk mode
- C# worker service (`PrintBitHardware`) is running in Services
- Named pipes (`printbit-worker-events` and `printbit-node-errors`) are successfully connected
- Alt+Tab/Win-key/task switching vectors blocked (as supported by edition/policy)
- Screen-edge swipe gestures blocked (`AllowEdgeSwipe=0`)
- Notifications do not disrupt kiosk flow
- Settings/Task Manager inaccessible for kiosk user (`printbit`)
- USB storage blocked
- Core transaction flow (upload, pay, print) still succeeds

## 9) Maintenance / break-glass expectations

- Use admin/service account (`printbit-admin`) only for updates and troubleshooting.
- Keep a documented rollback path to temporarily relax lockdown for servicing.
- Re-apply lockdown after maintenance and re-run validation checklist.
- Re-apply controlled update policy (`pnpm run updates:apply`) and verify (`pnpm run updates:verify`) after servicing.
- Re-run driver pin verification (`pnpm run driver:verify`) before returning to public operation.
- Confirm C# worker service (`PrintBitHardware`) is active and has no pipeline errors in the event log.

## 10) Notes

- Shell Launcher can be considered only if Windows edition supports it and Assigned Access is insufficient.
- This guide is paired with C# worker and Node-side configurations.
- `apply-kiosk-lockdown.ps1` includes an optional `-DisableWinKeys` flag to apply Scancode Map key blocking (requires reboot).
