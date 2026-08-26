# Hardware integration

Read this when working on serial communication, the ESP32 coin bridge, or the hopper.

## Serial path (Arduino coin acceptor / hopper)

- The shared serial port is managed in `src/services/serial*.ts` — do not open a new connection elsewhere.
- Serial commands are newline-terminated ASCII.
- `KIOSK_IP <ip> [port] [path]` announces the kiosk's reachable IP and port to the ESP32 over serial.
- Inbound serial telemetry lines parsed by Node.js:
  - `AP_IP:<ip>` — ESP32 Access Point IP (e.g. `192.168.4.1`)
  - `STA_IP:<ip>` — ESP32 Station LAN IP when connected to external Wi-Fi
  - `KIOSK_IP:<ip>` — Active kiosk IP confirmed by ESP32
  - `coin_target:<url>` — Target URL for HTTP coin notifications
  - `portal_target:<url>` — Target URL for mobile captive portal redirects
- Hopper dispense is initiated by the kiosk and acknowledged via serial; guard against concurrent access.

## ESP32 Dynamic IP Discovery & NVS Persistence

- **Zero Hardcoded Credentials:** All Wi-Fi credentials (`ap_ssid`, `ap_pass`, `sta_ssid`, `sta_pass`) and kiosk endpoint configs are stored in NVS flash memory (`Preferences.h`).
- **mDNS Admin Gateway (`http://printbit.local/admin`):** Admins connected to `PrintBit` Wi-Fi can navigate directly to `http://printbit.local/admin` (or `http://192.168.4.1/admin`). The ESP32 302-redirects directly to the active Kiosk Node.js dashboard without needing to know the kiosk's internal dynamic IP or port.
- **Native Setup Portal (`http://printbit.local/setup`):** A lightweight, non-blocking configuration page to scan local Wi-Fi networks, enter router credentials, and update the AP password over the air.
- **Subnet-Aware Discovery:** Node.js auto-detects the network adapter matching the ESP32 AP subnet (`192.168.4.x`) or local private network.
- **Dual-Channel Handshake:** Kiosk IP announcements occur both over USB Serial (`KIOSK_IP ...`) upon port connection and via HTTP `POST /kiosk/register`.

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

- Architecture: Dual AP + STA mode (AP SSID `PrintBit` on `192.168.4.1` for customer uploads; background non-blocking STA mode for router connectivity).
- Coin events prioritize the direct USB Serial connection (`coin_pulse:<value>`) for zero-latency, zero-network-dependent payment crediting.
- Never block `loop()` — use `millis()` timers and non-blocking HTTP to preserve coin pulse and sensor interrupt accuracy.

