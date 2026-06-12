# Implement Hardware Error Modal with Pause/Resume

With the C# worker successfully detecting and killing the Epson Status Monitor popup on paper-out (and returning a clean `HardwareError` event), the Node.js app now receives `workerPrintFailed` reliably. Currently, the UI aborts the transaction without showing the user the pause/resume options. We will wire up the UI to display an error modal and implement the missing `/api/printer/resume` logic in the backend.

## User Review Required

> [!WARNING]
> Since the C# worker archives the job files when it fails, "resuming" means the Node.js backend must re-create the files in the queue folder. The backend's `JobProcessor` handles file creation via `orchestratePrintJob`. When resuming, we will reset the job's state from `failed` to `pending` and trigger the JobProcessor to re-enqueue the physical files.

## Proposed Changes

### 1. Frontend (`src/public/confirm/app.ts`)

Update the `workerPrintFailed` socket listener. When the C# worker reports a `HardwareError`, do not abort the page via `applyConfirmGate`. Instead:

- Call `renderPrinterError()` with a structured `PrintError` object (`PAPER_TRAY_EMPTY` or similar) and `severity: 'recoverable'` so the existing `printer-error-block` (with Pause and Resume buttons) appears.
- Ensure the modal gives clear instructions: "Printer Out of Paper. Please load paper and click Resume."

### 2. Backend Routes (`src/modules/printer/api.ts` or `routes.ts`)

The Confirm page expects two endpoints that do not currently exist in the backend:

- `POST /api/printer/pause`: Acknowledges the error, potentially pausing the session timeout so the user has time to ask for paper.
- `POST /api/printer/resume`: Accepts the `spoolerCorrelationKey`. Finds the failed print job, updates its state to `pending` in the SQLite database, and wakes up the `job-processor` to re-enqueue the PDF and JSON files to the C# worker's queue directory.

### 3. Backend Job Processor (`src/services/job-processor.ts` & `src/core/database/print-job-store.ts`)

- Expose a method to reset a job by correlation key.
- Ensure that when a job goes from `failed` -> `pending`, `orchestratePrintJob` safely recreates the files in the `queue/` folder (since the C# worker moves failed jobs to `archive/`).

## Verification Plan

### Automated Tests

- Run `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` to verify type safety in Node.js.
- Run `pnpm run build` to rebuild the frontend bundles.

### Manual Verification

1. Send a print job with no paper in the rear tray.
2. Verify the C# worker catches the Epson popup and sends `workerPrintFailed` with `HardwareError`.
3. Verify the kiosk Confirm page displays the "Printer Error" modal with **Pause** and **Resume** buttons.
4. Load paper into the rear tray.
5. Click **Resume** on the kiosk UI.
6. Verify the `/api/printer/resume` endpoint re-enqueues the job and the C# worker prints it successfully.
