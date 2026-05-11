# ISSUE_124 Print Error Detection Plan

## Summary

Implement the full ISSUE_124 checklist as a structured error-classification system, with reliable detection where
Windows/EPSON signals exist and detectionConfidence for best-effort or heuristic cases. Use an in-process edge-js C#
bridge for Windows WMI, Print Spooler, and Win32 printer capability queries, while preserving existing PowerShell
paths as fallback during development.

Defaults chosen:

- Scope: full checklist
- Hardware target: EPSON L5290 with generic Windows fallback
- .NET boundary: in-process edge-js
- Weak/unsupported signals: best-effort plus confidence
- Refunds: auto-refund only when no pages are confirmed printed; otherwise pending admin review

## Key Changes

- Add PrintError types and classifier:
  - code, layer, severity, userMessage, adminMessage, refundEligible, systemAction
  - Additional fields: detectionConfidence, source, raw, transactionId, sessionId, jobId, printerName,
    resolutionStatus
  - Cover every ISSUE_124 scenario as a stable PrintErrorCode, grouped by paper, ink, connectivity, scanner/input,
    application, and infrastructure.
- Add Windows diagnostics bridge:
  - New TypeScript wrapper around edge-js.
  - C# bridge queries Win32_Printer, PnP printer devices, spooler service state, print queue/job status, printer
    driver details, and Win32 capability APIs for paper size, duplex, and color support.
  - Existing PowerShell telemetry remains a fallback under PRINTBIT_WINDOWS_DIAGNOSTICS_PROVIDER=auto|edge|
    powershell.
- Add persistent error history:
  - New repository-backed SQLite table for print/scanner faults, not direct DB mutation.
  - Admin APIs:
    - GET /api/admin/print-errors?layer=&severity=&status=&limit=&offset=
    - PATCH /api/admin/print-errors/:id/resolution
  - Also append existing admin logs and anomaly alerts for fatal/recoverable faults.
- Wire detection into runtime:
  - Pre-dispatch validation in confirm-payment: printer readiness, paper estimate, ink policy, paper size, duplex,
    color capability, wrong printer, ghost printer, driver/capability mismatch.
  - Dispatch classification around printFile / PrintDispatchError.
  - Spooler classification in monitorSpoolerJob: queue stuck, job failure tokens, timeout, spooler query failure,
    spooler service crash.
  - Printer monitor classification for offline, USB disconnect, paper jam/out, paused, door open, memory, unknown
    hardware faults.
  - Scanner/NAPS2 classification for no document, ADF jam, scan failure, partial output, and dirty-glass heuristic
    using image analysis.
- Update kiosk/admin UI:
  - Emit printErrorRaised and include printError on existing printer/spooler/lifecycle socket events.
  - Confirm page shows warning toast for WARNING, blocking modal for RECOVERABLE/FATAL, and refund confirmation
    when a refund or pending review is created.
  - Add English and Filipino i18n strings.
  - Add admin Error History section with filters for layer, severity, and resolution status.

## System Behavior

- Pre-dispatch fatal errors block the job before settlement, so coins are not consumed.
- Post-dispatch fatal errors create a classified fault record and apply conservative refund policy:
  - pagesPrinted === 0: auto-refund.
  - partial/unknown output: pending admin review.
- WARNING faults allow proceed/cancel where appropriate, such as low ink or low-confidence print-quality risks.
- RECOVERABLE faults pause or retry when safe, such as paused printer or manual feed.
- Edge bridge failures are classified as diagnostics faults and do not silently collapse into generic printer
  errors.

## Test Plan

- Add classifier fixture coverage for every PrintErrorCode, including severity/action/refund mapping.
- Mock Windows diagnostics snapshots for EPSON L5290 and generic printers.
  - pnpm exec tsc --noEmit --ignoreDeprecations 6.0
  - pnpm run build

## Assumptions

- EPSON L5290 driver may not expose every sensor; unsupported signals are represented with low-confidence or
  heuristic classification rather than fake certainty.
- Existing coin event idempotency, session security, and settlement safeguards remain unchanged.
- The existing BullMQ print queue scaffold stays compatible, but the first integration target is the active confirm-
  payment print path.
- Documentation updates go into the existing agent_docs files using the repo’s current underscore filenames.
