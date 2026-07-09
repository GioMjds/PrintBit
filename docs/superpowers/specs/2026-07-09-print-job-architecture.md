# PrintBit UI & Print Job Architecture Specification

## Overview

The PrintBit UI is responsible for user interaction and visualization. With the introduction of the new PrintBit Worker architecture, the UI now facilitates manual user interaction for resuming or cancelling missing/unprinted pages when a print job is interrupted (e.g., due to paper-out, paper jams, or other recoverable printer faults).

The background Node.js service orchestrates the state transitions, page range calculations, and financial settlements, while the C# worker performs the low-level printing and spooler monitoring.

---

## Responsibilities

### Print Job Submission
* Select template
* Configure printing options
* Preview document
* Submit print request

### Queue Visualization
Display active, waiting, completed, and failed jobs.
Each job displays:
* Job ID
* Customer / Correlation Info
* Template / Filename
* Status
* Progress (e.g., "5 of 10 pages")

### Printer & Job Error Status
Show the current printer/job state. When a recoverable error is encountered (such as `PAPER_TRAY_EMPTY` or `PAPER_JAM_PRINT`), the tablet UI displays a **Partial-Progress Decision Dialog**.

---

## The Partial-Progress Decision Dialog

When a print job is interrupted midway, the system transitions to a `paused` or recoverable `failed` state. The UI displays an error modal with:
1. **Printed Progress Status:** A clear visual indicator showing exactly how many pages printed successfully (e.g., *"3 of 10 pages printed"*).
2. **Resume Print Button:** Prompts the user to fix the printer issue (e.g., load paper) and click Resume to print the remaining pages.
3. **Cancel Remaining Button:** Cancels the remaining unprinted pages, settles the payment for only the pages printed so far, refunds the rest to the session balance, and prints a partial receipt.

---

## API Responsibilities

The UI performs actions strictly via the following API endpoints and Socket.IO events.

### HTTP Endpoints

#### `GET /api/printer/status`
Returns the current printer telemetry and any active print errors.

#### `POST /api/printer/pause`
Instructs the spooler/worker to temporarily pause the current job.

#### `POST /api/printer/resume`
Instructs the backend to resume a paused job.
* **Payload:** `{ spoolerCorrelationKey: string }`
* **Behavior:**
  1. Node reads the database's `pagesPrinted` vs `totalPages` from the job's lifecycle record.
  2. Slices the remaining page range using `computeResubmitPlan(pagesPrinted, totalPages)`.
  3. Writes a fresh JSON sidecar file containing the sliced `pageRange` (e.g., `4-10`) into the C# worker queue.
  4. Transitions the lifecycle state back to `processing`.

#### `POST /api/printer/cancel-remaining`
Instructs the backend to abort the remaining pages of an interrupted job and settle payment for pages printed.
* **Payload:** `{ spoolerCorrelationKey: string }`
* **Behavior:**
  1. Node retrieves the active print job and financial record.
  2. Calculates the cost of the pages successfully printed ($PagesPrinted \times PricePerPage$).
  3. Updates the financial ledger to charge only the printed pages.
  4. Refunds the unprinted pages ($TotalPages - PagesPrinted$) back to the user's active session balance.
  5. Instructs the C# worker/spooler to delete the job.
  6. Releases transient scan/upload files and transitions the lifecycle to `printed`.

---

## Real-Time Socket.IO Events

The Node service emits updates using the `printLifecycleState` event:

```ts
interface PrintLifecycleStatePayload {
  mode: 'print' | 'copy';
  state: 'queued' | 'processing' | 'paused' | 'printed' | 'failed';
  transactionId: string;
  spoolerCorrelationKey: string;
  pagesPrinted?: number;
  totalPages?: number;
  printError?: {
    code: string;           // e.g. 'PAPER_TRAY_EMPTY', 'PAPER_JAM_PRINT'
    severity: 'recoverable' | 'fatal' | 'warning';
    userMessage: string;
    hint: string;
    canRetry: boolean;
    canDismiss: boolean;
  } | null;
}
```

---

## Data Flow & Architecture

```
    Tablet UI (HTML/CSS/TS)
            │
            ▼
    Node.js Express Backend  ◄──[Named Pipe Server]──  C# Background Worker
            │                                                 │
            ▼                                                 ▼
     SQLite Database                                 Windows Spooler API
 (Ledger, Lifecycle State)
```

---

## Forbidden Responsibilities

To maintain strict boundaries, the UI must never:
* Communicate directly with printer hardware or ports.
* Attempt to directly slice PDF files or modify PDF page structures.
* Access Win32 Print/Spooler APIs directly.
* Directly modify the SQLite database files.
