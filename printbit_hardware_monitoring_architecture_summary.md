# PrintBit Hardware Monitoring & Error Handling Architecture Summary

## Overview

This document summarizes the planning discussion for implementing reliable printer and scanner monitoring, hardware error handling, and kiosk-grade orchestration in PrintBit.

The current PrintBit printing stack uses:

- GhostScript
- PDFtoPrinter
- SumatraPDF

These tools are suitable for:

- PDF rendering
- print spooling
- print dispatching

However, they are not reliable telemetry sources for:

- printer hardware status
- scanner state monitoring
- paper jams
- ink levels
- ADF detection
- printer connectivity

Therefore, PrintBit requires a dedicated hardware monitoring layer.

---

## Current Problem

Current architecture is effectively:

```txt
UI
 → child_process.spawn()
 → Sumatra/PDFtoPrinter
 → Windows spooler
 → printer
```

This architecture can execute print jobs, but it cannot reliably determine:

- why printing failed
- whether the printer is offline
- whether paper is empty
- whether the scanner feeder has documents
- whether the spooler is stalled

---

## Recommended Architecture

Recommended long-term architecture:

```txt
Frontend
(Electron / Next.js)

↓ WebSocket / IPC

Node.js Print Orchestrator

↓ edge-js bridge

.NET Hardware Layer

↓ Windows APIs

Windows Print Spooler
WMI
WIA/TWAIN
Printer
Scanner
```

This separates responsibilities cleanly:

| Layer               | Responsibility                         |
| ------------------- | -------------------------------------- |
| UI                  | User interaction                       |
| Node.js             | orchestration, queues, realtime events |
| .NET                | hardware integration                   |
| GhostScript/Sumatra | rendering and printing                 |
| Windows APIs        | telemetry and hardware state           |

---

## Why edge-js Was Recommended

`edge-js` is recommended because it allows Node.js to directly communicate with C#/.NET.

Advantages:

- Access to native Windows printer APIs
- Better WMI integration
- Better scanner support
- Cleaner queue monitoring
- More reliable hardware telemetry
- Event-driven monitoring support
- Less PowerShell polling

Recommended usage:

```txt
Electron / Next.js
↓
Node.js Service Layer
↓ edge-js
C# Hardware Layer
↓
Windows APIs
```

Avoid scattering multiple edge-js calls throughout the codebase.

Instead:

- centralize hardware logic in a dedicated .NET layer
- expose clean methods to Node.js

Example:

```ts
printer.getStatus();
printer.printPdf();
scanner.scan();
scanner.hasDocument();
```

---

# Epson L5290 ADF Planning

The Epson EcoTank L5290 is a good target device because it supports:

- ADF scanning
- WIA
- TWAIN
- USB and WiFi
- multifunction workflows

---

# Expected Detectable States

## Printing

| Scenario             | Reliability |
| -------------------- | ----------- |
| Printer offline      | High        |
| Printer disconnected | High        |
| Paper out            | Medium-High |
| Queue stalled        | High        |
| Paper jam            | Medium      |
| Ink low              | Medium      |

---

## Scanner / ADF

| Scenario             | Reliability |
| -------------------- | ----------- |
| ADF empty            | High        |
| Scanner disconnected | High        |
| Scanner busy         | High        |
| Scan timeout         | High        |
| Scan jam             | Medium      |
| Flatbed open         | Low-Medium  |

---

# Scanner Stack Recommendation

## Phase 1: WIA

Start with:

- WIA
- Windows-native scanner integration
- ADF support
- basic feeder telemetry

WIA is easier to integrate and deploy.

---

## Phase 2: TWAIN

Introduce TWAIN only if:

- WIA lacks required telemetry
- Epson drivers behave inconsistently
- advanced scan control becomes necessary

TWAIN is more powerful but significantly harder to maintain.

---

# Error Normalization Layer

Never expose raw driver or OS errors directly to the UI.

Recommended enum:

```ts
export enum DeviceErrorCode {
  PRINTER_OFFLINE = 'PRINTER_OFFLINE',
  PRINTER_DISCONNECTED = 'PRINTER_DISCONNECTED',
  PAPER_OUT = 'PAPER_OUT',
  PAPER_JAM = 'PAPER_JAM',
  OUT_OF_INK = 'OUT_OF_INK',
  SCANNER_EMPTY = 'SCANNER_EMPTY',
  SCANNER_DISCONNECTED = 'SCANNER_DISCONNECTED',
  PRINT_TIMEOUT = 'PRINT_TIMEOUT',
  SPOOLER_ERROR = 'SPOOLER_ERROR',
  UNKNOWN = 'UNKNOWN',
}
```

---

# Detection Strategy

## Layer A: Hardware Detection

Use:

- WMI
- Win32_Printer
- PrintQueue APIs
- WIA

Detect:

- printer offline
- printer disconnected
- paper out
- queue paused
- scanner connected
- scanner feeder state

---

