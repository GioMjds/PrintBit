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
pnpm run build
pnpm exec tsc --noEmit
```

Set machine-wide env vars (run PowerShell as Administrator):

```powershell
setx PRINTBIT_NETWORK_PROVIDER esp32 /M
setx PRINTBIT_ESP32_AP_BASE_URL http://192.168.4.1 /M
setx PRINTBIT_ESP32_KIOSK_SUBNET_PREFIX 192.168.4. /M
setx PORT 3000 /M
setx PRINTBIT_KIOSK_LOCKDOWN true /M
setx PRINTBIT_USB_EXPORT_ENABLED false /M
```

Then reboot once so services/tasks pick up new machine env vars.

## 3) Configure Windows Wi-Fi for auto-connect (ESP32 AP)

1. Connect the tablet once to ESP32 SSID (example: `PrintBit`).
2. Set profile auto-connect + top priority (Admin PowerShell):

```powershell
netsh wlan set profileparameter name="PrintBit" connectionmode=auto
netsh wlan set profileorder name="PrintBit" interface="Wi-Fi" priority=1
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
5. Set URL to `http://localhost:3000` (or your fixed kiosk URL if required).

## Windows 10

1. Go to `Settings > Accounts > Family & other users > Set up assigned access`.
2. Select/create `PrintBitKiosk`.
3. Select **Microsoft Edge** as assigned app.
4. Configure start URL to `http://localhost:3000`.

Note: Windows Home has limited kiosk capabilities; Pro/Edu/Enterprise is strongly preferred.

## 6) Install PrintBit startup + watchdog tasks

From repo root (Admin PowerShell):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup
pnpm run watchdog:verify
```

What this gives you:

- PrintBit launcher starts automatically at machine startup
- watchdog task monitors health and can recover server/browser

## 7) Expected startup behavior

After power-on/reboot:

1. Tablet boots and connects to ESP32 Wi-Fi (`PrintBit`) automatically.
2. Startup task runs PrintBit launcher.
3. Server starts in background on port `3000`.
4. Edge opens in kiosk mode automatically.
5. In ESP32 mode, PrintBit attempts kiosk registration to ESP32 (`/kiosk/register`) and uses `192.168.4.x` network path.
6. ESP32 firmware should run captive DNS hijack and probe redirects (`/hotspot-detect.html`, `/generate_204`, `/ncsi.txt`, `/connecttest.txt`) to the registered kiosk portal URL.
7. ESP32 coin forwarding should target `GET http://<kiosk-ip>:3000/coin?value=<coin>` (compatibility bridge endpoint).

## 8) Validation checklist

- `PrintBit Kiosk` and `PrintBit Watchdog` tasks exist and are `Ready/Running`.
- `GET http://127.0.0.1:3000/api/watchdog/health` returns OK locally.
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
