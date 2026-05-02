---
applyTo: '**/*.ino,**/esp32*'
---

# PrintBit — ESP32 firmware conventions

## Context

`esp32-captive-portal.ino` is the single firmware file for the ESP32 hardware bridge.
It handles:

1. WiFiManager-based STA-mode onboarding (joins campus/home LAN, no AP-only mode)
2. Kiosk IP registration (`POST /kiosk/register` on kiosk)
3. Coin event forwarding (`POST /coin` on kiosk) with idempotency headers
4. Hopper dispense command listener (`POST /hopper/dispense`, `GET /hopper/status`)
5. Captive portal probe responses for OS-specific auto-open behavior

## Hard rules for firmware changes

1. **Never remove idempotency** — every coin event must carry a unique `x-coin-event-id`.
   Duplicate events must be suppressed client-side (ESP32) and server-side (kiosk).
2. **Never remove auth headers** — `x-coin-source` and `x-coin-api-key` are required on every `/coin` request.
3. **Never switch back to AP-only mode** — the current architecture is STA mode via WiFiManager.
   AP mode caused phantom coin events during reconnection; do not regress.
4. **Never block the main loop** — use non-blocking patterns (`millis()` timers, async HTTP).
5. **Coin events during reconnection must be suppressed** — check WiFi connection state before forwarding.

## WiFiManager integration pattern

- Config portal SSID: `PrintBit-Setup`, password: `printbit123` (firmware defaults)
- On successful connection, resolve kiosk IP via `KIOSK_IP` serial command
- Store kiosk IP in `Preferences` (NVS) for reboot persistence
- Static DHCP reservation on router is recommended but not required

## Coin bridge request format

```list
POST http://<kiosk-ip>:3000/coin
Headers:
  x-coin-source: esp32
  x-coin-api-key: <coinBridgeApiKey>
  x-coin-event-id: <unique-uuid-per-coin>
  Content-Type: application/json
Body: { "value": <coin_value_in_pesos> }
```

## Hopper dispense command format

```list
POST http://<esp32-ip>/hopper/dispense
Body: { "token": <hopperControlToken>, "coins": <count>, "requestId": <optional-uuid> }
```

## Variable naming

- Keep existing variable names (`coinBridgeApiKey`, `hopperControlToken`, `kioskIp`, etc.)
- Do not rename settled serial protocol commands (`KIOSK_IP`, `COIN_ACCEPTED`, `DISPENSE_DONE`, etc.)

## Serial protocol (kiosk → ESP32)

- Commands are newline-terminated ASCII strings
- `KIOSK_IP:<ip>` — tells ESP32 the kiosk's current IP
- Do not add new serial commands without updating `src/services/` serial handler on the kiosk side
