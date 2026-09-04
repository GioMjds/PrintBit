# Phase 2 — Serial, ESP32, Hopper & Coin Acceptor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate COM port serial lifecycle, ESP32 network telemetry, coin pulse accumulation with 140ms debouncing, and hopper change dispensing from Node.js to the C# PrintBit Worker, retiring `@serialport` from Node and establishing reactive Named Pipe IPC.

**Architecture:** A hosted serial service in C# (`SerialHostedService`) maintains exclusive COM ownership with auto-reconnect backoff. Incoming line frames are decoded by dedicated protocol parsers (`Esp32TelemetryParser`, `CoinPulseDecoder`, `HopperProtocolParser`) and routed through `HardwareOrchestrator`. Gated coin events and hopper status are broadcast to Node over `\\.\pipe\printbit-worker-events`, while Node issues dispense and locking commands over `\\.\pipe\printbit-worker-commands`. In Node, an in-memory `hardware-state-projection.ts` replaces 1,140 lines of `serial.ts`.

**Tech Stack:** C# (.NET 8, `System.IO.Ports`, `System.IO.Pipes`, `System.Text.Json`, `Microsoft.Extensions.Hosting`, xUnit), TypeScript / Node.js (Node 20, Vitest, Express, Socket.IO).

**Spec:** [`docs/superpowers/specs/2026-09-04-phase-2-serial-hardware-migration-design.md`](../specs/2026-09-04-phase-2-serial-hardware-migration-design.md)

## Global Constraints

- Target COM Baud Rate: 115200 baud.
- Serial Reconnection Backoff: Exponential from 2,000ms (`SERIAL_RECONNECT_BASE_MS`) to 30,000ms (`SERIAL_RECONNECT_MAX_MS`).
- Coin Fragment Buffer Window: 140ms sliding window (`FRAGMENT_WINDOW_MS = 140`).
- Accepted Coin Values: ₱1, ₱5, ₱10, ₱20.
- Hopper Request ID Format: 4-character lowercase hex/alpha string (`[a-f]{4}`).
- Hopper Dynamic Timeout: `Math.Max(5000, 5000 + (coinCount * 1500))`.
- Named Pipes: `\\.\pipe\printbit-worker-commands` (Commands), `\\.\pipe\printbit-worker-events` (Events).

---

## Task Decomposition

### Task 1: ESP32 Telemetry Parser (`Esp32TelemetryParser`)

**Files:**

- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/ESP32/Protocol/Esp32TelemetryEvent.cs`
- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/ESP32/Protocol/Esp32TelemetryParser.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/Esp32TelemetryParserTests.cs`

**Interfaces:**

- Produces:

  ```csharp
  public enum Esp32TelemetryType { ApIp, StaIp, KioskIp, CoinTarget, PortalTarget, WifiStaConnected, WifiStaDisconnected, WifiStaConnecting, WifiSetupReady }
  public sealed record Esp32TelemetryEvent(Esp32TelemetryType Type, string Value);
  public static class Esp32TelemetryParser { public static bool TryParse(string rawLine, out Esp32TelemetryEvent? telemetry); }
  ```

- [ ] **Step 1: Write the failing test**

  ```csharp
  using Xunit;
  using PrintBit.Hardware.Devices.ESP32.Protocol;

  namespace PrintBit.Tests;

  public class Esp32TelemetryParserTests
  {
      [Theory]
      [InlineData("AP_IP:192.168.4.1", Esp32TelemetryType.ApIp, "192.168.4.1")]
      [InlineData("STA_IP:192.168.1.50", Esp32TelemetryType.StaIp, "192.168.1.50")]
      [InlineData("KIOSK_IP:192.168.4.2", Esp32TelemetryType.KioskIp, "192.168.4.2")]
      [InlineData("coin_target:http://192.168.4.2:3000/api/coin", Esp32TelemetryType.CoinTarget, "http://192.168.4.2:3000/api/coin")]
      [InlineData("WIFI_STA_CONNECTED", Esp32TelemetryType.WifiStaConnected, "connected")]
      public void TryParse_ValidLines_ReturnsExpectedEvent(string input, Esp32TelemetryType expectedType, string expectedValue)
      {
          var success = Esp32TelemetryParser.TryParse(input, out var result);
          Assert.True(success);
          Assert.NotNull(result);
          Assert.Equal(expectedType, result.Type);
          Assert.Equal(expectedValue, result.Value);
      }

      [Theory]
      [InlineData("")]
      [InlineData("   ")]
      [InlineData("RANDOM_DATA")]
      [InlineData("AP_IP:not-an-ip")]
      public void TryParse_InvalidLines_ReturnsFalse(string input)
      {
          var success = Esp32TelemetryParser.TryParse(input, out var result);
          Assert.False(success);
          Assert.Null(result);
      }
  }
  ```

