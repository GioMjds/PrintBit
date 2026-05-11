# Print Error Surfacing Spec (Issue 124)

Date: 2026-05-11
Status: Approved for implementation

## Goals

- Surface accurate printer/spooler errors on Confirm, Copy, and Scan pages during active jobs.
- Keep user-facing messages consistent with Issue 124 error classification.
- Make Warning errors dismissible while blocking Recoverable and Fatal errors.

## Non-goals

- Redesign the entire payment or scanner flows.
- Change refund policy or settlement logic.
- Add new Socket.IO event names.

## Scope

Scenarios explicitly required:

- Not enough paper in rear tray.
- No paper in rear tray.
- No document scanned or fed (ADF).
- Printer turned off.
- Paper jam during scanning, feeding, or printing.
- No ink.
- Printer not connected to the kiosk (Windows tablet).

## UX Behavior

### Confirm page

- Keep the coin panel visible.
- Insert a prominent error block under the status badge.
- Warning errors are dismissible with a close button.
- Recoverable and Fatal errors are non-dismissible and continue to trigger the existing blocking overlay.

### Copy and Scan pages

- Replace the left preview area with a blocking error state when a printer/spooler error arrives.
- Warning errors show a dismiss button to return to the preview.
- Recoverable and Fatal errors are non-dismissible until resolved or a new scan is started.

## Event Flow

- Reuse existing events: printErrorRaised, printerMalfunction, printerSpoolerFailure, printerSpoolerTimeout, printLifecycleState.
- UI reads the structured printError payload from these events.
- Confirm page only handles errors that match the active transaction, session, or spooler correlation key, except warnings.
- Copy and Scan pages display printer/spooler errors in the preview area; scanner-specific errors remain handled by existing scan/copy flow logic.

## Backend Gap Fixes

- Confirm-payment pre-dispatch validation must check paper availability, ink status, and connectivity, and return a PrintError payload on failure before settlement.
- Scanner flows should classify scanner failures with PrintError and emit printErrorRaised so the UI can surface them consistently.
- Ensure spooler terminal failures always include printError and are emitted via the existing event payloads.

## Error Mapping

- Not enough paper in rear tray -> PAPER_INSUFFICIENT_PRE_DISPATCH -> Fatal (pre-dispatch)
- No paper in rear tray -> PAPER_TRAY_EMPTY -> Fatal (pre-dispatch or spooler PaperOut)
- No document scanned or fed (ADF) -> SCANNER_NO_DOCUMENT -> Recoverable (scanner error)
- Printer turned off -> PRINTER_POWERED_OFF -> Fatal (printer telemetry)
- Paper jam during scanning/feeding -> SCANNER_ADF_JAM -> Recoverable (scanner error)
- Paper jam during printing -> PAPER_JAM_PRINT -> Fatal (printer telemetry or spooler)
- No ink -> INK_EMPTY -> Fatal (ink preflight)
- Printer not connected to kiosk -> USB_DISCONNECTED or NETWORK_PRINTER_UNREACHABLE or WINDOWS_PRINTER_OFFLINE -> Fatal

## Localization

- Add translation keys for the above codes in both English and Filipino.
- UI should prefer localized strings by code, then fall back to printError.userMessage.
- Optional hint strings should be localized per code.

## Testing Plan

- Type check: pnpm exec tsc --noEmit --ignoreDeprecations 6.0
- Build: pnpm run build
- Manual checks:
  - Trigger printer/spooler failures and confirm the left panel error block updates.
  - Trigger scanner failures and confirm the copy/scan preview shows the blocking error state.
  - Verify Warning errors are dismissible, Recoverable and Fatal are not.

## Risks

- Missing pre-dispatch telemetry could lead to fewer errors caught before settlement.
- Some printer status signals may remain best-effort with low confidence.
