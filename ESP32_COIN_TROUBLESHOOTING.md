# ESP32 Coin Troubleshooting Guide (Secure + Dynamic Registration)

Use this when ESP32 coin pulses appear in Arduino Serial Monitor but kiosk balance/UI does not update.

## Target Working Setup

1. ESP32 hosts WiFi AP: `PrintBit` (password `printbit123`).
2. Kiosk or Windows tablet is connected to that AP (`192.168.4.x`).
3. Kiosk runs PrintBit server on port `3000` with `PRINTBIT_NETWORK_PROVIDER=esp32`.
4. Kiosk auto-registers with ESP32 via `POST /kiosk/register`.
5. ESP32 forwards secure coin events to kiosk `GET /coin`.

## Required Kiosk Environment

```env
PRINTBIT_NETWORK_PROVIDER=esp32
PRINTBIT_HOTSPOT_SSID=PrintBit
PRINTBIT_HOTSPOT_PASSWORD=printbit123
PRINTBIT_HOTSPOT_AUTH_TYPE=WPA
PRINTBIT_ESP32_AP_BASE_URL=http://192.168.4.1
PRINTBIT_ESP32_REGISTER_TOKEN=printbit-register-token
PRINTBIT_ESP32_COIN_SOURCE=esp32
PRINTBIT_ESP32_COIN_API_KEY=printbit-coin-bridge-key
PRINTBIT_ESP32_COIN_BRIDGE_RELAXED=false
PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS=true
```

## 1. Network Connectivity Checks

### On kiosk/tablet

```powershell
ipconfig
```

- Confirm adapter connected to `PrintBit`.
- Confirm IP is `192.168.4.x`.

```powershell
ping 192.168.4.1
```

- Must receive replies from ESP32 AP.

## 2. ESP32 Registration Checks

ESP32 must accept kiosk registration on `http://<esp32-lan-ip>/kiosk/register`.

- In WiFiManager STA mode, use the ESP32 LAN IP shown on serial as `KIOSK_IP:<ip>`.

### Expected kiosk server log behavior

- In ESP32 provider mode, hotspot service attempts periodic registration.
- If registration fails, kiosk logs warning about registration failure.

### Expected ESP32 serial behavior

- On success: logs `kiosk_registered:coin_target=http://<kiosk-ip>:3000/coin`.
- If not yet registered: periodic `kiosk_register_pending:waiting_for_post`.

### Manual registration test (from kiosk)

```powershell
Invoke-WebRequest `
  -Uri 'http://<esp32-lan-ip>/kiosk/register' `
  -Method Post `
  -ContentType 'application/x-www-form-urlencoded' `
  -Body 'token=printbit-register-token&ip=<kiosk-lan-ip>&port=3000&path=/portal'
```

- Replace `<esp32-lan-ip>` and `<kiosk-lan-ip>` with actual LAN addresses.
- Should return HTTP 200 with body `registered`.

## 3. Secure Coin Bridge Checks

ESP32 must call:

- `GET /coin?value=<1|5|10|20>&eventId=<id>`
- Headers:
  - `x-coin-source: esp32`
  - `x-coin-api-key: <configured key>`
  - `x-coin-event-id: <same id>`

### Manual strict-mode endpoint test (from kiosk)

```powershell
$eventId = [guid]::NewGuid().ToString()
Invoke-WebRequest `
  -Uri "http://127.0.0.1:3000/coin?value=5&eventId=$eventId" `
  -Headers @{
    'x-coin-source' = 'esp32'
    'x-coin-api-key' = 'printbit-coin-bridge-key'
    'x-coin-event-id' = $eventId
  } `
  -Method Get
```

- Must return 200 and JSON `{ ok: true, coinValue: 5, balance: ... }`.

## 4. Common Failure Scenarios

### A) Registration never succeeds

**ESP32 logs:** repeated `kiosk_register_pending:waiting_for_post`  
**Cause:** kiosk not connected to AP, wrong AP base URL, or ESP32 not listening on `:80`.

### B) Auth failures

**ESP32 logs:** `coin_send_failed:auth_failed`  
**Cause:** `PRINTBIT_ESP32_COIN_API_KEY` mismatch between kiosk env and firmware.

### C) Validation failures

**ESP32 logs:** `coin_send_failed:validation_failed`  
**Cause:** malformed request (missing/invalid eventId or unsupported coin value).

### D) Coin rejected by kiosk gate

**ESP32 logs:** `coin_send_failed:coin_rejected_409`  
**Cause:** kiosk rejected coin with HTTP 409. With `PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS=true`, this should be rare for ESP32-origin coins.

### E) Network path failure

**ESP32 logs:** `coin_send_failed:network_unreachable` or `...network_unreachable_no_station`  
**Cause:** kiosk disconnected from AP, wrong registered IP, or firewall blocking inbound 3000.

## 5. Firewall Check (Windows kiosk)

```powershell
New-NetFirewallRule -DisplayName "PrintBit Dev 3000" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow
```

## 6. End-to-End Acceptance Test

1. Connect kiosk/tablet and ESP32 to the same 2.4GHz LAN.
2. Start PrintBit server.
3. Confirm ESP32 shows successful kiosk registration log.
4. Insert a coin.
5. Confirm:
   - ESP32 logs `coin_sent_ok`
   - Kiosk logs `coin_accepted`
   - `/api/balance` increased
   - `/confirm` UI updates immediately

## Quick Recovery Checklist

1. Verify kiosk WiFi IP is reachable on the same LAN as ESP32.
2. Verify shared token/key values match between kiosk env and firmware.
3. Verify registration endpoint responds on `http://<esp32-lan-ip>/kiosk/register`.
4. Verify strict `/coin` request succeeds locally with headers.
5. Reboot ESP32 and restart kiosk server after config changes.