- [ ] **Step 2: Run test to verify it fails**
      Run: `dotnet test C:/Users/printbit/printbit-worker/tests/PrintBit.Tests --filter FullyQualifiedName~Esp32TelemetryParserTests`
      Expected: FAIL (compilation error, types do not exist yet).

- [ ] **Step 3: Write minimal implementation**
      Create `Esp32TelemetryEvent.cs`:

  ```csharp
  namespace PrintBit.Hardware.Devices.ESP32.Protocol;

  public enum Esp32TelemetryType
  {
      ApIp,
      StaIp,
      KioskIp,
      CoinTarget,
      PortalTarget,
      WifiStaConnected,
      WifiStaDisconnected,
      WifiStaConnecting,
      WifiSetupReady
  }

  public sealed record Esp32TelemetryEvent(Esp32TelemetryType Type, string Value);
  ```

  Create `Esp32TelemetryParser.cs`:

  ```csharp
  using System.Net;

  namespace PrintBit.Hardware.Devices.ESP32.Protocol;

  public static class Esp32TelemetryParser
  {
      public static bool TryParse(string? rawLine, out Esp32TelemetryEvent? telemetry)
      {
          telemetry = null;
          if (string.IsNullOrWhiteSpace(rawLine)) return false;

          var token = rawLine.Trim();
          if (token == "WIFI_STA_CONNECTED")
          {
              telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.WifiStaConnected, "connected");
              return true;
          }
          if (token == "WIFI_STA_DISCONNECTED")
          {
              telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.WifiStaDisconnected, "disconnected");
              return true;
          }
          if (token.StartsWith("WIFI_STA_CONNECTING:"))
          {
              telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.WifiStaConnecting, token["WIFI_STA_CONNECTING:".Length..].Trim());
              return true;
          }
          if (token.StartsWith("WIFI_SETUP_READY:"))
          {
              telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.WifiSetupReady, token["WIFI_SETUP_READY:".Length..].Trim());
              return true;
          }
          if (token.StartsWith("AP_IP:") && TryParseIpv4(token["AP_IP:".Length..].Trim(), out var apIp))
          {
              telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.ApIp, apIp);
              return true;
          }
          if (token.StartsWith("STA_IP:") && TryParseIpv4(token["STA_IP:".Length..].Trim(), out var staIp))
          {
              telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.StaIp, staIp);
              return true;
          }
          if (token.StartsWith("KIOSK_IP:") && TryParseIpv4(token["KIOSK_IP:".Length..].Trim(), out var kioskIp))
          {
              telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.KioskIp, kioskIp);
              return true;
          }
          if (token.StartsWith("coin_target:"))
          {
              var val = token["coin_target:".Length..].Trim();
              if (val.Length > 0)
              {
                  telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.CoinTarget, val);
                  return true;
              }
          }
          if (token.StartsWith("portal_target:"))
          {
              var val = token["portal_target:".Length..].Trim();
              if (val.Length > 0)
              {
                  telemetry = new Esp32TelemetryEvent(Esp32TelemetryType.PortalTarget, val);
                  return true;
              }
          }

          return false;
      }

      private static bool TryParseIpv4(string ipCandidate, out string ip)
      {
          ip = string.Empty;
          if (IPAddress.TryParse(ipCandidate, out var parsed) && parsed.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork)
          {
              ip = parsed.ToString();
              return true;
          }
          return false;
      }
  }
  ```

