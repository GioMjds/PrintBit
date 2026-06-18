# PrintBit ESP32 + Windows Tablet Kiosk Setup (Windows 10/11)

This guide covers:

- repository-side setup
- Windows tablet setup
- automatic Wi-Fi connect + Task Scheduler startup
- kiosk account creation and Kiosk Mode differences between Windows 10 and 11

## 1) Prerequisites

- Windows 10/11 **Pro / Enterprise / Education** (recommended for kiosk features)
- Node.js 22.x + pnpm installed
- .NET 10 SDK / Runtime installed (required for the C# worker)
- Microsoft Edge installed
- PrintBit repo cloned on the tablet
- ESP32 flashed with current `esp32-captive-portal.ino` firmware (first boot exposes provisioning AP `PrintBit-Setup`)

## 2) Repository & C# Worker Setup

### 2.1) Node.js Backend Application

From Node app repo root:

```powershell
pnpm install
pnpm run build
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

### 2.2) C# Worker Service

Publish the C# worker from the `printbit-worker` directory (runs the queue watcher and spooler monitor):

```powershell
cd C:\Users\Admin\Desktop\printbit-worker\src\PrintBit.HardwareService
dotnet publish -c Release -o C:\Users\printbit\printbit-worker-service
```

### 2.3) Environment Variables

Set machine-wide env vars (run PowerShell):

```powershell
setx PRINTBIT_NETWORK_PROVIDER esp32 /M
setx PRINTBIT_ESP32_AP_BASE_URL http://<esp32-lan-ip> /M
setx PRINTBIT_ESP32_KIOSK_SUBNET_PREFIX <your-lan-subnet-prefix> /M
setx PRINTBIT_ESP32_KIOSK_IP <kiosk-lan-ip> /M
setx PRINTBIT_ESP32_STATIC_IP_ENFORCE true /M
setx PRINTBIT_ESP32_KIOSK_NETMASK <your-lan-netmask> /M
setx PORT 3000 /M
setx PRINTBIT_KIOSK_LOCKDOWN true /M
setx PRINTBIT_USB_EXPORT_ENABLED false /M
setx PRINTBIT_SKIP_EDGE_LAUNCH true /M
setx PRINTBIT_WATCHDOG_HTTP_TIMEOUT_MS 10000 /M
setx PRINTBIT_WATCHDOG_UNREACHABLE_RESTART_THRESHOLD 3 /M

# C# Worker integration environment variables
setx PRINTBIT_WORKER_QUEUE_DIR "C:\Users\printbit\printbit-worker\queue" /M
setx PRINTBIT_KIOSK_USER ".\printbit" /M
```

Then reboot once so services/tasks pick up new machine env vars.

## 3) Provision ESP32 Wi-Fi + runtime config (WiFiManager)

1. Power on ESP32 and connect a phone/tablet/laptop to SSID `PrintBit-Setup`.
2. Open the captive portal and submit all required fields:
   - `backend_url`
   - `device_id`
   - `api_key`
   - `printer_model`
3. Save, then wait for ESP32 to reboot and join your production Wi-Fi.
4. Put the Windows kiosk tablet on the same Wi-Fi/LAN as ESP32.
5. Set `PRINTBIT_ESP32_AP_BASE_URL` to the ESP32 LAN URL (for example `http://192.168.1.50`).

Field recovery:

- Hold the firmware reprovision button (GPIO 19, active-low) for ~5 seconds to wipe Wi-Fi + provisioning config and reopen setup mode.

## 4) Create dedicated users (recommended)

Use separate accounts:

- `printbit` (daily kiosk operation, limited user)
- `printbit-admin` (maintenance/setup, administrator)

Admin PowerShell:

```powershell
net user printbit "ReplaceWithStrongPassword1!" /add
net user printbit-admin "ReplaceWithStrongPassword2!" /add
net localgroup Administrators printbit-admin /add
```

## 5) Configure Kiosk Mode (Windows 11 vs Windows 10)

## Windows 11

1. Go to `Settings > Accounts > Other users > Set up a kiosk`.
2. Create/select local user `printbit`.
3. Choose **Microsoft Edge**.
4. Choose kiosk experience (`Digital signage` is typical).
5. Set URL to `http://<kiosk-lan-ip>:3000/loading`.

## Windows 10

1. Go to `Settings > Accounts > Family & other users > Set up assigned access`.
2. Select/create local user `printbit`.
3. Select **Microsoft Edge** as assigned app.
4. Configure start URL to `http://<kiosk-lan-ip>:3000/loading`.

Note: Windows Home has limited kiosk capabilities; Pro/Edu/Enterprise is strongly preferred.

## 6) Install C# Worker & Node Startup Tasks

### 6.1) Register C# Worker Windows Service

From the `printbit-worker` project root (Administrator PowerShell):

```powershell
# Publish C# worker
cd C:\Users\Admin\Desktop\printbit-worker\src\PrintBit.HardwareService
dotnet publish -c Release -o C:\Users\printbit\printbit-worker-service

# Create queue directory
New-Item -ItemType Directory -Path "C:\Users\printbit\printbit-worker\queue" -Force
New-Item -ItemType Directory -Path "C:\Users\printbit\bin" -Force

# Register and start Windows Service
sc.exe create PrintBitHardware binPath="C:\Users\printbit\printbit-worker-service\PrintBit.HardwareService.exe" start=auto
sc.exe start PrintBitHardware
```

### 6.2) Register Node.js Startup and Watchdog Scheduled Tasks

From the Node.js project root (Administrator PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup
pnpm run watchdog:verify
```

If your dedicated kiosk login still cannot reach `http://<kiosk-lan-ip>:3000/loading`, install the kiosk-user targeted startup task (runs only the Node server at kiosk logon session):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -KioskUser ".\printbit"
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -KioskUser ".\printbit"
```

_Note:_ `install-watchdog.ps1 -AtStartup` and `install-startup.ps1 -AtStartup` register watchdog tasks with the **SYSTEM** principal. When running as SYSTEM, the watchdog skips managing Edge because the interactive kiosk session (Assigned Access) handles the Edge lifecycle.

Launcher scripts (`start-kiosk.ps1`, `start-kiosk.bat`, `launch-kiosk.js`) honor `PRINTBIT_ESP32_KIOSK_IP` in ESP32 mode and default to `192.168.4.2` when unset.
Startup scripts also enforce ESP32 static IPv4 on boot (`scripts\ensure-esp32-network.ps1`) when `PRINTBIT_ESP32_STATIC_IP_ENFORCE=true`, including Wi-Fi reconnect + static IP re-apply before server launch.

## 7) Expected startup behavior

After power-on/reboot:

1. Tablet boots and connects to production Wi-Fi/LAN.
2. C# worker service (`PrintBitHardware`) starts automatically in background.
3. Startup task runs PrintBit Node server.
4. Server starts in background on port `3000` (inherits `PRINTBIT_WORKER_QUEUE_DIR`).
5. Assigned Access opens Edge in kiosk mode for `printbit` account at `http://<kiosk-lan-ip>:3000/loading`.
6. `/loading` polls startup readiness and auto-redirects to `/` when services are ready.
7. In ESP32 mode, PrintBit attempts kiosk registration to ESP32 (`/kiosk/register`) on the configured ESP32 LAN URL.
8. ESP32 firmware auto-connects using saved credentials; if unavailable, it falls back to captive portal (`PrintBit-Setup`) in non-blocking mode.
9. ESP32 coin forwarding targets the provisioned `backend_url` until kiosk registration is posted, then uses `GET http://<kiosk-ip>:3000/coin?value=<coin>` (compatibility bridge endpoint).

## 8) Validation checklist

- `PrintBit Kiosk` and `PrintBit Watchdog` tasks exist and are `Ready/Running`.
- `PrintBitHardware` service is running in Windows Services.
- `GET http://127.0.0.1:3000/api/startup/ready` eventually returns `ready=true`.
- `GET http://127.0.0.1:3000/api/watchdog/health` returns healthy locally after boot settles.
- `Get-NetIPAddress -InterfaceAlias "Wi-Fi" -AddressFamily IPv4` includes `<kiosk-lan-ip>`.
- `GET /api/admin/summary` shows healthy watchdog/recovery stats and pipe connectivity.
- Kiosk UI appears after reboot without manual login steps (via Windows Assigned Access).

## 9) Recommended production hardening

- Enable BIOS setting: **Restore on AC Power Loss = Power On**.
- Use UPS + surge protection for tablet/printer/network.
- Keep `printbit-admin` for break-glass maintenance; do not run kiosk daily with admin account.
- Re-verify after Windows updates:
  - C# worker service (`PrintBitHardware`) status
  - startup tasks
  - Wi-Fi auto-connect profile
  - kiosk mode assignment
