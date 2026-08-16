# PrintBit Installation & Dependencies Guide

This guide explains what software to install, what dependencies are used, and how to validate a working local setup.

## 1) Platform requirements

- **Primary target OS:** Windows 10/11 (kiosk deployment target).
- **Development OS:** Windows recommended; Linux/macOS can be used for API/frontend development but hardware integrations are Windows-centric.

## 2) Required software

## Core runtime

- **Node.js:** 22.5.0+ (required for built-in `node:sqlite` support).
- **pnpm:** `10.13.1` (as declared by `packageManager` in `package.json`).
- **Git:** latest stable.

## 3) Node package dependencies used by this project

## App dependencies (runtime)

- **Server/framework:** `express`, `socket.io`, `cookie-parser`.
- **Data/storage:** built-in Node SQLite (`node:sqlite`).
- **File handling:** `multer`, `file-type`, `xlsx`.
- **Document/media:** `pdfjs`, `pdfjs-dist`, `canvas`, `sharp`, `qrcode`.
- **Security/hash:** `argon2`.
- **Hardware/serial:** `serialport`, `@serialport/parser-readline`.

## Development dependencies

- TypeScript toolchain: `typescript`, `ts-node-dev`, `tsconfig-paths`.
- Type definitions: `@types/*` packages.
- Bundling: `esbuild`.

See full exact versions in [`package.json`](./package.json).

## 4) Installation steps

### 4.1) Development Local Setup

1\. Clone repository.
2\. Install dependencies:

```bash
pnpm install
```

3\. Start development server:

```bash
pnpm run dev
```

4\. Build client bundle:

```bash
pnpm run build
```

5\. Type-check:

```bash
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
```

### 4.2) Production Installation (Kiosk Mode in `printbit` account)

To set up the production kiosk environment on the Windows host using the dedicated `printbit` account and the C# hardware worker service:

#### Step 1: Create local user accounts

In Administrator PowerShell, create the local `printbit` account (limited kiosk user) and the administrator account `printbit-admin`:

```powershell
net user printbit "KioskSecurePassword123!" /add
net user printbit-admin "AdminSecurePassword123!" /add
net localgroup Administrators printbit-admin /add
```

#### Step 2: Compile & Publish the C# Worker Service

Publish the C# worker to a folder under the `printbit` user's directory:

```powershell
cd C:\Users\Admin\Desktop\printbit-worker\src\PrintBit.HardwareService
dotnet publish -c Release -o C:\Users\printbit\printbit-worker
```

#### Step 3: Install SumatraPDF & Directories

Set up the C# worker print queue directory and place `SumatraPDF.exe`:

```powershell
New-Item -ItemType Directory -Path "C:\Users\printbit\printbit-worker\queue" -Force
New-Item -ItemType Directory -Path "C:\Users\printbit\bin" -Force
# Copy SumatraPDF.exe into C:\Users\printbit\bin\SumatraPDF.exe
```

#### Step 4: Register C# Worker Windows Service

Register and start the C# Worker (`PrintBitHardware`) service:

```powershell
sc.exe create PrintBitHardware binPath="C:\Users\printbit\printbit-worker\PrintBit.HardwareService.exe" start=auto
sc.exe start PrintBitHardware
```

Verify the service is active and configure `C:\Users\printbit\printbit-worker\appsettings.json` with the exact target printer name.

#### Step 5: Build & Install Node.js Application

Clone/place the PrintBit project on the host, build the Node application, and set environment variables:

```powershell
# In the project root
pnpm install
pnpm run build

# Set environment variables (run as Administrator)
setx PRINTBIT_WORKER_QUEUE_DIR "C:\Users\printbit\printbit-worker\queue" /M
setx PRINTBIT_KIOSK_USER ".\printbit" /M
```

#### Step 6: Install Startup & Watchdog Tasks

Install scheduled tasks to start Node.js server and watchdog at startup (SYSTEM principal):

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup.ps1 -AtStartup
powershell -ExecutionPolicy Bypass -File .\scripts\install-watchdog.ps1 -AtStartup
```

#### Step 7: Configure Assigned Access

Configure Windows Assigned Access for the local user `printbit` to use Microsoft Edge pointing to:
`http://localhost:3000/loading`

---

## 5) Windows tablet update checklist

Use this when applying a new PrintBit build on the Windows kiosk/tablet:

1. Pull the latest PrintBit changes.
2. Run `pnpm install` so dependencies match `package.json`.
3. Run `pnpm run build` to rebuild the browser bundles.
4. Run `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` to catch regressions.
5. Restart the Node.js server task and verify C# worker (`PrintBitHardware`) service is running:

   ```powershell
   Get-Service -Name PrintBitHardware
   ```

6. Confirm the confirm page receipt QR still opens `/receipt/t/:token` and the receipt page loads.

## 6) Preflight checklist (recommended)

- `PRINTBIT_WORKER_QUEUE_DIR` environment variable is configured and pointing to the worker queue directory.
- `PrintBitHardware` Windows service is running.
- Named pipes `printbit-worker-events` and `printbit-node-errors` are connected.
- Printer appears online in Windows and its name matches the `PrinterName` setting in the worker's `appsettings.json`.
- Scanner is recognized by Windows/scanner APIs.
- Serial coin/hopper controller is connected and readable (handled by Node).
- `uploads/` directory is writable.
- `printbit.sqlite` exists (or can be created by app init).
- Admin PIN and pricing configured through admin settings.

## 7) Common installation issues

- **Native dependency build failures** (`canvas`, `sharp`, `argon2`, `serialport`):
  - Ensure supported Node version is installed.
  - Reinstall dependencies after Node changes: `pnpm install`.
- **C# Worker named pipe connection fails:**
  - Verify that the C# worker service is running.
  - Verify that permissions/DACL are configured correctly (if Node and C# worker run under different Windows identities).
- **Printing fails:**
  - Verify C# worker service is running and its `PrintQueueDirectory` matches Node's `PRINTBIT_WORKER_QUEUE_DIR`.
  - Check `appsettings.json` printer name and SumatraPDF path.
- **Scanner endpoints fail:**
  - Confirm scanner drivers and device permissions.
- **Hotspot features unavailable:**
  - Verify ESP32 bridge connection, IP configuration, and network settings.

## 8) Related docs

- [README.md](./README.md)
- [OPERATIONS.md](./OPERATIONS.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- [WINDOWS_KIOSK_LOCKDOWN_SETUP.md](./WINDOWS_KIOSK_LOCKDOWN_SETUP.md)
- [WINDOWS_TABLET_ESP32_KIOSK_SETUP.md](./WINDOWS_TABLET_ESP32_KIOSK_SETUP.md)
