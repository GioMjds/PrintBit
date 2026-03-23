# **PrintBit**

PrintBit is a Windows-based self-service kiosk application for coin-operated printing, scanning, and copy workflows.
It is designed for campus usage (students, faculty, and staff) with phone-to-kiosk document upload and on-device job confirmation.

## Core capabilities

- Coin balance via serial input (Arduino/coin acceptor).
- Wireless upload sessions for print jobs (QR + hotspot flow).
- Print and copy job charging tied to configurable pricing.
- Scan and scan-preview flow for copy mode.
- Admin dashboard for earnings, logs, settings, and diagnostics.

## End-user step-by-step guides

### Print

1. Open **Print** on the kiosk.
2. Scan the QR code with your phone and upload a file.
3. Wait for your file to appear in **Received files** and select it.
4. Tap **Continue to settings**.
5. Choose print settings (color, copies, orientation, paper size, page range) and continue.
6. Insert coins on the confirm screen until your balance covers the total, then confirm.
7. Collect your printed pages.

Troubleshooting:

- If no file appears, start a new session and upload again.
- If you see a session expiry countdown, complete upload/selection before it reaches zero or start a fresh session.
- Only one phone can actively own an upload session at a time; if ownership conflict appears, generate a new kiosk session.
- If balance is insufficient, insert more coins before confirming.

### Copy

1. Open **Copy** on the kiosk.
2. Place the page face-down on the scanner glass.
3. Tap **Check Document** and review the preview.
4. If preview is correct, tap **Continue to Config**.
5. Choose copy settings and continue to confirmation.
6. Insert coins until the required amount is reached, then confirm.
7. Collect your copied pages.

Troubleshooting:

- If no document is detected, reposition the page and tap **Retry**.
- If preview looks incorrect, tap **Check Document** again before continuing.

### Scan

1. Open **Scan** on the kiosk.
2. Choose scan source, color mode, and resolution.
3. Place your document and tap **Scan Document**.
4. Review the scanned preview. Tap **Rescan** if needed.
5. Tap **Get Soft Copy**.
6. Choose delivery:
   - **Wireless (QR):** scan the generated QR code to download.

Troubleshooting:

- If scanner is unavailable, check scanner connection/power and retry.
- If the QR link expires, refresh the wireless link.
- USB mass storage is disabled in kiosk lockdown mode by design.

## Tech stack

- **Backend:** Node.js, Express, Socket.IO, TypeScript
- **Storage:** SQLite (`printbit.sqlite`) for persisted kiosk state
- **Upload handling:** Multer
- **Printing:** SumatraPDF portable executable (`bin/SumatraPDF.exe`)
- **Serial integration:** `serialport`
- **Frontend:** Static HTML/CSS + TypeScript bundles under `src/public`

## Quick start

### 1) Install dependencies

```bash
pnpm install
```

### 2) Run in development

```bash
pnpm run dev
```

Server starts on `http://0.0.0.0:3000`.

### 3) Build browser bundle

```bash
pnpm run build
```

### 4) Type-check

```bash
pnpm exec tsc --noEmit
```

### 5) One-time legacy import (optional)

If upgrading from an older deployment that still has `db.json`, run:

```bash
pnpm run db:migrate:legacy
```

Use `--force` to rerun import after clearing the migration marker:

```bash
pnpm run db:migrate:legacy -- --force
```

## Project structure

```text
src/
  server.ts                 # App entrypoint
  config/                   # Runtime constants and route-to-page mappings
  middleware/               # Captive portal, static assets, admin auth
  routes/                   # HTTP API and page route registration
  services/                 # Printer, serial, session, hotspot, db, admin logic
  public/                   # Browser UI pages (print/upload/config/confirm/copy/scan/admin)
uploads/                    # Runtime uploaded files
printbit.sqlite             # Runtime persisted machine state (SQLite)
bin/                        # External executables (ex: SumatraPDF.exe)
```

## Runtime prerequisites

- Windows machine (required for current hardware/print/hotspot integrations).
- `bin/SumatraPDF.exe` present for print dispatch.
- Optional but expected in production:
  - Coin acceptor serial device
  - Scanner device
  - MyPublicWiFi installation