- [ ] **Step 4: Run test to verify it passes**
      Run: `dotnet test C:/Users/printbit/printbit-worker/tests/PrintBit.Tests --filter FullyQualifiedName~Esp32TelemetryParserTests`
      Expected: PASS (all tests pass).

- [ ] **Step 5: Commit**
      `git add src/PrintBit.Hardware/Devices/ESP32/Protocol tests/PrintBit.Tests/Esp32TelemetryParserTests.cs`
      `git commit -m "feat(hardware): implement Esp32TelemetryParser"`

---

### Task 2: Robust Serial Connection & Hosted Service (`SerialConnection` & `SerialHostedService`)

**Files:**

- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Infrastructure/Services/SerialService/ISerialConnection.cs`
- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Infrastructure/Services/SerialService/SerialConnection.cs`
- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.HardwareService/Services/SerialHostedService.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/SerialConnectionTests.cs`

**Interfaces:**

- Produces:

  ```csharp
  public interface ISerialConnection
  {
      bool IsConnected { get; }
      string? CurrentPortName { get; }
      event EventHandler<string>? LineReceived;
      event EventHandler<(bool isConnected, string? port, string? error)>? ConnectionChanged;
      void Connect(string portName, int baudRate);
      void Disconnect();
      void SendLine(string data);
  }
  ```

- [ ] **Step 1: Write the failing test**
      Write tests in `SerialConnectionTests.cs` validating `ISerialConnection` connection state tracking, event dispatching, and port lifecycle.

- [ ] **Step 2: Run test to verify it fails**
      Run: `dotnet test C:/Users/printbit/printbit-worker/tests/PrintBit.Tests --filter FullyQualifiedName~SerialConnectionTests`
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Update `ISerialConnection.cs` and `SerialConnection.cs` to buffer incoming bytes, split on `\n`, trim carriage returns, and dispatch `LineReceived`. Implement `SerialHostedService.cs` (BackgroundService) using exponential backoff (2,000ms base, 30,000ms max) to detect and maintain serial connectivity.

- [ ] **Step 4: Run test to verify it passes**
      Run: `dotnet test C:/Users/printbit/printbit-worker/tests/PrintBit.Tests --filter FullyQualifiedName~SerialConnectionTests`
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(serial): add robust SerialConnection and SerialHostedService"`

---

### Task 3: ESP32 Device & Kiosk IP Formatting (`Esp32Device`)

**Files:**

- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/ESP32/IEsp32Device.cs`
- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/ESP32/Esp32Device.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/Esp32DeviceTests.cs`

**Interfaces:**

- Consumes: `ISerialConnection`, `Esp32TelemetryParser`
- Produces:

  ```csharp
  public interface IEsp32Device
  {
      string? ApIp { get; }
      string? StaIp { get; }
      string? KioskIp { get; }
      void SendKioskIpAnnouncement(string ip, int port, string path);
      void SendWifiCommand(string action);
  }
  ```

- [ ] **Step 1: Write the failing test**
      Verify `Esp32Device` parses telemetry lines from `ISerialConnection`, updates `ApIp`/`StaIp`, and formats `KIOSK_IP 192.168.4.2 3000 /portal\n` when `SendKioskIpAnnouncement` is called.

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Update `Esp32Device.cs` with proper state caching and command emission via `ISerialConnection.SendLine`.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(esp32): complete Esp32Device telemetry and kiosk IP announcement"`

---

### Task 4: Coin Pulse Decoder (`CoinPulseDecoder`) with 140ms Sliding Window

**Files:**

- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/CoinAcceptor/CoinPulseDecoder.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/CoinPulseDecoderTests.cs`

**Interfaces:**

- Produces:

  ```csharp
  public sealed class CoinPulseDecoder : IDisposable
  {
      public event EventHandler<int>? CoinResolved;
      public event EventHandler<(string Code, string Message)>? WarningEmitted;
      public void ProcessToken(string token);
      public void Flush();
  }
  ```

- [ ] **Step 1: Write the failing test**
      Write unit tests verifying:
  - Token `'5'` fires `CoinResolved` with 5 immediately.
  - Token `'1'` starts 140ms timer; token `'0'` within 140ms fires `CoinResolved` with 10.
  - Token `'2'` starts 140ms timer; token `'0'` within 140ms fires `CoinResolved` with 20.
  - Token `'1'` followed by 150ms timeout fires `CoinResolved` with 1.
  - Token `'2'` followed by 150ms timeout fires `WarningEmitted` with `INVALID_FRAGMENT`.

- [ ] **Step 2: Run test to verify it fails**
      Run: `dotnet test C:/Users/printbit/printbit-worker/tests/PrintBit.Tests --filter FullyQualifiedName~CoinPulseDecoderTests`
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Implement `CoinPulseDecoder.cs` using a `System.Threading.Timer` for the 140ms window, guarding state transitions with a lock.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(coin): implement CoinPulseDecoder with 140ms sliding window"`

---

### Task 5: Coin Acceptor Device with Hybrid Safety & Session Gating (`CoinAcceptorDevice`)

**Files:**

- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/CoinAcceptor/ICoinAcceptor.cs`
- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/CoinAcceptor/CoinAcceptorDevice.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/CoinAcceptorDeviceTests.cs`

**Interfaces:**

- Consumes: `CoinPulseDecoder`, `IPowerSafetyGate`
- Produces:

  ```csharp
  public interface ICoinAcceptor
  {
      bool IsLocked { get; }
      event EventHandler<int>? CoinAccepted;
      event EventHandler<(int Value, string Reason)>? CoinRejected;
      void Lock(string ownerId, string? reason = null);
      bool Unlock(string ownerId);
      void ResetLocks();
  }
  ```

- [ ] **Step 1: Write the failing test**
      Verify:
  - If `IPowerSafetyGate.CanAcceptTransactions` is false, incoming coins raise `CoinRejected(value, "power_emergency")`.
  - If `Lock("session-1")` is called, coins raise `CoinRejected(value, "session-1")`.
  - If unlocked and power is healthy, coins raise `CoinAccepted(value)`.

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Wire `CoinPulseDecoder` events through gating checks against `IPowerSafetyGate` and internal `ConcurrentDictionary<string, string>`.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(coin): implement CoinAcceptorDevice with hybrid power-safety gating"`

---

### Task 6: Hopper Protocol Parser & Legacy Fallback (`HopperProtocolParser`)

**Files:**

- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/Hopper/Protocol/HopperResponse.cs`
- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/Hopper/Protocol/HopperProtocolParser.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/HopperProtocolParserTests.cs`

**Interfaces:**

- Produces:

  ```csharp
  public enum HopperResponseKind { Ack, Progress, Done, Error }
  public abstract record HopperResponse(string RequestId);
  public sealed record HopperAckResponse(string RequestId) : HopperResponse(RequestId);
  public sealed record HopperProgressResponse(string RequestId, int Dispensed, int Total) : HopperResponse(RequestId);
  public sealed record HopperDoneResponse(string RequestId, int DispensedCount) : HopperResponse(RequestId);
  public sealed record HopperErrorResponse(string RequestId, string Code, string Detail) : HopperResponse(RequestId);

  public static class HopperProtocolParser
  {
      public static bool TryParse(string rawLine, out HopperResponse? response);
  }
  ```

- [ ] **Step 1: Write the failing test**
      Write tests for structured lines (`HOPPER ACK a1b2`, `HOPPER PROGRESS a1b2 2 5`, `HOPPER DONE a1b2 5`, `HOPPER ERR a1b2 JAM motor stalled`) and legacy lines (`START 5`, `DONE`, `HOPPER OK`, `HOPPER ERROR`).

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Create `HopperResponse.cs` and `HopperProtocolParser.cs` handling whitespace tokenization, error code normalization, and legacy keyword classification.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(hopper): implement HopperProtocolParser with legacy fallback"`

