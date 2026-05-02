# Hardware integration

Read this when working on serial communication, the ESP32 coin bridge, or the hopper.

## Serial path (Arduino coin acceptor / hopper)

- The shared serial port is managed in `src/services/serial*.ts` — do not open a new connection elsewhere.
- Serial commands are newline-terminated ASCII. `KIOSK_IP:<ip>` tells the ESP32 the kiosk's current IP.
- Hopper dispense is initiated by the kiosk and acknowledged via serial; guard against concurrent access.

## ESP32 HTTP bridge

Coin events arrive at `POST /coin` on the kiosk with these required headers:

```list
x-coin-source: esp32
x-coin-api-key: <PRINTBIT_ESP32_COIN_API_KEY>
x-coin-event-id: <unique UUID per physical coin insertion>
```

Idempotency is enforced by `x-coin-event-id` on both the ESP32 (suppress retransmit) and the kiosk
(deduplicate in the bridge handler). **Never remove either check** — removing either causes double-credit.

Hopper commands from kiosk to ESP32:

```list
POST http://<esp32-ip>/hopper/dispense
Body: { "token": <hopperControlToken>, "coins": <count>, "requestId": <optional-uuid> }

GET http://<esp32-ip>/hopper/status?token=<hopperControlToken>
```

## ESP32 firmware (`esp32-captive-portal.ino`)

- Current architecture: **STA mode via WiFiManager** (joins LAN, no AP-only mode).
  AP-only mode was retired — it caused phantom coin events during reconnection.
- Config portal defaults: SSID `PrintBit-Setup`, password `printbit123`.
- Coin events must be suppressed while WiFi is reconnecting (check connection state before forwarding).
- Never block `loop()` — use `millis()` timers and non-blocking HTTP.
