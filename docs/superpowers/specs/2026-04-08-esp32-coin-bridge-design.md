# ESP32 Secure Coin Bridge Design

## Problem

Coin pulses are detected on ESP32 hardware, but credits are not consistently reflected in the kiosk balance/UI when running in WiFi-only mode (no serial port on laptop/tablet kiosks). The kiosk must work by connecting to ESP32 AP `PrintBit`, with coin events delivered over HTTP to the kiosk server.

## Goals

1. Keep kiosk/tablet operation fully WiFi-based (no serial dependency).
2. Use secure `/coin` bridge requests (API key + source + event ID), not relaxed mode.
3. Use dynamic kiosk registration so ESP32 does not depend on a fixed kiosk IP.
4. Ensure successful coin insert updates server balance and `/confirm` UI immediately.
5. Improve diagnostics so failures are explicit and actionable.

## Non-Goals

1. Persistent offline coin queueing on ESP32.
2. Changes to printer billing/pricing logic.
3. Replacing existing kiosk `/coin` endpoint contract.

## Current-State Findings

1. ESP32 firmware currently posts legacy `GET /coin?value=` requests only.
2. Kiosk `/coin` in secure mode requires:
   - `x-coin-source`
   - `x-coin-api-key`
   - `x-coin-event-id` (or `eventId` query equivalent)
3. ESP32 firmware currently hardcodes kiosk target URL (`192.168.4.2:3000`) and does not handle dynamic registration payloads.
4. Kiosk already has ESP32 registration loop support (`POST /kiosk/register` target), and coin acceptance emits Socket.IO `balance`.

## Proposed Architecture

### 1) Connectivity Model

- ESP32 is AP host (`PrintBit`, password-protected).
- Kiosk/tablet joins ESP32 AP.
- Kiosk server runs on port `3000`.
- Kiosk periodically registers its current AP-side IP with ESP32 using shared register token.

### 2) Coin Bridge Model

- ESP32 is a secure client to kiosk `/coin`.
- Each coin event uses a unique event ID.
- ESP32 sends:
  - `GET /coin?value=<1|5|10|20>&eventId=<id>`
  - `x-coin-source: esp32`
  - `x-coin-api-key: <shared key>`
  - `x-coin-event-id: <id>`
- Kiosk validates and credits balance.
- Kiosk emits Socket.IO updates to browser UI (`balance`), including `/confirm`.

### 3) Addressing Model

- Primary target URL is built from successful `/kiosk/register` payload (dynamic IP/port/path).
- Optional fixed fallback may remain only as bootstrap diagnostic aid, not the primary flow.

## Component Changes

### ESP32 firmware (`esp32-captive-portal.ino`)

1. Add secure bridge constants:
   - `coinBridgeApiKey`
   - `coinBridgeSource` (`esp32`)
   - register token alignment with kiosk env
2. Add event ID generation per coin event.
3. Update `sendCoinToTablet` to include secure headers and `eventId`.
4. Parse HTTP response status/body and print structured diagnostics.
5. Add registration handler support to store kiosk host/port/path from kiosk registration requests.
6. Route coin events to registered kiosk endpoint.
7. Keep bounded retry behavior for transient failures.

### Kiosk config/runtime (existing server)

1. Keep `PRINTBIT_NETWORK_PROVIDER=esp32`.
2. Require/align:
   - `PRINTBIT_ESP32_COIN_API_KEY`
   - `PRINTBIT_ESP32_REGISTER_TOKEN`
3. Set `PRINTBIT_ESP32_COIN_BRIDGE_RELAXED=false` for secure mode.
4. Keep `PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS=true` default in ESP32 provider mode to prevent printer-gate rejections from blocking accepted bridge coins.

## Data Flow

1. Kiosk starts in ESP32 mode and detects `192.168.4.x` IP.
2. Kiosk posts registration to ESP32 (`/kiosk/register`) with token and callback details.
3. ESP32 stores/refreshes kiosk destination.
4. Coin pulse detected and mapped to coin value.
5. ESP32 sends secure `/coin` request with unique event ID.
6. Kiosk validates request, processes idempotency, credits balance, emits `balance`.
7. Browser UI receives `balance` event and updates immediately.

## Error Handling and Diagnostics

ESP32 logs must distinguish these failure classes:

1. `not_registered` — no kiosk registration available yet.
2. `network_unreachable` — AP route/host unreachable.
3. `auth_failed` — 403 from invalid API key/source.
4. `validation_failed` — 400 bad request/event ID/value.
5. `coin_rejected_409` — kiosk intentionally rejected credit (include reason body).
6. `server_error` — 5xx response.

Retry policy:

- Keep small bounded retries for transient network/5xx failures.
- Do not perform unbounded queueing or persistent backlog.

## Testing Strategy

### Configuration Checks

1. Confirm kiosk env values for ESP32 provider + shared secrets.
2. Confirm kiosk/tablet joins `PrintBit` SSID.
3. Confirm kiosk is reachable on `192.168.4.x:3000`.

### Integration Checks

1. Verify kiosk registration success logs on both sides.
2. Insert coin and confirm ESP32 logs HTTP 200 for `/coin`.
3. Verify kiosk logs `coin_accepted`.
4. Verify `/api/balance` increments.
5. Verify `/confirm` balance updates in real time.

## Acceptance Criteria

1. With kiosk connected to `PrintBit`, each accepted coin pulse results in one accepted secure `/coin` request.
2. Kiosk balance increases accordingly and emits real-time UI update.
3. ESP32 logs provide actionable reason on every failure class.
4. Flow works on laptop development and Windows tablet without serial ports.

## Risks and Mitigations

1. **Risk:** Kiosk IP changes after reconnect.
   - **Mitigation:** periodic re-registration loop and dynamic target overwrite.
2. **Risk:** Secret mismatch between firmware and kiosk env.
   - **Mitigation:** startup diagnostics and explicit auth failure logging.
3. **Risk:** Duplicate delivery on retries.
   - **Mitigation:** preserve event ID uniqueness per coin and rely on kiosk idempotency.