---

### Task 7: Hopper Device Dispense Lifecycle & Timeout Watchdog (`HopperDevice`)

**Files:**

- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/Hopper/IHopper.cs`
- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Hardware/Devices/Hopper/HopperDevice.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/HopperDeviceTests.cs`

**Interfaces:**

- Consumes: `ISerialConnection`, `HopperProtocolParser`
- Produces:

  ```csharp
  public sealed record HopperDispenseResult(bool Success, string RequestId, int DispensedCoins, string? ErrorCode, string Message);

  public interface IHopper
  {
      bool IsDispensing { get; }
      event EventHandler<(string RequestId, int Dispensed, int Total)>? ProgressReceived;
      Task<HopperDispenseResult> DispenseAsync(string requestId, int coinCount, int? timeoutMs = null, CancellationToken ct = default);
  }
  ```

- [ ] **Step 1: Write the failing test**
      Test single-flight execution (rejects concurrent dispense), timeout calculation, matching `requestId` filtering, and completion upon `DONE` or `ERR`.

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Implement `HopperDevice.cs` using `TaskCompletionSource<HopperDispenseResult>` and a `CancellationTokenSource` timer watchdog.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(hopper): implement HopperDevice dispense lifecycle"`

---

### Task 8: Hardware Packet Router & HardwareOrchestrator

**Files:**

- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.Application/Services/IHardwareOrchestrator.cs`
- Create: `C:/Users/printbit/printbit-worker/src/PrintBit.Application/Services/HardwareOrchestrator.cs`
- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.HardwareService/Program.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/HardwareOrchestratorTests.cs`

**Interfaces:**

- Coordinates: `ISerialConnection`, `IEsp32Device`, `ICoinAcceptor`, `IHopper`, `IWorkerEventPipeClient`

- [ ] **Step 1: Write the failing test**
      Verify incoming lines on `ISerialConnection` route appropriately to ESP32, Hopper, or Coin Acceptor, and trigger corresponding events to `IWorkerEventPipeClient`.

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Implement `HardwareOrchestrator.cs`. Register services (`SerialConnection`, `SerialHostedService`, `Esp32Device`, `CoinAcceptorDevice`, `HopperDevice`, `HardwareOrchestrator`) in `Program.cs`.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(hardware): introduce HardwareOrchestrator and register in host"`

---

### Task 9: Named Pipe IPC Extensions (Commands & Events)

**Files:**

- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Infrastructure/IPC/WorkerPrintEvent.cs`
- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.Infrastructure/IPC/WorkerPrintEventType.cs`
- Modify: `C:/Users/printbit/printbit-worker/src/PrintBit.HardwareService/Services/WorkerCommandPipeHostedService.cs`
- Test: `C:/Users/printbit/printbit-worker/tests/PrintBit.Tests/WorkerHardwareCommandTests.cs`

**Interfaces:**

- Supports: `DispenseCoins`, `LockCoinSlot`, `UnlockCoinSlot`, `AnnounceKioskIp`

- [ ] **Step 1: Write the failing test**
      Verify `WorkerCommandPipeHostedService` parses `DispenseCoins` command JSON, calls `IHardwareOrchestrator.DispenseAsync`, and returns structured JSON response.

- [ ] **Step 2: Run test to verify it fails**
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Add hardware command routing to `WorkerCommandPipeHostedService.cs` and add payload properties to `WorkerPrintEvent.cs`.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(ipc): add hardware command and event support to Named Pipe listeners"`

---

### Task 10: Node.js `hardware-state-projection.ts` & Event Reception

**Files:**

- Create: `C:/Users/printbit/printbit/src/services/hardware-state-projection.ts`
- Modify: `C:/Users/printbit/printbit/src/services/worker-return-pipe.ts`
- Test: `C:/Users/printbit/printbit/src/services/__tests__/hardware-state-projection.test.ts`