## Mobile and network matrix

- Android: Chrome (latest stable + prior major) for `/upload/:token`
- iOS: Safari (latest stable + prior major) for `/upload/:token`
- Supported upload formats: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, JPG, PNG
- Session continuity: upload page refreshes lease periodically and also on app resume (visibility/focus events)

### Network provider modes (migration to ESP32)

- `PRINTBIT_NETWORK_PROVIDER=mypublicwifi` (default)
  - Existing behavior using MyPublicWiFi process management on kiosk Windows host.
- `PRINTBIT_NETWORK_PROVIDER=esp32`
  - ESP32 provides AP + captive portal onboarding.
  - PrintBit still serves session/upload endpoints and `/portal` bridge.
  - `POST /api/hotspot/start` becomes no-op orchestration (no MyPublicWiFi launch).

Related env knobs:

- `PRINTBIT_HOTSPOT_SSID` (default `PrintBit` in `esp32` mode, else `PrintBit-Kiosk`)
- `PRINTBIT_HOTSPOT_PASSWORD` (default empty in `esp32` mode, else `printbit123`)
- `PRINTBIT_HOTSPOT_AUTH_TYPE` (derived from password by default: `nopass` when empty, `WPA` otherwise)
- `PRINTBIT_ESP32_CAPTIVE_PORTAL_PATH` (default `/portal`)
- `PRINTBIT_ESP32_AP_BASE_URL` (default `http://192.168.4.1`) for kiosk registration endpoint
- `PRINTBIT_ESP32_KIOSK_SUBNET_PREFIX` (default `192.168.4.`) to detect kiosk IP for ESP32 mode
- `PRINTBIT_ESP32_KIOSK_IP` (optional) explicitly set the kiosk's IP on the ESP32 network (bypasses auto-detection)
- `PRINTBIT_SERIAL_PORT` (optional) to pin the serial coin/hopper device when multiple COM ports are present

Recommended `.env` for ESP32 mode:

```env
PRINTBIT_NETWORK_PROVIDER=esp32
PRINTBIT_HOTSPOT_SSID=PrintBit
PRINTBIT_HOTSPOT_PASSWORD=printbit123
PRINTBIT_HOTSPOT_AUTH_TYPE=WPA
PRINTBIT_ESP32_KIOSK_IP=192.168.4.2
PRINTBIT_ESP32_AP_BASE_URL=http://192.168.4.1
```

Recommended `.ino` alignment for ESP32 mode:

- AP SSID: `PrintBit`
- AP password: `printbit123`
- Captive redirect target should be dynamically updated via ESP32 `POST /kiosk/register` (kiosk server sends its current IP)

Troubleshooting mobile captive onboarding:

- If captive page does not auto-open after joining kiosk Wi-Fi, open the fallback upload link shown on Print screen.
- If session is expired/owned by another device, generate a new kiosk print session and scan again.
- If logs show `no adapter IP matches 192.168.4.x`, set `PRINTBIT_ESP32_KIOSK_IP` to the kiosk's expected IP on the ESP32 network (e.g., `192.168.4.2`).

## Important notes

- Upload and machine state are persisted in `uploads/` and `printbit.sqlite`; do not delete these unintentionally during operation.
- Admin routes are restricted by local-network checks and admin PIN header requirements.
- Current hotspot/captive behavior is optimized for Android flow; iOS flow improvements are being planned.

## Additional documentation

- [CONTRIBUTING.md](./CONTRIBUTING.md)
- [API_DOCUMENTATION.md](./API_DOCUMENTATION.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [OPERATIONS.md](./OPERATIONS.md)
- [INSTALLATION_AND_DEPENDENCIES.md](./INSTALLATION_AND_DEPENDENCIES.md)
- [DOCUMENTATION_SUGGESTIONS.md](./DOCUMENTATION_SUGGESTIONS.md)

## Documentation notes

- For full install/software/dependency setup, start with
  [`INSTALLATION_AND_DEPENDENCIES.md`](./INSTALLATION_AND_DEPENDENCIES.md).
- For suggested next documentation improvements, see
  [`DOCUMENTATION_SUGGESTIONS.md`](./DOCUMENTATION_SUGGESTIONS.md).
