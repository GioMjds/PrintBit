# PrintBit ESP32 + Windows Tablet Kiosk Setup (Windows 10/11)

This guide covers:

- repository-side setup
- Windows tablet setup
- automatic Wi-Fi connect + Task Scheduler startup
- kiosk account creation and Kiosk Mode differences between Windows 10 and 11

## 1) Prerequisites

- Windows 10/11 **Pro / Enterprise / Education** (recommended for kiosk features)
- Node.js + pnpm installed
- Microsoft Edge installed
- PrintBit repo cloned on the tablet
- ESP32 AP online (example gateway `192.168.4.1`)

## 2) Repository setup (PrintBit)

From repo root:

```powershell
pnpm install
pnpm run build:kiosk
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

Set machine-wide env vars (run PowerShell as Administrator):

```powershell
setx PRINTBIT_NETWORK_PROVIDER esp32 /M
setx PRINTBIT_ESP32_AP_BASE_URL http://192.168.4.1 /M
setx PRINTBIT_ESP32_KIOSK_SUBNET_PREFIX 192.168.4. /M
setx PRINTBIT_ESP32_KIOSK_IP 192.168.4.2 /M
setx PRINTBIT_ESP32_STATIC_IP_ENFORCE true /M
setx PRINTBIT_ESP32_KIOSK_NETMASK 255.255.255.0 /M
setx PORT 3000 /M
setx PRINTBIT_KIOSK_LOCKDOWN true /M
setx PRINTBIT_USB_EXPORT_ENABLED false /M
setx PRINTBIT_SKIP_EDGE_LAUNCH true /M
setx PRINTBIT_WATCHDOG_HTTP_TIMEOUT_MS 10000 /M
setx PRINTBIT_WATCHDOG_UNREACHABLE_RESTART_THRESHOLD 3 /M
```

Then reboot once so services/tasks pick up new machine env vars.

## 3) Configure Windows Wi-Fi for auto-connect (ESP32 AP)

1. Connect the tablet once to ESP32 SSID (example: `PrintBit`).
2. Set profile auto-connect + top priority (Admin PowerShell):

```powershell
netsh wlan set profileparameter name="PrintBit" connectionmode=auto
netsh wlan set profileorder name="PrintBit" interface="Wi-Fi" priority=1
```

3. Set static IPv4 on the kiosk Wi-Fi adapter (Admin PowerShell):

```powershell
netsh interface ipv4 set address name="Wi-Fi" static 192.168.4.2 255.255.255.0 192.168.4.1
netsh interface ipv4 set dnsservers name="Wi-Fi" static 192.168.4.1 primary
```

Optional startup safety task (connect Wi-Fi on boot):

```powershell
schtasks /Create /TN "PrintBit Ensure WiFi" /SC ONSTART /RL HIGHEST /RU SYSTEM /TR "cmd /c netsh wlan connect name=""PrintBit"""
```

## 4) Create dedicated users (recommended)

Use separate accounts:

- `PrintBitKiosk` (daily operation)
- `PrintBitAdmin` (maintenance only)

Admin PowerShell:

```powershell
net user PrintBitKiosk "ReplaceWithStrongPassword1!" /add
net user PrintBitAdmin "ReplaceWithStrongPassword2!" /add
net localgroup Administrators PrintBitAdmin /add
```

## 5) Configure Kiosk Mode (Windows 11 vs Windows 10)

## Windows 11

1. Go to `Settings > Accounts > Other users > Set up a kiosk`.
2. Create/select `PrintBitKiosk`.
3. Choose **Microsoft Edge**.
4. Choose kiosk experience (`Digital signage` is typical).
5. Set URL to `http://192.168.4.2:3000/loading`.

## Windows 10

1. Go to `Settings > Accounts > Family & other users > Set up assigned access`.
2. Select/create `PrintBitKiosk`.
3. Select **Microsoft Edge** as assigned app.
4. Configure start URL to `http://192.168.4.2:3000/loading`.

Note: Windows Home has limited kiosk capabilities; Pro/Edu/Enterprise is strongly preferred.

## 6) Install PrintBit startup + watchdog tasks

