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
# Network & Provider Settings
setx PRINTBIT_NETWORK_PROVIDER esp32 /M
setx PRINTBIT_ESP32_AP_BASE_URL "http://<esp32-lan-ip>" /M
setx PRINTBIT_ESP32_KIOSK_SUBNET_PREFIX "<your-lan-subnet-prefix>" /M
setx PRINTBIT_ESP32_KIOSK_IP "<kiosk-lan-ip>" /M
setx PRINTBIT_ESP32_STATIC_IP_ENFORCE true /M
setx PRINTBIT_ESP32_KIOSK_NETMASK "<your-lan-netmask>" /M

# Server Port
setx PORT 3000 /M

# Kiosk Lockdown Settings
setx PRINTBIT_KIOSK_LOCKDOWN true /M
setx PRINTBIT_USB_EXPORT_ENABLED false /M
setx PRINTBIT_SKIP_EDGE_LAUNCH true /M

# Watchdog Settings
setx PRINTBIT_WATCHDOG_HTTP_TIMEOUT_MS 10000 /M
setx PRINTBIT_WATCHDOG_UNREACHABLE_RESTART_THRESHOLD 3 /M

# C# Worker Integration Variables
setx PRINTBIT_WORKER_QUEUE_DIR "C:\Users\printbit\printbit-worker\queue" /M
setx PRINTBIT_KIOSK_USER ".\printbit" /M
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
4. When prompted for the URL, enter: `http://<kiosk-lan-ip>:3000/loading` (Use the exact `<kiosk-lan-ip>` value you set in Step 2).

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
