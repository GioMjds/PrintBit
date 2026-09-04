# ESP32–Node liveness contract

The ESP32 must treat Node liveness as a lease, not as a one-time startup state.

## Probe

```text
GET http://192.168.4.2:3000/api/health
```

The ESP32 should poll every 2 seconds. A response is valid only when the HTTP
status is `200` and the JSON field `ok` is `true`.

```json
{
  "ok": true,
  "service": "printbit",
  "timestamp": "...",
  "coinAccepting": true
}
```

The firmware must disable the coin acceptor after 6 seconds without a valid
response. It may enable the coin acceptor only after a valid response and only
when `coinAccepting` is `true`.

If `PRINTBIT_ESP32_HEALTH_TOKEN` is configured, send it in the
`x-esp32-health-token` header. The Node endpoint accepts requests only from
the ESP32 AP address (`192.168.4.1`).

## Worker boundary

The C# worker and Node communicate locally through Windows Named Pipes:

```text
\\.\pipe\printbit-worker-events
\\.\pipe\printbit-worker-commands
```

No network address is required for this boundary. If a future worker feature
uses HTTP, its Node base URL must be `http://127.0.0.1:3000`.
