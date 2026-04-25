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

## Kiosk/production integrations

- **PDFtoPrinter** at: `bin/PDFtoPrinter.exe` (or configured via `PRINTBIT_PDFTOPRINTER_PATH`).
- **GhostScript** (`gswin64c.exe`) installed and discoverable via PATH or `PRINTBIT_GHOSTSCRIPT_PATH`.
- **LibreOffice** (`soffice.exe`) installed and discoverable via PATH or `PRINTBIT_LIBREOFFICE_PATH`.
- **Optional phased fallback:** SumatraPDF portable executable at `bin/SumatraPDF.exe` (or `PRINTBIT_SUMATRA_PATH`).
- **MyPublicWiFi** (used for hotspot/captive behavior integration).
- **Printer driver package** for the production printer model.
- **Scanner driver package / TWAIN/WIA support** for the scanner model.
- **Serial/USB drivers** for coin acceptor and hopper controller (Arduino or equivalent).

## Redis + BullMQ for Windows Tablet

PrintBit uses **BullMQ** for background print orchestration, and BullMQ requires a running **Redis** instance.

- **BullMQ** is installed with the app through `pnpm install` and updated with normal package updates.
- **Redis** is a separate service that must be installed and running on the Windows tablet or on a reachable network host.
- **Recommended kiosk setup:** run Redis locally on the tablet so print jobs stay available even if the network is unstable.

### Windows tablet install/update options

1. Install Redis as a Windows service on the tablet, or use a trusted Redis build/package that supports Windows service registration.
2. Set `REDIS_HOST` and `REDIS_PORT` in the kiosk environment if Redis is not listening on `localhost:6379`.
3. Verify Redis after install or update with `redis-cli ping` or an equivalent health check.
4. Restart the PrintBit app or service after Redis changes so BullMQ reconnects cleanly.

### Recommended update flow on the tablet

When updating PrintBit on a Windows tablet, update Redis and BullMQ in this order:

1. Stop the PrintBit app or kiosk service.
2. Update Redis if the kiosk host is also running the Redis service.
3. Run `pnpm install` to update `bullmq` and the rest of the Node dependencies.
4. Run `pnpm run build` to rebuild the client bundles.
5. Run `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` to confirm TypeScript still passes.
6. Start the PrintBit app or kiosk service again.

### Quick Redis checks on the tablet

- Confirm the Redis service is running before starting PrintBit.
- Confirm the port is reachable from the tablet itself if Redis is remote.
- If BullMQ jobs stop processing, check Redis first before restarting the app.

## 3) Node package dependencies used by this project

## App dependencies (runtime)

- **Server/framework:** `express`, `socket.io`, `cookie-parser`.
- **Data/storage:** built-in Node SQLite (`node:sqlite`).
- **File handling:** `multer`, `file-type`, `xlsx`.
- **Document/media:** `pdfjs`, `pdfjs-dist`, `canvas`, `sharp`, `qrcode`.
- **Security/hash:** `argon2`.
- **Hardware/serial:** `serialport`, `@serialport/parser-readline`.
- **Queue/orchestration:** `bullmq`.

## Development dependencies

- TypeScript toolchain: `typescript`, `ts-node-dev`, `tsconfig-paths`.
- Type definitions: `@types/*` packages.
- Bundling: `esbuild`.

See full exact versions in [`package.json`](./package.json).

## 4) Installation steps

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

## 4) Windows tablet update checklist

Use this when applying a new PrintBit build on the Windows kiosk/tablet:

1. Verify the Redis service is online.
2. Pull the latest PrintBit changes.
3. Run `pnpm install` so `bullmq` and other dependencies match `package.json`.
4. Run `pnpm run build` to rebuild the browser bundles.
5. Run `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` to catch regressions.
6. Restart the PrintBit process or kiosk service.
7. Confirm the confirm page receipt QR still opens `/receipt/t/:token` and the receipt page loads.

## 5) Preflight checklist (recommended)

- `PRINTBIT_PRINT_DISPATCH_MODE` is set appropriately (`legacy`, `phased`, or `new-only`).
- `bin/PDFtoPrinter.exe` exists (or `PRINTBIT_PDFTOPRINTER_PATH` points to a valid file).
- GhostScript (`gswin64c.exe`) is reachable by PATH or `PRINTBIT_GHOSTSCRIPT_PATH`.
- LibreOffice (`soffice.exe`) is reachable by PATH or `PRINTBIT_LIBREOFFICE_PATH`.
- If using `phased`, Sumatra fallback path is valid (`bin/SumatraPDF.exe` or `PRINTBIT_SUMATRA_PATH`).
- Printer appears online in Windows.
- Scanner is recognized by Windows/scanner APIs.
- Serial coin/hopper controller is connected and readable.
- `uploads/` directory is writable.
- `printbit.sqlite` exists (or can be created by app init).
- Redis is reachable from the tablet and BullMQ can connect.
- Admin PIN and pricing configured through admin settings.

## 6) Common installation issues

- **Native dependency build failures** (`canvas`, `sharp`, `argon2`, `serialport`):
  - Ensure supported Node version is installed.
  - Reinstall dependencies after Node changes: `pnpm install`.
- **Printing fails:**
  - Verify dispatcher mode (`PRINTBIT_PRINT_DISPATCH_MODE`) and binary paths.
  - Verify printer driver availability and default printer configuration.
- **Scanner endpoints fail:**
  - Confirm scanner drivers and device permissions.
- **Hotspot features unavailable:**
  - Verify MyPublicWiFi installation and local permissions.
- **BullMQ jobs are not processing:**
  - Verify Redis is running, reachable, and using the configured host/port.
  - Restart PrintBit after Redis restarts so the worker reconnects.
  - Re-run `pnpm install` if `bullmq` was updated.

## 7) Related docs

- [README.md](./README.md)
- [OPERATIONS.md](./OPERATIONS.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
