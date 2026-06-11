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

1. Pull the latest PrintBit changes.
2. Run `pnpm install` so dependencies match `package.json`.
3. Run `pnpm run build` to rebuild the browser bundles.
4. Run `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` to catch regressions.
5. Restart the PrintBit process or kiosk service.
6. Confirm the confirm page receipt QR still opens `/receipt/t/:token` and the receipt page loads.

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

## 7) Related docs

- [README.md](./README.md)
- [OPERATIONS.md](./OPERATIONS.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