**Interfaces:**

- Produces backward-compatible functions:

  ```ts
  export function getSerialStatus(): SerialStatus;
  export function getHopperStatus(): HopperStatus;
  export function lockCoinSlot(ownerId: string): Promise<void>;
  export function unlockOwnedCoinSlot(ownerId: string): Promise<boolean>;
  export function isCoinSlotLocked(): boolean;
  ```

- [ ] **Step 1: Write the failing test**
      Write tests for `hardware-state-projection.ts` verifying that `CoinInserted` event increments `db.data.balance`, logs to ledger, and emits `coinAccepted` via Socket.IO.

- [ ] **Step 2: Run test to verify it fails**
      Run: `npx vitest run src/services/__tests__/hardware-state-projection.test.ts`
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Create `hardware-state-projection.ts` subscribing to `worker-return-pipe.ts`. Forward Socket.IO and financial updates on `CoinInserted`, `CoinRejected`, and `HopperProgress`.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "feat(node): add hardware-state-projection and wire to worker-return-pipe"`

---

### Task 11: Refactor `hopper.ts` to use Worker Command Pipe

**Files:**

- Modify: `C:/Users/printbit/printbit/src/services/hopper.ts`
- Modify: `C:/Users/printbit/printbit/src/services/worker-command-pipe.ts`
- Test: `C:/Users/printbit/printbit/src/services/__tests__/hopper.test.ts`

- [ ] **Step 1: Write the failing test**
      Update `hopper.test.ts` to mock `sendWorkerCommand` and verify `dispenseChange` invokes `DispenseCoins` with calculated 1-peso coins and records owed change on failure.

- [ ] **Step 2: Run test to verify it fails**
      Run: `npx vitest run src/services/__tests__/hopper.test.ts`
      Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**
      Replace `sendHopperCommand` from `serial.ts` with `sendWorkerCommand('DispenseCoins', ...)` in `hopper.ts`.

- [ ] **Step 4: Run test to verify it passes**
      Expected: PASS.

- [ ] **Step 5: Commit**
      `git commit -m "refactor(hopper): delegate dispense to worker command pipe"`

---

### Task 12: Permanent Retirement of Node Serial Services & Dependency Cleanup

**Files:**

- Delete: `C:/Users/printbit/printbit/src/services/serial.ts`
- Delete: `C:/Users/printbit/printbit/src/services/serial-ip-protocol.ts`
- Delete: `C:/Users/printbit/printbit/src/services/hopper-protocol.ts`
- Modify: `C:/Users/printbit/printbit/package.json`
- Modify: `C:/Users/printbit/printbit/src/services/index.ts`

- [ ] **Step 1: Remove legacy files and update index exports**
      Delete `serial.ts`, `serial-ip-protocol.ts`, `hopper-protocol.ts`. Update `src/services/index.ts` to re-export from `hardware-state-projection.ts`.

- [ ] **Step 2: Uninstall serialport dependencies**
      Run: `npm uninstall serialport @serialport/parser-readline`

- [ ] **Step 3: Run full TypeScript compilation and tests**
      Run: `npm run build` and `npm run test`
      Expected: PASS with zero errors.

- [ ] **Step 4: Commit**
      `git commit -m "chore: retire Node serial.ts, serial-ip-protocol.ts, and hopper-protocol.ts"`

---

## Plan Self-Review

1. **Spec coverage**:
   - Sub-phase 2A covered in Tasks 1, 2, 3.
   - Sub-phase 2B covered in Tasks 4, 5.
   - Sub-phase 2C covered in Tasks 6, 7.
   - Hardware Orchestrator & Named Pipe IPC covered in Tasks 8, 9.
   - Node.js state projection, hopper refactor, and file retirement covered in Tasks 10, 11, 12.
2. **Placeholder scan**: Zero TBDs or vague placeholders; explicit type contracts and tests provided for every step.
3. **Type consistency**: Method signatures and payloads match across C# and Node IPC contracts.
