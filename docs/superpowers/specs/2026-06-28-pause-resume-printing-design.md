# Pause and Resume Printing Functionality — Technical Design Document

**Date:** 2026-06-28  
**Status:** Approved  
**Scope:** PrintBit Kiosk — Frontend UI (`src/public/confirm/app.ts`), Backend Controller & Service (`src/modules/printer/`), Windows Spooler Integration (`src/services/windows-printer-edge.ts`, `src/services/print-spooler.ts`)

---

## 1. Problem Statement & Root Cause Analysis

During multi-page print operations (e.g. printing a 2-page document with only 1 sheet of paper loaded in the printer tray), the printer exhausts paper mid-job. While the backend background spooler monitor detects paper depletion and classifies it as `PAPER_INSUFFICIENT_MID_JOB` or `PAPER_TRAY_EMPTY`, the kiosk user is unable to pause or resume the print job due to three main factors:

1. **Frontend Error Code Exclusion:** In `src/public/confirm/app.ts`, `renderPrinterError` only enabled pause/resume action buttons for `PAPER_INSUFFICIENT_PRE_DISPATCH`, omitting `PAPER_INSUFFICIENT_MID_JOB`. Consequently, action buttons were hidden or disabled when mid-job paper exhaustion occurred.
2. **Correlation Key Desynchronization:** Pause and resume API calls relied strictly on `paymentSpoolerCorrelationKey`. If this key was cleared or out of sync when errors occurred, button handlers returned early without initiating API requests.
3. **Missing UI Feedback & Mid-Job Spooler Driver Purging:** Button clicks provided no loading state indicators or error notifications on API failure. Furthermore, if the Windows printer driver purged an interrupted job from the OS spooler queue upon paper-out, backend resume calls failed without attempting resubmission of remaining unprinted pages.

---

## 2. System Architecture & Component Design

### 2.1 Frontend Action & Error Handling (`src/public/confirm/app.ts`)

* **Error Code Expansion:** Update `showActions` condition in `renderPrinterError` to recognize all paper and recovery error codes:
  - `PAPER_INSUFFICIENT_PRE_DISPATCH`
  - `PAPER_INSUFFICIENT_MID_JOB`
  - `PAPER_TRAY_EMPTY`
  - `PAPER_JAM_PRINT`
* **Correlation Key Fallback:** When Pause or Resume buttons are clicked, resolve the active correlation key dynamically:
  ```typescript
  const targetKey = paymentSpoolerCorrelationKey || currentPrinterError?.spoolerCorrelationKey;
  ```
* **Interactive Button Lifecycle & Feedback:**
  - On click: Immediately disable buttons and show active loading labels (`"Pausing..."` / `"Resuming..."`).
  - On Pause Success (`/api/printer/pause` HTTP 200): Update modal title/subtitle to reflect paused state, hide Pause button, highlight Resume button.
  - On Resume Success (`/api/printer/resume` HTTP 200): Invoke `clearPrinterError()` and restore normal confirmation gate state.
  - On Failure: Re-enable buttons and display inline error message inside the modal container.

### 2.2 Backend Spooler Lifecycle & Job Control (`src/modules/printer/printer.service.ts`)

* **Robust Lifecycle Lookup:** Enhance `findSpoolerJobDetails(spoolerCorrelationKey)` to match records in `db.data.spoolerLifecycle` and dynamically resolve `spoolerJobId` via `findSpoolerJobIdByCorrelationKey` if unpopulated.
* **Smart Job Resubmission & Mid-Job Recovery:**
  - In `resumeJob(spoolerCorrelationKey)`, call `resumePrintJobViaEdge(printerName, spoolerJobId)`.
  - If PowerShell Edge returns `"Job not found in queue"` (indicating job purging by OS/driver during paper-out):
    1. Verify total pages requested vs pages printed.
    2. Retrieve original PDF asset from `WORKER_QUEUE_DIR` or print cache.
    3. Re-spool unprinted pages to the printer queue and update lifecycle tracking records.

### 2.3 Windows Spooler PowerShell Edge Integration (`src/services/windows-printer-edge.ts`)

* Enhance PowerShell script blocks in `pausePrintJobViaEdge` and `resumePrintJobViaEdge`:
  - Check current job status flags (`IsPaused`).
  - If a job is already paused on `pausePrintJobViaEdge` or active on `resumePrintJobViaEdge`, return `{ success: true }` to maintain idempotency.
  - Return detailed structured diagnostics in `EdgeJobActionResult`.

---

## 3. End-to-End Flow & Sequence

1. **Hardware Event:** Mid-job paper exhaustion occurs. Spooler monitor detects paper problem and emits Socket.IO `PRINTER_ERROR` payload containing `spoolerCorrelationKey`.
2. **UI Action Gate:** Frontend displays error modal with active Pause and Resume buttons.
3. **User Action:** Attendant reloads paper and clicks **Resume Job**. Button updates to `"Resuming..."` and disables.
4. **Backend Processing:** POST `/api/printer/resume` attempts OS spooler job resume via Edge PowerShell or resubmits remaining unprinted pages from worker queue directory.
5. **Kiosk Restoration:** API returns HTTP 200 `{ success: true }`. Frontend clears error modal and resumes kiosk transaction flow.

---

## 4. Verification & Testing

* **TypeScript Type Safety:** Run `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` to ensure strict compilation.
* **Frontend Compilation:** Run `pnpm run build` to compile TypeScript browser bundles into `src/public/`.
