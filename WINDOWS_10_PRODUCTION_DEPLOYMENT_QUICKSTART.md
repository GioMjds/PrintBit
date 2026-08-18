# Windows 10 Production Deployment Quickstart (Assigned Access Kiosk)

This guide provides a streamlined, step-by-step process for deploying the PrintBit kiosk on a Windows 10 tablet using Assigned Access. It consolidates build processes, environment variable configurations, user creation, and service registration.

## 1. Build the Applications

Before configuring the kiosk, ensure both the Node.js backend and the C# hardware service are built for production.

Open **PowerShell as Administrator** and navigate to the PrintBit directory:

```powershell
# 1. Build the Node.js Backend
cd C:\Users\Admin\Desktop\printbit
pnpm install
pnpm run build
pnpm exec tsc --noEmit --ignoreDeprecations 6.0

# 2. Build the C# Hardware Service
cd C:\Users\Admin\Desktop\printbit-worker\src\PrintBit.HardwareService
dotnet publish -c Release -o C:\Users\printbit\printbit-worker-service
```

## 2. Configure Machine-Wide Environment Variables

In production, PrintBit relies on **Machine-Wide Environment Variables** rather than just `.env` files. This ensures both the C# worker and Node.js tasks share the exact same configuration.

Run the following in **Administrator PowerShell** (replace placeholder `<...>` values with your actual network IP addresses):

```powershell
# ============================================================
# PrintBit - Windows 10 Production
# ESP32 + Coin Acceptor + Hopper + C# Worker
# ============================================================


# ============================================================
# Runtime
# ============================================================

NODE_ENV=production
PORT=3000


# ============================================================
# ESP32 Network
# ============================================================

PRINTBIT_NETWORK_PROVIDER=esp32

PRINTBIT_HOTSPOT_SSID=PrintBit
PRINTBIT_HOTSPOT_PASSWORD=printbit123
PRINTBIT_HOTSPOT_AUTH_TYPE=WPA

PRINTBIT_ESP32_AP_BASE_URL=http://192.168.4.1

# Windows tablet / kiosk address on the ESP32 network
PRINTBIT_ESP32_KIOSK_IP=192.168.4.2
PRINTBIT_ESP32_KIOSK_SUBNET_PREFIX=192.168.4.
PRINTBIT_ESP32_KIOSK_NETMASK=255.255.255.0

# Keep the Windows tablet on 192.168.4.2
PRINTBIT_ESP32_STATIC_IP_ENFORCE=true

# Optional explicit ESP32 gateway
PRINTBIT_ESP32_GATEWAY_IP=192.168.4.1

# Captive portal
PRINTBIT_CAPTIVE_PORTAL=true
PRINTBIT_ESP32_CAPTIVE_PORTAL_PATH=/portal


# ============================================================
# ESP32 Registration
#
# MUST match:
# const char* kioskRegisterToken
# in esp32-captive-portal.ino
# ============================================================

PRINTBIT_ESP32_REGISTER_TOKEN=printbit-register-token


# ============================================================
# Coin Acceptor -> ESP32 -> Node.js HTTP Bridge
#
# MUST match:
# coinBridgeSource
# coinBridgeApiKey
# in esp32-captive-portal.ino
# ============================================================

PRINTBIT_ESP32_COIN_SOURCE=esp32
PRINTBIT_ESP32_COIN_API_KEY=printbit-coin-bridge-key

# Keep strict authentication enabled
PRINTBIT_ESP32_COIN_BRIDGE_RELAXED=false

# Physical coins should still be credited while using
# the ESP32 hardware bridge.
PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS=true


# ============================================================
# ESP32 USB Serial
# ============================================================

PRINTBIT_SERIAL_PORT=COM3

# Reconnect behavior
PRINTBIT_SERIAL_RECONNECT_BASE_MS=2000
PRINTBIT_SERIAL_RECONNECT_MAX_MS=30000

# 0 = retry indefinitely
PRINTBIT_SERIAL_RECONNECT_MAX_ATTEMPTS=0


# ============================================================
# Node.js <-> C# Worker
# ============================================================

PRINTBIT_WORKER_QUEUE_DIR=C:\Users\printbit\printbit-worker\queue
PRINTBIT_WORKER_FAILED_DIR=C:\Users\printbit\printbit-worker\failed

PRINTBIT_WORKER_PIPE_NAME=printbit-node-errors
PRINTBIT_WORKER_RETURN_PIPE_NAME=printbit-worker-events
PRINTBIT_WORKER_COMMAND_PIPE_NAME=printbit-worker-commands

PRINTBIT_WORKER_PRECHECKS_ENABLED=true
PRINTBIT_WORKER_RETURN_MAX_BYTES=8192


# ============================================================
# Printing Tools
# ============================================================

PRINTBIT_SUMATRA_PATH=C:\Users\printbit\printbit\bin\SumatraPDF.exe

# Only enable/configure these if actually installed.
# Not installed — SumatraPDF handles monochrome natively via -print-settings.
# PRINTBIT_PDFTOPRINTER_PATH=C:\Users\printbit\bin\PDFtoPrinter.exe
# PRINTBIT_GHOSTSCRIPT_PATH=C:\Program Files\gs\gs10.xx.x\bin\gswin64c.exe
# PRINTBIT_LIBREOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe


# ============================================================
# Print Dispatch
# ============================================================

# Keep legacy until the new C# worker pipeline is intentionally enabled.
PRINTBIT_PRINT_DISPATCH_MODE=legacy

PRINTBIT_PRINT_DISPATCH_TIMEOUT_MS=60000
PRINTBIT_PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS=120000

PRINTBIT_PRINT_SPOOLER_MONITOR_WINDOW_MS=180000
PRINTBIT_PRINT_SPOOLER_POLL_INTERVAL_MS=1500
PRINTBIT_PRINT_SPOOLER_LOOKBACK_MINUTES=3
PRINTBIT_PRINT_SPOOLER_QUERY_TIMEOUT_MS=20000


# ============================================================
# Kiosk Security / Lockdown
# ============================================================

PRINTBIT_KIOSK_LOCKDOWN=true
PRINTBIT_USB_EXPORT_ENABLED=false

# Assigned Access launches Edge itself.
PRINTBIT_SKIP_EDGE_LAUNCH=true

PRINTBIT_KIOSK_USER=.\printbit


# ============================================================
# Session
# ============================================================

PRINTBIT_SESSION_EXPIRY_ENABLED=true


# ============================================================
# Watchdog
# ============================================================

PRINTBIT_WATCHDOG_HTTP_TIMEOUT_MS=10000
PRINTBIT_WATCHDOG_UNREACHABLE_RESTART_THRESHOLD=3
```

