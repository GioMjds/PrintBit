# Code Review: Pause/Resume Printing Bug Investigation

## Executive Summary

> The pause/resume functionality partially works — the Windows pause/resume PowerShell calls execute successfully and the Epson L5290 does respond. However, the resume path consistently reprints the entire document instead of just the missing pages. I've identified 5 critical bugs across the Node printbit repo and the C# printbit-worker repo that combine to produce this symptom. The downstream effect of these bugs is that the user's printed output ends up with duplicated pages or no pages at all, depending on which branch fires.

## Root Cause Hierarchy

### 🔴 Root Cause #1 — IPC contract drift between Node and C# worker

`printbit-worker/src/PrintBit.Infrastructure/IPC/WorkerPrintEventType.cs:6-12`

The C# WorkerPrintEventType enum has 6 variants: `PrintStarted`, `PrintSucceeded`, `PrintFailed`, `PrinterOffline`, `PrinterOnline`, `PrinterError`.

The Node WorkerPrintEventType in `src/services/worker-return-pipe.ts:4-10` declares 7 variants — including `PrintProgress`. The C# side has no `PrintProgress` value, and the WorkerPrintEvent record (C# WorkerPrintEvent.cs:7-22) has no `PagesPrinted` or `TotalPages` properties.

Effect: The Node handler at `src/services/worker-print-lifecycle.ts:197-236` is dead code that can never fire. The spooler lifecycle record's pagesPrinted/totalPages are never updated from the worker's view of the world.

### 🔴 Root Cause #2 — C# worker discards spooler page counts

`printbit-worker/src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterMonitorService.cs:162-173`

`MonitorPrintJobs()` queries `Win32_PrintJob` every 2 seconds and only logs the result. It does not emit a `WorkerPrintEvent` with the spooler job's `PagesPrinted/TotalPages`. This is the exact data the Node `partialPrintGuard` and the resume `computeResubmitPlan` rely on.

### 🔴 Root Cause #3 — Resume logic misclassifies the "Job not found" path

`src/modules/printer/printer.service.ts:400-414`

When the Epson L5290 driver purges the spooler job on paper-out (within hundreds of ms), `resumePrintJobViaEdge` returns `success: false, error: 'Job not found in queue'`. The fallback path then always falls into the resubmit branch — there's no check for whether the user's pause intent was a true user pause (job still in queue, `IsPaused=true`) vs. a paper-out auto-purge.

The pause path never persists a "paused" state to the spooler lifecycle, so the resume path has no way to tell the difference. See `src/services/windows-printer-edge.ts:247-291` — the pause script just calls `$job.Pause()` and returns; nothing in the Node lifecycle is updated.

### 🔴 Root Cause #4 — computeResubmitPlan always returns kind: 'full'

`src/modules/printer/printer.service.ts:609-626`

`if (pagesPrinted === null || totalPages === null) return { kind: 'full' };`

Because of #1 and #2, `pagesPrinted` is always null in the lifecycle record (the worker never populates it). The function therefore always returns kind: 'full', which means the resubmit rewrites the sidecar with `pageRange: null` (line 525: `await rewriteSidecarPageRange(newJsonPath, '')`), and Sumatra prints the entire document instead of pages 6-10 of 10.

This is the exact symptom the user described: "it doesn't actually resume the document page or the missing page needed to resume."

### 🔴 Root Cause #5 - L5290 driver lies about page counts (known, but the workaround is broken)

`src/services/print-spooler.ts:124-128` documents the issue:

On printers whose driver lies about completion (e.g. Epson L5290 reporting Printed 2/2 after physically printing only 1/2 because page 2 hit paper-out), the spooler's `pagesPrinted` is unreliable, so we prefer the worker's snapshot when available.

But the worker's snapshot is never produced (root cause #1), so the partial-print guard always falls back to the unreliable spooler snapshot, which the comment itself says you can't trust. This means partial prints on the L5290 are never caught by partialPrintGuard, and a "Thank You" screen can be shown when pages are still missing — and conversely, the same broken data path feeds into the resume logic that mis-reprints everything.

---

## Additional Issues Found

### Other Issue #6 - Windows Printer Edge Resume Path Misfire

Severity: Important

`src/services/windows-printer-edge.ts:317-322`

Issue: The L5290 "`IsPaused=false` but firmware parked" handling calls `Resume()` and marks `alreadyInState=true`. This
is fine in isolation, but when the spooler has already purged the job, this code path never executes — the Job
not found in queue branch fires first, and the resubmit logic does the wrong thing.

### Other Issue #7 - Print Spooler Page Count Semantics Mismatch

Severity: Important

`src/services/print-spooler.ts:196`

