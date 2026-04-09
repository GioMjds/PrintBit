# Print Dispatcher Migration Design (#112)

## Problem statement

Print dispatch currently depends on `bin/SumatraPDF.exe` via `src/services/printer.ts`, while uploaded files include PDF, Office documents, and images. This creates a reliability and latency risk for non-PDF formats and blocks controlled routing by format/engine.

This design introduces a phased replacement with fallback so we can reduce dispatch failures and validate whether non-PDF workloads are materially slower than PDF in real kiosk traffic.

## Scope and decisions

- **Migration model:** phased rollout, not hard cutover.
- **Primary KPI:** end-to-end latency from confirm-payment dispatch start to spooler terminal state.
- **Supported direct-routing formats (phase 1):** PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, JPG/JPEG/PNG.
- **Dependency policy:** PDFtoPrinter, GhostScript, LibreOffice are required for production; optional for local/dev.
- **Temporary safety net:** keep Sumatra as emergency fallback in phase 1, then remove after metrics and stability gates pass.
- **Speculation threshold:** non-PDF p95 is considered materially slower when it is **>=30%** above PDF p95 in comparable windows.

## Current-state integration points

- Current dispatch implementation: `src/services/printer.ts` (`printFile(...)` + Sumatra `execFile`).
- Current print call sites:
  - `src/modules/financial/financial.service.ts`
  - `src/modules/copy/copy.service.ts`
  - `src/modules/admin/admin.controller.ts` (test print)
- Existing spooler lifecycle and reconciliation: `src/services/print-spooler.ts` and financial lifecycle checkpoints.

## Alternatives considered

1. **Instrumentation first, replacement later**
   - Pros: smallest immediate risk.
   - Cons: delays functional fix for non-PDF routing and fallback robustness.
2. **Selected: PrintDispatcher now with phased fallback and telemetry**
   - Pros: solves routing/fallback and observability together; supports controlled migration.
   - Cons: moderate integration complexity.
3. **External print worker service**
   - Pros: process isolation, independent scaling.
   - Cons: unnecessary operational complexity for current kiosk deployment.

## Proposed architecture

### 1) Unified dispatch service

Create `src/services/print-dispatcher.ts` exposing:

```ts
dispatch(input: DispatchInput): Promise<DispatchResult>
```

Where `DispatchInput` includes:

- `filePath`, `mimeType`, `extension`
- standardized print options (`printer`, `copies`, `duplex`, `grayscale`, `pageRange`, `orientation`, `paperSize`)
- trace context (`transactionId`, `sessionId`, `documentId`, `mode`)

`DispatchResult` includes:

- `success`
- winning `engine`
- per-attempt details (`exitCode`, `stdout`, `stderr`, `durationMs`, `timedOut`)
- aggregate `durationMs`

### 2) Engine adapters

Add engine-specific adapters under `src/services/print-dispatch-engines/`:

- `pdftoprinter.engine.ts`
- `ghostscript.engine.ts`
- `libreoffice.engine.ts`
- `sumatra.engine.ts` (phase-1 emergency fallback only)

Each adapter implements a shared interface:

```ts
run(input: DispatchInput): Promise<DispatchAttemptResult>
```

### 3) Routing and fallback policy

Phase-1 chain:

- **PDF:** `PDFtoPrinter -> GhostScript -> Sumatra`
- **Office/Image:** `LibreOffice -> Sumatra` (only where Sumatra compatibility applies; otherwise fail explicitly)

Routing is centralized in `print-dispatcher.ts`, keyed by extension/MIME and runtime mode.

### 4) Backward-compatible surface

Keep `printFile(...)` exported from `src/services/printer.ts` as a compatibility wrapper in phase 1, delegating to `PrintDispatcher` so call sites can migrate safely without a big-bang API break.

## Configuration model

Add config entries in the existing environment/config layer:

- `PRINT_DISPATCH_MODE=legacy|phased|new-only`
- `PDFTOPRINTER_PATH=...`
- `GHOSTSCRIPT_PATH=...`
- `LIBREOFFICE_PATH=...`
- `SUMATRA_PATH=...` (phase-1 emergency fallback)
- optional per-engine timeout settings (with safe defaults)

Behavior:

- **Production:** missing required new-engine binaries in `phased`/`new-only` should fail fast at startup with explicit diagnostics.
- **Local/dev:** missing binaries degrade to `legacy` behavior with clear warnings.

## Data flow and error handling

1. Existing preflight checks remain unchanged (printer readiness, ink policy, analysis/quote).
2. Dispatch invocation shifts to `PrintDispatcher`.
3. Dispatcher executes bounded engine chain and captures attempt telemetry.
4. If all engines fail, return typed dispatch error to existing failure path so current `print_failed` handling and malfunction signaling continue.
5. If one engine succeeds, continue existing settlement + spooler monitoring/reconciliation flow unchanged.

No settlement-order change is introduced by this design.

## Observability and speculation validation

Emit structured dispatch telemetry per attempt:

- `attemptId`, `transactionId`, `engine`, `mimeType`, `extension`
- `startedAt`, `durationMs`, `exitCode`, `timedOut`, `success`
- normalized error classification and stderr hash/sanitized snippet

Persist/aggregate enough data to compute:

- p50/p95 end-to-end latency by MIME type
- p50/p95 by winning engine
- fallback rate and failure rate by MIME

Validation rule:

- Speculation is confirmed when non-PDF p95 is **>=30%** above PDF p95 for comparable traffic windows.

## Rollout plan

1. **Phase 1 (`phased`):** new dispatcher active with Sumatra emergency fallback.
2. **Phase 2 (`new-only`):** disable Sumatra fallback after stability and KPI review.
3. **Phase 3:** remove Sumatra adapter, binary dependency docs, and legacy branching.

Rollback path: switch `PRINT_DISPATCH_MODE=legacy`.

## Test strategy

- Unit tests for routing matrix and fallback sequencing.
- Adapter command-construction tests (flags, quoting, options mapping).
- Integration tests with mocked process runner for success/failure/timeout paths.
- Operational validation on Windows kiosk:
  - PDF dispatch/copies
  - DOCX/XLSX/PPTX dispatch via LibreOffice
  - JPG/PNG dispatch via LibreOffice
  - forced primary failure to verify fallback and error propagation
- Telemetry verification for p50/p95 and fallback metrics.

## Risks and mitigations

- **LibreOffice cold start latency:** warm-up at startup and explicit timeout handling.
- **Binary path drift on kiosk hosts:** startup checks + explicit diagnostics.
- **Option mismatch across engines:** centralized option normalization and adapter-specific mapping tests.
- **Operational confidence during migration:** feature-flagged rollout and temporary Sumatra safety net.