From repo root (Admin PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup
pnpm run watchdog:verify
```

If your dedicated kiosk login still cannot reach `http://192.168.4.2:3000/loading`, install a kiosk-user targeted startup task (server-only at kiosk logon):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -KioskUser ".\PrintBitKiosk"
```

`install-watchdog.ps1 -AtStartup` registers watchdog tasks with the **SYSTEM** principal so server recovery still runs when the kiosk login account is different from the admin account used during setup.
Launcher scripts (`start-kiosk.ps1`, `start-kiosk.bat`, `launch-kiosk.js`, watchdog Edge recovery) now honor `PRINTBIT_ESP32_KIOSK_IP` in ESP32 mode and default to `192.168.4.2` when unset.
Startup scripts also enforce ESP32 static IPv4 on boot (`scripts\ensure-esp32-network.ps1`) when `PRINTBIT_ESP32_STATIC_IP_ENFORCE=true`, including Wi-Fi reconnect + static IP re-apply before server launch.
`install-startup.ps1 -AtStartup` now also uses **SYSTEM** principal for cross-account kiosk deployments; when running as SYSTEM it starts/restarts the server and intentionally skips visible Edge launch in Session 0.
`install-startup.ps1 -KioskUser <user>` creates a **kiosk-user logon** task that starts only the server under that user's interactive token via `scripts\start-kiosk-server.ps1` (compiled runtime via `node dist\server.js`, with `build:server` fallback if needed).
`watchdog.ps1` is compatible with both **PowerShell 7** and **Windows PowerShell 5.1** task hosts for `/api/watchdog/health` polling.
By default, watchdog restart-on-unhealthy is disabled to avoid disrupting active upload/print sessions (`PRINTBIT_WATCHDOG_RESTART_ON_UNHEALTHY=false`). The watchdog still restarts the server when the health endpoint is unreachable.
If startup still fails, inspect `uploads\logs\kiosk-server-startup.log` from the project root for the exact command/error.

What this gives you:

- PrintBit launcher starts automatically at machine startup (SYSTEM)
- watchdog task monitors health and can recover server/browser

## 7) Expected startup behavior

After power-on/reboot:

1. Tablet boots and connects to ESP32 Wi-Fi (`PrintBit`) automatically.
2. Startup task runs PrintBit launcher.
3. Server starts in background on port `3000`.
4. Assigned Access opens Edge in kiosk mode for `PrintBitKiosk` at `http://192.168.4.2:3000/loading`.
5. `/loading` polls startup readiness and auto-redirects to `/` when services are ready.
6. In ESP32 mode, PrintBit attempts kiosk registration to ESP32 (`/kiosk/register`) and uses `192.168.4.x` network path.
7. ESP32 firmware should run captive DNS hijack and probe redirects (`/hotspot-detect.html`, `/generate_204`, `/ncsi.txt`, `/connecttest.txt`) to the registered kiosk portal URL.
8. ESP32 coin forwarding should target `GET http://<kiosk-ip>:3000/coin?value=<coin>` (compatibility bridge endpoint).

## 8) Validation checklist

- `PrintBit Kiosk` and `PrintBit Watchdog` tasks exist and are `Ready/Running`.
- `GET http://127.0.0.1:3000/api/startup/ready` eventually returns `ready=true`.
- `GET http://127.0.0.1:3000/api/watchdog/health` returns healthy locally after boot settles.
- `Get-NetIPAddress -InterfaceAlias "Wi-Fi" -AddressFamily IPv4` includes `192.168.4.2`.
- `GET /api/admin/summary` shows healthy watchdog/recovery stats.
- Kiosk UI appears after reboot without manual login steps (if auto-sign-in is configured).

## 9) Recommended production hardening

- Enable BIOS setting: **Restore on AC Power Loss = Power On**.
- Use UPS + surge protection for tablet/printer/network.
- Keep `PrintBitAdmin` for break-glass maintenance; do not run kiosk daily with admin account.
- Re-verify after Windows updates:
  - startup tasks
  - Wi-Fi auto-connect profile
  - kiosk mode assignment