Issue: Page-count semantics mismatch: prepared-PDF logical pages (e.g. 8 pages from `applyTransforms`)
`pageRange="3-10"`) vs spooler-counted ejected sheets (could be 4 if duplex). Both are written into the same
`pagesPrinted/totalPages` lifecycle fields, distorting the resume math.

### Other Issue #8 - Print Queue Orchestration Cleanup

Severity: Optional

`src/modules/print-queue/print-queue.orchestration.ts:351-362`

Issue: The finally block cleanup is correct in normal flow, but a comment explaining why deleting the source
prepared PDF after a successful handoff is safe (because the worker has its own copy in the queue) would help
future maintainers.

---

## Why the Symptom Is "Doesn't Resume the Missing Page"

> Putting it all together, here's what happens when a user pauses a 10-page job at page 5 because of paper-out:

1. User loads paper, clicks Resume.
2. Node calls `resumePrintJobViaEdge(printerName, spoolerJobId)`. (Either the spooler has already purged the job, OR the L5290 firmware is parked with `IsPaused=false`.)
3. If purged: Job not found in queue → resubmit branch.
4. If parked: the EPSON quirk script returns success: true, `alreadyInState: true` → returns without resubmitting. The user sees the button "succeed" but no new pages print because the firmware never received a start signal.
5. In the resubmit branch: `computeResubmitPlan` returns kind: `'full'` (lifecycle has no progress data) → sidecar rewritten with pageRange: null → worker reprints all 10 pages, overwriting/doubling the first 5.

So depending on timing, the user sees either `"Resume clicked, nothing printed"` or `"Resume clicked, 10 fresh pages printed (and 5 originals lost to the output bin)"`. Both symptoms map back to the same root causes: the worker has no way to tell Node how many pages it actually printed, and Node has no way to distinguish a true user pause from a driver-purged state.

---

## Recommended Fix Path (in order)

1. Reconcile the IPC contract — add `PrintProgress` to the C# `WorkerPrintEventType` enum and add `PagesPrinted/TotalPages` fields to the C# `WorkerPrintEvent` record. The two files (`printbit-worker/src/PrintBit.Infrastructure/IPC/WorkerPrintEventType.cs` and `WorkerPrintEvent.cs`) and the Node `src/services/worker-return-pipe.ts` are the touch points.
2. Emit progress from `MonitorPrintJobs` — in `printbit-worker/src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterMonitorService.cs`:162-173, instead of just logging, build a `WorkerPrintEvent` with the spooler job's `PagesPrinted/TotalPages` keyed by Document filename (or JobId) and push it through the existing pending-event pattern.
3. Persist a "paused" lifecycle state in `PrinterService.pauseJob` — write state: 'paused' (or a new '`pauseresume`' substate) to the spooler lifecycle record before returning, so the resume path knows whether to look for the job in the spooler or to go straight to resubmit.
4. In `resumeJob`, branch on the lifecycle's pause/resume state — if the state is paused and the spooler has purged the job, the printer must have recovered. In that case, don't call `resumePrintJobViaEdge` (the job is gone) and don't fall through to a full resubmit if `pagesPrinted` is null — instead, surface a structured error to the UI ("Printer recovered; please re-upload") rather than silently recharging for a full reprint.
5. Add a regression test for the `computeResubmitPlan` function with a `null/null` input. The current code returns kind: '`full`', which silently swallows the missing-progress case. It should arguably return a discriminated `"unknown progress"` kind that the caller treats as an error rather than a happy path.

Files Touched by the Bug Chain

- `src/modules/printer/printer.service.ts` (Node) — resume + resubmit logic
- `src/services/windows-printer-edge.ts` (Node) — pause/resume PowerShell bridge
- `src/services/worker-print-lifecycle.ts` (Node) — dead PrintProgress handler
- `src/services/print-spooler.ts` (Node) — partial print guard that depends on the dead pipeline
- `src/services/worker-return-pipe.ts` (Node) — IPC event type definitions
- `src/services/prepare-print-pdf.ts` (Node) — prepared PDF page semantics
- `src/modules/print-queue/print-queue.orchestration.ts` (Node) — orchestration cleanup
- `printbit-worker/src/PrintBit.Infrastructure/IPC/WorkerPrintEvent.cs` (C#) — missing fields
- `printbit-worker/src/PrintBit.Infrastructure/IPC/WorkerPrintEventType.cs` (C#) — missing enum value
- `printbit-worker/src/PrintBit.Infrastructure.Windows/PrinterMonitoring/PrinterMonitorService.cs` (C#) — discards page counts
- `printbit-worker/src/PrintBit.HardwareService/Services/PrintQueueWatcherService.cs` (C#) — moves files to failed/ on failure (relevant for the resubmit path's lookup)
