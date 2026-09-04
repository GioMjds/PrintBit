# Design Specification: Phase 2 — Serial, ESP32, Hopper & Coin Acceptor Migration

**Document Date:** 2026-09-04  
**Status:** Approved for Implementation Planning  
**Target Projects:** `printbit` (Node.js) & `printbit-worker` (C# .NET 8)

---

## 1. Executive Summary & Objectives

The PrintBit kiosk system currently relies on two Node.js services—[`src/services/serial.ts`](../../src/services/serial.ts) (1,140 lines) and [`src/services/hopper.ts`](../../src/services/hopper.ts) (908 lines)—to manage raw Windows COM ports, parse incoming ASCII line protocols, debounce coin pulse intervals, correlate hopper dispense timeouts, and extract ESP32 network telemetry.

This Phase 2 migration eliminates this hardware burden from Node.js and establishes the **C# PrintBit Worker** as the sole owner of the physical COM port and connected microcontroller devices.

### Key Objectives

1. **Exclusive COM Ownership in C#**: Move `System.IO.Ports.SerialPort` management to a C# background hosted service with automatic port detection and resilient exponential backoff reconnect loops.
2. **Deterministic Frame Parsing**: Replace loose string handling in Node with strongly-typed, memory-efficient C# decoders for ESP32 telemetry, multi-token coin pulses, and Hopper dispense packets.
3. **Hybrid Power & Session Gating**: Automatically suppress coins in C# when the native Windows battery monitor triggers a power emergency, while supporting explicit application-level lock commands from Node.
4. **Structured IPC Communication**: Extend the Windows Named Pipe command listener (`\\.\pipe\printbit-worker-commands`) and event publisher (`\\.\pipe\printbit-worker-events`) to coordinate hardware actions and stream telemetry.
5. **Clean Node Architecture**: Replace `serial.ts` with an in-memory `hardware-state-projection.ts`, delegate hopper dispense to IPC, delete retired protocol files, and remove the `@serialport` native dependency.

---

## 2. System Architecture & Boundaries

```text
┌─────────────────────────────────────────────────────────────┐
│                       Node.js Host                          │
│                                                             │
│  - Financial Ledger & Database Persistence (db.ts)         │
│  - Session Management & Admin UI Handlers                  │
│  - Socket.IO Event Distribution to Frontend                │
│  - Owed Change Tracking (SQLite)                           │
│                                                             │
│         ▲                                         │         │
│         │ (Events via Named Pipe)                 │ (Commands)
│  hardware-state-projection.ts                     │         │
│         ▲                                         ▼         │
└─────────┼─────────────────────────────────────────┼─────────┘
          │ \\.\pipe\printbit-worker-events         │ \\.\pipe\printbit-worker-commands
┌─────────┼─────────────────────────────────────────┼─────────┐
│         ▼                                         ▼         │
│  WorkerEventPipeClient               WorkerCommandPipeHosted │
│  ─────────────────────               ─────────────────────── │
│                        C# Worker Host                       │
│                                                             │
│                     HardwareOrchestrator                    │
│                                                             │
│   ┌───────────────────┬───────────────────┬──────────────┐  │
│   │    Esp32Device    │CoinAcceptorDevice │ HopperDevice │  │
│   └─────────▲─────────┴─────────▲─────────┴───────▲──────┘  │
│             │                   │                 │         │
│   ┌─────────┴───────────────────┴─────────────────┴──────┐  │
│   │                 Hardware Packet Router               │  │
│   │ (Esp32TelemetryParser, CoinPulseDecoder, HopperParser)│  │
│   └─────────────────────────────▲────────────────────────┘  │
│                                 │                           │
│                     SerialHostedService                     │
│                    (ISerialConnection)                      │
│                                 │                           │
└─────────────────────────────────┼───────────────────────────┘
                                  ▼
                         COM Port (115200 baud)
                                  │
                       ESP32 / Arduino Uno Bus
```

---

## 3. Phased Execution Breakdown

To ensure zero operational downtime and isolated verification, Phase 2 is decomposed into three sequential sub-phases:

| Sub-phase | Domain Focus                      | C# Responsibilities                                                                                      | Node.js Changes                                                                              |
| :-------- | :-------------------------------- | :------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| **2A**    | **Serial Core & ESP32 Telemetry** | COM port lifecycle, port auto-detection, auto-reconnect backoff, ESP32 telemetry parser, Kiosk IP push   | Takes exclusive COM port release in Node; receives initial `SerialStatusSnapshot` via IPC    |
| **2B**    | **Coin Acceptor Subsystem**       | 140ms sliding window accumulator, ₱1/₱5/₱10/₱20 resolution, PowerSafetyGate suppression, lock management | Replaces direct coin parsing with reactive `CoinInserted` and `CoinRejected` IPC handlers    |
| **2C**    | **Hopper Dispense Subsystem**     | Request ID correlation (`[a-f]{4}`), timeout scaling, motor error codes, legacy format fallback          | Delegates `hopper.ts` dispense to C# command pipe; listens to `HopperProgress` / `Completed` |

---

## 4. Sub-phase 2A: Serial Core & ESP32 Telemetry

### 4.1 COM Port Lifecycle & Resilient Connection

- **Port Discovery**: `SerialHostedService` queries `System.IO.Ports.SerialPort.GetPortNames()`.
  - Supports configuration override via `HardwareSettings:SerialPortHint` or `PRINTBIT_SERIAL_PORT` env var.
  - If multiple ports exist and no hint is given, selects the first available port and logs details.
- **Auto-Reconnect Backoff**:
  - Reconnection intervals scale exponentially from `SERIAL_RECONNECT_BASE_MS` (2,000ms) to `SERIAL_RECONNECT_MAX_MS` (30,000ms).
  - Handles `UnauthorizedAccessException` (e.g. port busy or Arduino IDE monitor open) with retry delay.
  - Emits health watchdog heartbeats on successful port read/write.

### 4.2 ESP32 Telemetry Parser (`PrintBit.Hardware/Devices/ESP32/Protocol`)

Parses incoming telemetry strings:

- `AP_IP:<ip>` → Access Point IPv4
- `STA_IP:<ip>` → Station (Wi-Fi client) IPv4
- `KIOSK_IP:<ip>` → Confirmed Kiosk IPv4
- `coin_target:<url>` → Target URL for coin webhooks
- `portal_target:<url>` → Target captive portal redirect
- `WIFI_STA_CONNECTED`, `WIFI_STA_DISCONNECTED`, `WIFI_STA_CONNECTING:<ssid>`, `WIFI_SETUP_READY:<url>`

### 4.3 Outbound Kiosk IP & Wi-Fi Commands

- Formats and writes outbound commands to the serial line:
  - `KIOSK_IP <ip> <port> <path>`
  - `WIFI_STATUS`, `WIFI_DISCONNECT`, `WIFI_SCAN`

---

## 5. Sub-phase 2B: Coin Acceptor Subsystem

### 5.1 Pulse Accumulation & Debouncing (`CoinPulseDecoder`)

- **Supported Denominations**: ₱1, ₱5, ₱10, ₱20.
- **Fragment Buffering Logic**:
  - Standalone `'5'`, `'10'`, `'20'` are resolved immediately.
  - When token `'1'` or `'2'` arrives, a **140ms sliding window timer** starts.
  - If `'0'` arrives within 140ms:
    - `'1' + '0'` resolves to **₱10**.
    - `'2' + '0'` resolves to **₱20**.
  - If 140ms window elapses without a subsequent digit:
    - Buffer `'1'` resolves to **₱1**.
    - Buffer `'2'` is discarded as an invalid fragment (emits `CoinParserWarning`).
  - If any non-numeric or unsupported token arrives, it is discarded with a warning event.

### 5.2 Hybrid Safety & Session Gating

`CoinAcceptorDevice` evaluates two gate conditions before accepting any coin:

1. **Autonomous Power Safety**: Queries C#'s `IPowerSafetyGate.CanAcceptTransactions`. If false (battery emergency or tablet unplugged), the coin is rejected immediately (`reason: "power_emergency"`).
2. **Application Session Locks**: Maintains thread-safe active lock entries (`ConcurrentDictionary<string, string>`). If any lock key exists (e.g. active print handoff or admin mode), the coin is rejected (`reason: lockOwnerId`).
3. Rejections publish a `CoinRejected` event to Node so the UI and audit logs can capture the rejection reason.

---

## 6. Sub-phase 2C: Hopper Dispense Subsystem

### 6.1 Protocol Framing & Correlation (`HopperProtocolParser`)

- **Request IDs**: Short 4-character hex strings (`[a-f]{4}`) generated per command to avoid numeric parsing collisions with older Arduino firmware sketches.
- **Outbound Command Format**:
  - `HOPPER DISPENSE <requestId> <coinCount>`
  - `HOPPER SELFTEST <requestId>`
- **Inbound Structured Responses**:
  - `HOPPER ACK <requestId>`: Confirms receipt and arms the motor timeout watchdog.
  - `HOPPER PROGRESS <requestId> <dispensed> <total>`: Real-time progress update per dispensed coin.
  - `HOPPER DONE <requestId> <dispensedCount>`: Payout completed successfully.
  - `HOPPER ERR <requestId> <errorCode> [<detail>]`: Payout failed (`JAM`, `EMPTY`, `MOTOR_TIMEOUT`, `PARTIAL`, `SENSOR`, `UNKNOWN`).
- **Legacy Fallback Handlers**:
  - Recognizes `HOPPER OK` / `HOPPER ERROR ...`.
  - Recognizes plain firmware lines: `START <total>`, `DONE [<dispensed>]`, `ERROR ...` and applies the 20,000ms timeout extension.

### 6.2 Dispense Lifecycle in `HopperDevice`

- Ensures only **one active dispense command** executes at a time; rejects concurrent requests.
- Dynamic timeout calculation: `TimeoutMs = Math.Max(5000, 5000 + (coinCount * 1500))`.
- Asynchronously completes a `TaskCompletionSource<DispenseCoinsResult>` upon `DONE`, `ERR`, or timeout.

---

## 7. IPC Contracts & Data Transfer Objects

### 7.1 Named Pipe Commands (Node → C#)

Sent over `\\.\pipe\printbit-worker-commands`:

```csharp
public enum HardwareCommandType
{
    DispenseCoins,
    LockCoinSlot,
    UnlockCoinSlot,
    ResetCoinSlotLocks,
    AnnounceKioskIp
}

public sealed class DispenseCoinsCommandPayload
{
    public string RequestId { get; set; } = string.Empty;
    public int CoinCount { get; set; }
    public int? TimeoutMs { get; set; }
}

public sealed class LockCoinSlotCommandPayload
{
    public string OwnerId { get; set; } = string.Empty;
    public string? Reason { get; set; }
}

public sealed class UnlockCoinSlotCommandPayload
{
    public string OwnerId { get; set; } = string.Empty;
}

public sealed class AnnounceKioskIpCommandPayload
{
    public string KioskIp { get; set; } = string.Empty;
    public int Port { get; set; } = 3000;
    public string PortalPath { get; set; } = "/portal";
}
```

### 7.2 Named Pipe Events (C# → Node)

Streamed over `\\.\pipe\printbit-worker-events`:

```csharp
public sealed class HardwareEvent : WorkerPrintEvent
{
    // Extends existing WorkerPrintEvent envelope with:
    public int? CoinValue { get; set; }
    public string? RawToken { get; set; }
    public string? RejectionReason { get; set; }
    public int? DispensedCoins { get; set; }
    public int? TargetCoins { get; set; }
    public string? HardwareErrorCode { get; set; }
    public SerialStatusPayload? SerialStatus { get; set; }
}
```

Event types added:

- `SerialStatusSnapshot`
- `CoinInserted`
- `CoinRejected`
- `CoinParserWarning`
- `HopperProgress`
- `HopperCompleted`
- `HopperFailed`

---

## 8. Node.js Layer Updates & Service Retirement

### 8.1 `hardware-state-projection.ts`

- Singleton holding cached state:
  ```ts
  interface HardwareState {
    connected: boolean;
    portPath: string | null;
    apIp: string | null;
    staIp: string | null;
    kioskIp: string | null;
    coinTarget: string | null;
    portalTarget: string | null;
    lastError: string | null;
  }
  ```
- Listens to `worker-return-pipe.ts` events:
  - On `CoinInserted`: credits `db.data!.balance`, logs to `financialLedgerService`, and emits `balance` + `coinAccepted` via Socket.IO.
  - On `CoinRejected`: logs anomaly and emits `coinRejected` via Socket.IO.
  - On `HopperProgress`: emits `changeDispenseProgress` via Socket.IO.
- Re-exports legacy functions (`getSerialStatus()`, `getHopperStatus()`, `lockCoinSlot()`, `unlockOwnedCoinSlot()`) to preserve API compatibility for all existing controllers and watchdog monitors.

### 8.2 `hopper.ts` Simplification

- Keeps 1-peso change computation (`computeDispenseCoins`) and SQLite owed-change persistence (`recordOwedChange`).
- Replaces direct serial writes with:
  ```ts
  const result = await sendWorkerCommand<DispenseCoinsResult>('DispenseCoins', {
    requestId: generateRequestId(),
    coinCount: change.coins,
    timeoutMs,
  });
  ```

### 8.3 File & Dependency Retirement

- **Files permanently deleted**:
  - `src/services/serial.ts`
  - `src/services/serial-ip-protocol.ts`
  - `src/services/hopper-protocol.ts`
- **`package.json`**:
  - Uninstall `serialport` and `@serialport/parser-readline`.

---

## 9. Testing & Verification Plan

### 9.1 C# Worker Unit Tests

- `Esp32TelemetryParserTests`: Validates AP_IP, STA_IP, KIOSK_IP, Wi-Fi status lines, and malformed strings.
- `CoinPulseDecoderTests`: Validates immediate coins, 140ms combination buffering (`1`+`0`=10, `2`+`0`=20), timeout flushes (`1` alone = 1), and invalid fragments (`2` alone).
- `CoinAcceptorDeviceTests`: Validates autonomous power gating and Node session lock gating.
- `HopperProtocolParserTests`: Validates ACK, PROGRESS, DONE, ERR tokens, and legacy fallback lines.
- `HopperDeviceTests`: Validates single-flight command execution, timeout scaling, and request ID correlation.

### 9.2 Node.js Integration & Regression Tests

- Verify that `hardware-state-projection.ts` updates in-memory state and triggers Socket.IO broadcasts upon receiving worker return-pipe events.
- Verify `hopper.ts` correctly creates owed-change records in SQLite when a simulated `HopperFailed` or partial dispense IPC response is returned.
- Execute full Node build (`npm run build`) and test suite (`npm run test`) with zero compilation errors.

---

## 10. Risk Mitigation & Rollback Plan

| Risk                          | Impact                            | Mitigation Strategy                                                                                                                            |
| :---------------------------- | :-------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| **COM Port Access Denied**    | Worker cannot open port           | Exponential backoff retry loop; automatic logging identifying conflicting processes (e.g. Arduino IDE).                                        |
| **Packet Fragmentation**      | Corrupted coin or telemetry lines | Line buffering with newline delimiter enforcement; pure validation regexes before event firing.                                                |
| **Unsolicited Hopper Pulses** | Double payout or incorrect ledger | Strict 4-character request ID correlation; pulses without matching active request ID are safely discarded.                                     |
| **Worker Process Crash**      | Hardware stops responding         | Windows Service recovery configuration automatically restarts `PrintBitHardware.exe`; Node state projection reflects offline state reactively. |
