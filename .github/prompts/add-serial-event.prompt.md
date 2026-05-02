# Add a new coin/hopper/serial event to PrintBit

## When to use

Use when adding a new serial event type, a new coin bridge message, or a new hopper command.
These paths are **safety-critical** — follow every step.

## Context

PrintBit has two serial/hardware integration paths:

1. **Arduino/serial path** — direct `serialport` integration for coin acceptor and hopper on COM port
2. **ESP32 bridge path** — HTTP `/coin` endpoint with `x-coin-source`, `x-coin-api-key`, `x-coin-event-id` headers

## Instructions

**Required inputs:**

- Event name / command name
- Direction: kiosk→hardware or hardware→kiosk
- Which path: serial (Arduino) or HTTP bridge (ESP32)
- What the event triggers in the kiosk

**Steps to follow:**

1. **Read first (mandatory):**
   - `src/services/serial*.ts` — existing serial event dispatch pattern
   - The `/coin` bridge route handler in `src/routes/`
   - `esp32-captive-portal.ino` — if the event originates from or targets ESP32

2. **For a new inbound hardware event (hardware → kiosk):**
   - Add the event parser to the relevant service in `src/services/`
   - **Idempotency gate:** if the event carries a financial consequence, add an event-ID deduplication check
   - Emit the appropriate Socket.IO event to update the UI
   - Log the raw event before processing (for audit trail)

3. **For a new outbound command (kiosk → hardware):**
   - Send via the existing serial write method — do not open a new port connection
   - Add a timeout + failure path (hardware may not ack)
   - If the command is via HTTP to ESP32, add the equivalent handler in `esp32-captive-portal.ino`

4. **For ESP32 firmware changes:**
   - Follow `.github/instructions/esp32.instructions.md`
   - Add `x-coin-event-id` to any new coin-class event
   - Never block the Arduino `loop()`

5. **Run validation:**

   ```bash
   pnpm exec tsc --noEmit --ignoreDeprecations 6.0
   ```

6. **Update docs:**
   - `ARCHITECTURE.md` — serial/hardware flow section
   - `WINDOWS_TABLET_ESP32_KIOSK_SETUP.md` — if ESP32 firmware was changed

## Safety checklist before declaring done

- [ ] Duplicate event cannot cause double-credit or double-dispense
- [ ] Failure of hardware ack does not leave kiosk in an inconsistent state
- [ ] New event is logged with timestamp and raw value
- [ ] Socket.IO UI update is consistent with the new event