_Important: Restart your tablet or reboot after setting these so the changes apply system-wide._

## 3. Create Dedicated User Accounts

Separate the daily kiosk account from the administrator account to prevent unauthorized access and enable Assigned Access properly.

*(Note: If the `printbit` account already exists, there is no need to recreate it here. Just ensure it has a secure password and is a standard user.)*

Run the following in **Administrator PowerShell**:

```powershell
net user printbit "ReplaceWithStrongPassword1!" /add
net user printbit-admin "ReplaceWithStrongPassword2!" /add
net localgroup Administrators printbit-admin /add
```

## 4. Register Services & Startup Tasks

The backend systems must start automatically on boot.

### 4.1 Setup the C# Worker Service

```powershell
# Create necessary queue directories for the limited 'printbit' user
New-Item -ItemType Directory -Path "C:\Users\printbit\printbit-worker\queue" -Force
New-Item -ItemType Directory -Path "C:\Users\printbit\bin" -Force

# Register and start the service
sc.exe create PrintBitHardware binPath="C:\Users\printbit\printbit-worker-service\PrintBit.HardwareService.exe" start=auto
sc.exe start PrintBitHardware
```

### 4.2 Register Node.js Startup and Watchdog

Navigate to your PrintBit Node repository root (`C:\Users\Admin\Desktop\printbit`) in an Administrator PowerShell window:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup
pnpm run watchdog:verify
```

_Note: If testing reveals that the system-level startup does not boot the app correctly into Edge, you can switch the script to target the kiosk user specifically by replacing `-AtStartup` with `-KioskUser ".\printbit"`._

## 5. Configure Windows 10 Assigned Access (Kiosk Mode)

Lock the device to Microsoft Edge so users cannot access the desktop or settings.

1. Go to **Settings > Accounts > Family & other users > Set up assigned access**.
2. Select the **`printbit`** local user you created in Step 3.
3. Select **Microsoft Edge** as the assigned app.
4. When prompted for the URL, enter: `http://192.168.4.2:3000/loading` (Use the exact `192.168.4.2` value you set in Step 2).

## 6. Apply Windows Update & Lockdown Policies (Recommended)

To prevent the tablet from forcefully updating during operating hours and to apply further system lockdowns:

From the `C:\Users\Admin\Desktop\printbit` directory (as Admin):

```powershell
pnpm run updates:apply
pnpm run lockdown:apply
```

## Verification & Expected Startup Behavior

When you restart the tablet, the following should occur:

1. The tablet automatically logs into the `printbit` user.
2. The C# Background worker and Node application launch silently via scheduled tasks/services.
3. Assigned Access automatically opens a locked Microsoft Edge window directed to `/loading`.
4. The loading screen polls the backend until it successfully connects, and then seamlessly redirects to the main PrintBit UI.