## Layer B: Job Monitoring

Track print lifecycle:

```txt
QUEUED
→ SPOOLING
→ PRINTING
→ COMPLETED
```

Monitor:

- stalled jobs
- timeout conditions
- queue freezes
- retry attempts

---

## Layer C: Executable Monitoring

Wrap:

- GhostScript
- SumatraPDF
- PDFtoPrinter

Capture:

- exit codes
- stderr
- stdout
- process crashes
- timeout failures

This layer should only be a fallback telemetry source.

---

# Important Architectural Rule

Do NOT rely primarily on:

```txt
stderr contains 'paper jam'
```

Instead prefer:

```csharp
PrintQueue.QueueStatus
```

Native Windows APIs are significantly more reliable.

---

# Suggested Services

## Printing Services

```txt
src/services/printing/
 ├─ print-orchestrator.service.ts
 ├─ printer-monitor.service.ts
 ├─ scanner-monitor.service.ts
 ├─ spooler.service.ts
 ├─ hardware-status.service.ts
 ├─ print-job.service.ts
 └─ error-normalizer.service.ts
```

---

# Suggested Native Layer

```txt
native/
 ├─ PrintBit.HardwareAgent/
 │   ├─ PrinterService.cs
 │   ├─ ScannerService.cs
 │   ├─ WmiService.cs
 │   ├─ QueueMonitor.cs
 │   └─ Models/
```

---

# Suggested Node.js Bridge

```txt
src/native/
 ├─ edge/
 │   ├─ printer.edge.ts
 │   ├─ scanner.edge.ts
 │   └─ hardware.edge.ts
```

---

# Suggested Queue Layer

```txt
src/queues/
 ├─ print.queue.ts
 ├─ scan.queue.ts
 ├─ retry.queue.ts
 └─ job-timeout.manager.ts
```

---

# Suggested Scanner Layer

```txt
src/services/scanning/
 ├─ wia.service.ts
 ├─ twain.service.ts
 ├─ adf-monitor.service.ts
 └─ scan-session.service.ts
```

---

# Suggested Config Layer

```txt
src/config/
 ├─ printer.config.ts
 ├─ scanner.config.ts
 └─ hardware.config.ts
```

Example:

```ts
export default {
  pollingInterval: 5000,
  printTimeout: 120000,
  retryAttempts: 3,
};
```

---

# Suggested Logging Layer

```txt
src/logging/
 ├─ printer.logger.ts
 ├─ scanner.logger.ts
 └─ hardware.logger.ts
```

Log:

- print failures
- scanner failures
- spooler crashes
- retries
- timeouts

---

# Suggested Recovery Layer

```txt
src/recovery/
 ├─ spooler-recovery.service.ts
 ├─ printer-retry.service.ts
 └─ watchdog.service.ts
```

---

# Suggested API Endpoints

```txt
GET /printer/status
GET /scanner/status
POST /print
POST /scan
GET /jobs
```

---

# Suggested Admin Diagnostics UI

Potential pages:

```txt
printer-status
scanner-status
hardware-diagnostics
failed-jobs
queue-monitor
```

---

# Suggested bin/ Additions

```txt
bin/
 ├─ scanner/
 ├─ drivers/
 ├─ powershell/
 └─ diagnostics/
```

Potential scripts:

- printer-status.ps1
- scanner-status.ps1
- restart-spooler.ps1
- diagnostics.ps1

---

# Recommended Development Phases

## Phase 1

Implement:

- printer-monitor.service.ts
- hardware-status.service.ts
- print-orchestrator.service.ts
- error-normalizer.service.ts

Focus:

- printer status
- queue monitoring
- offline detection
- paper detection

---

## Phase 2

Implement:

- scanner-monitor.service.ts
- adf-monitor.service.ts
- WIA integration

Focus:

- ADF detection
- scanner connectivity
- scan workflows

---

## Phase 3

Implement:

```txt
native/dotnet/
```

Focus:

- .NET hardware layer
- native telemetry
- realtime monitoring
- spooler event subscriptions

---

# Important Constraints

Printer vendors behave inconsistently.

Meaning:

- Epson may expose richer telemetry
- Brother may expose limited telemetry
- Canon may expose partial telemetry
- generic drivers may expose almost nothing

Therefore:

- detection must support fallbacks
- telemetry confidence levels are recommended
- multiple detection sources should be supported

Example:

```ts
{
  code: 'PAPER_OUT',
  confidence: 'high',
  source: 'wmi'
}
```

---

# Final Recommendation

PrintBit is evolving beyond a standard web application.

It is becoming:

```txt
Kiosk middleware + hardware orchestration platform
```

Therefore:

- Node.js should handle orchestration
- .NET should handle hardware
- GhostScript/Sumatra should handle rendering
- Windows APIs should provide telemetry

Maintaining clean separation between these layers early is critical for:

- maintainability
- reliability
- diagnostics
- kiosk recovery
- scalability
- multi-device support
