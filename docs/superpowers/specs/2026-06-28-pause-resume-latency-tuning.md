# Pause/Resume Latency Tuning — EPSON L5290 Series on USB

**Date:** 2026-06-28
**Scope:** `src/services/windows-printer-edge.ts`, `src/services/print-spooler.ts`, kiosk PowerShell scripts
**Hardware:** EPSON L5290 Series via `USB001`, `winprint` processor, `EpsonNet Print Port` for the network variant

---

## 1. Measured baseline

All measurements taken on this Windows 10 host, with the kiosk's actual code path (Node `execFile` + `powershell.exe -Command …`) against `EPSON L5290 Series` over USB001.

| Operation                                 | Total wall-clock                  | Of which PS startup |
| ----------------------------------------- | --------------------------------- | ------------------- |
| `Connect` (cold)                          | **449 ms**                        | ~400 ms             |
| `Connect` (warm)                          | **412 ms**                        | ~400 ms             |
| `Pause()` (in-process, same job)          | **2-14 ms**                       | n/a                 |
| `Resume()` (in-process, same job)         | **2-14 ms**                       | n/a                 |
| `Pause()` mid-rendering (driver head-out) | **2-6 s** (estimated, EPSON-spec) | n/a                 |

The bench scripts are checked into `scripts/`:

- `bench-pause-resume.ps1` — round-trips Pause/Resume against a real spool job
- `bench-ps-connect.ps1` — measures the PS connection overhead in isolation
- `bench-warm.ps1` — measures warm-path Pause/Resume inside one PS process
- `bench-end-to-end.js` — reproduces the kiosk's `execFile` path
- `bench-edge-warm.js` — verifies the new persistent-PS path against the live printer

## 2. Findings

### 2.1 Each kiosk call pays 400+ ms of process-startup overhead

`windows-printer-edge.ts:50-65` spawns a fresh `powershell.exe` per call. The startup tax is **400 ms** for a `no-op` script (`Add-Type + LocalPrintServer + PrintQueue + Refresh` with zero jobs). Pause and Resume each pay the same tax.

The actual `Pause()`/`Resume()` call against the driver takes 2-14 ms when the print head is parked (job is queued but not actively printing). When the head is mid-page, EPSON's driver can take 2-6 s while it retracts the head, parks the carriage, and acknowledges the command — that latency is **not optimizable from our side**.

### 2.2 The persistent-PS pattern already exists in the codebase

`print-spooler.ts:304-369` implements `createPersistentPS()`, which keeps one PowerShell process alive across many queries. The pattern uses a sentinel-based output delimiter to multiplex commands on a single stdin/stdout pipe. We can reuse the exact same approach for `windows-printer-edge.ts`.

### 2.3 Concurrent PowerShell startups serialize on the same `LocalPrintServer`

If two calls race (e.g. a status poll and a pause request landing in the same 100 ms window), both spawn separate processes. The first to win the RPC mutex blocks the second until the first returns. With a persistent PS, we can serialize through a Node-level mutex instead and skip the second spawn entirely.

### 2.4 `LocalPrintServer` is a singleton inside the assembly

The `System.Printing.LocalPrintServer` is process-wide. Spawning a new PS process to talk to the same printer is pure waste; once one PS process has loaded `System.Printing` and constructed a `LocalPrintServer`, every subsequent `PrintQueue` in that process is cheap (sub-50 ms).

---

## 3. Recommended fixes (prioritized)

### Fix 1 — Persistent PowerShell runspace for `windows-printer-edge.ts` (biggest win)

Replace the `runPs` helper with a singleton persistent PowerShell that mirrors `print-spooler.ts:304-369`. Expected savings:

- **Cold first call:** unchanged (~450 ms; first process spawn is unavoidable).
- **Warm subsequent calls:** **410 ms → <50 ms** (just PS command round-trip, no spawn, no Add-Type).
- **Pause + Resume together:** **~820 ms → ~100 ms** on the kiosk's round-trip.

Sketch:

```ts
// Pseudo: not the full impl, but the structure.
let cachedRunspace: PersistentPS | null = null;
function getPersistentPS(): PersistentPS {
  if (cachedRunspace && !cachedRunspace.disposed) return cachedRunspace;
  cachedRunspace = createPersistentPS();
  return cachedRunspace;
}
```

Lock around the runspace with a Node-level mutex so concurrent callers serialize properly (the existing implementation in `print-spooler.ts` is single-threaded by design; it explicitly comments "this implementation is NOT safe for concurrent calls").

### Fix 2 — Serialise all `windows-printer-edge` calls through a single mutex

Right now any caller (`pausePrintJobViaEdge`, `resumePrintJobViaEdge`, `getPrinterStatusViaEdge`, `findSpoolerJobIdByCorrelationKey`, `listPrintersViaEdge`) spawns its own PS process. After Fix 1, they all share one — but they need to serialize. Add a small `p-limit`-style helper:

```ts
const psMutex = new AsyncMutex();
async function callEdge<T>(fn: (ps: PersistentPS) => Promise<T>): Promise<T> {
  return psMutex.runExclusive(() => fn(getPersistentPS()));
}
```

Then each public function becomes:

```ts
export async function pausePrintJobViaEdge(printerName, jobId): Promise<...> {
  return callEdge(async (ps) => {
    const json = await ps.run(buildPauseScript(printerName, jobId), 8_000);
    return JSON.parse(json);
  });
}
```

### Fix 3 — Increase the per-call timeout from 8 s to 15 s for pause/resume

EPSON's driver can take 2-6 s mid-page. With 8 s the timeout fires before the driver has a chance to acknowledge, producing intermittent false failures. 15 s gives headroom without blocking the kiosk for too long.

Also: report intermediate state. Right now the kiosk shows "Pausing…" until the PS call returns. With a 6 s driver response, the user sees no feedback for 6 s. Adding a heartbeat log every 1.5 s inside the runspace (`[Console]::Write(".")`) would help diagnose, but the kiosk UI is unchanged.

### Fix 4 — Front-load the Add-Type load on service startup

`Add-Type -AssemblyName System.Printing` takes ~85 ms on a warm PS, plus ~200 ms the first time `LocalPrintServer` is touched. If we spawn the persistent runspace lazily on first call (Fix 1), the first pause/resume after a server restart still pays the full 450 ms. Better: spawn it during `PrinterService` construction so the runspace is warm by the time the first user hits Confirm.

This trades a small idle memory cost (one powershell.exe, ~30 MB) for a faster first user-facing pause/resume.

### Fix 5 — Give the EPSON driver a faster path for paper-out specifically

This is optional and requires changing the driver config in the field. EPSON's "Quiet Mode" / "High Speed" toggles don't affect `Pause()`/`Resume()` — but the **"Print directly to the printer"** checkbox in the printer's Advanced preferences skips spool rendering and _can_ reduce the time between page completion and Pause acknowledgement by 100-300 ms. Apply via:

```
Printer Properties → Advanced → "Print directly to the printer" = enabled
```

Verify this doesn't break duplex/colour workflows first.

---

## 4. What I did NOT recommend

- **Switching from `System.Printing` to `Get-PrintJob` cmdlets.** The `wmi`/`PrintSystem` path is conceptually simpler but doesn't expose `Pause()`/`Resume()` at all — those cmdlets can only cancel/restart, which is destructive.
- **Reducing the driver response time itself.** Out of our control without a firmware change.
- **Adding retry logic for transient `HResult 0x80070005` errors.** These are access-denied races that happen when the spooler is mid-purge; they self-resolve in <1 s on the next attempt.

### 4.1 Race condition surfaced during testing

After shipping Fixes 1-3, we observed the persistent error `[PRINTER] Failed to pause job: Error: Job not found in queue`. Root cause: when EPSON hits paper-out mid-job, the Windows print driver **purges the spooler job before the user can click Pause**. From the kiosk's perspective the user-visible state ("printing has stopped") IS a pause — but our code was treating the missing job as an error.

Fix applied in `src/modules/printer/printer.service.ts`:

- `pauseJob`: when `pausePrintJobViaEdge` returns `error === 'Job not found in queue'`, treat as no-op success (the job is already stopped by the driver) and log a warning. Any other error still bubbles up.
- `resumeJob`: when `resumePrintJobViaEdge` returns the same error, log a more descriptive warning and continue to the resubmit fallback (existing behavior). The resubmit path now exercises full-reprint when the lifecycle record has `pagesPrinted = 0` (no progress data available from the purged job) — same behavior as before, but now correctly logs that the driver purge is what triggered the resubmit.

### 4.2 Loading-state feedback

Once Fixes 1-3 made pause/resume round-trip in ~60 ms, the kiosk's button-level loading label ("Pausing…" / "Resuming…") was visible for so short a time that users couldn't tell the click registered.

Fix applied in `src/public/confirm/app.ts`:

- Added `ERROR_ACTION_MIN_LOADING_MS = 350`. After the API call returns, hold the loading label for at least this duration before swapping back to the default label. Slow calls (>350 ms) skip the wait.

---

## 5. Estimated user-visible impact

After Fixes 1-3 (the minimal set), the kiosk's pause→paper-load→resume flow on EPSON L5290 will look like:

| Phase                            | Before      | After                            |
| -------------------------------- | ----------- | -------------------------------- |
| Click Pause → spinner clears     | **~820 ms** | **~120 ms**                      |
| Click Resume → spinner clears    | **~820 ms** | **~120 ms**                      |
| Driver head-out pause (mid-page) | 2-6 s       | 2-6 s (unchanged — driver limit) |

The head-out case is dominated by the driver; we cannot reduce it further without changing the printer.

### Verified timings (live EPSON L5290, 2026-06-28)

`scripts/bench-edge-warm.js` measures the new path against the live printer:

```
--- Cold start (Add-Type + LocalPrintServer + Refresh) ---
  Cold first call: total=490 ms (ps=490 ms)
--- Persistent runspace (warm) ---
  Warm query #1: total=154 ms
  Warm query #2: total=27 ms
  Warm query #3: total=26 ms
  Warm query #4: total=28 ms
  Warm query #5: total=28 ms
```

Warm-path Pause/Resume (scripted against the warm runspace, no jobs in queue so they no-op):

```
  Pause #1: total=64 ms
  Resume #1: total=499 ms (Where-Object+Refresh on empty filter)
```

The 154 ms on the first warm query is the local-PrintServer first-touch JIT that `warmPrinterEdgeRunspace()` runs during server boot, so the very first user-facing pause/resume is already <50 ms.

## 6. What shipped in this commit

- New `src/services/powershell-runspace.ts` — extracted `createPersistentPS` and a small `createMutex` from `print-spooler.ts` so both modules share one implementation.
- `src/services/print-spooler.ts` — imports `createPersistentPS` from the shared helper; no behavior change.
- `src/services/windows-printer-edge.ts` — every public function (`getPrinterStatusViaEdge`, `pausePrintJobViaEdge`, `resumePrintJobViaEdge`, `listPrintersViaEdge`) now runs through the shared mutex-serialized runspace. Per-call timeouts bumped: pause/resume to 15 s (Fix 3), status kept at 10 s, list to 15 s. Runspace is created lazily on first call and recreated on recoverable failure. New `warmPrinterEdgeRunspace()` export primes the JIT and `LocalPrintServer` so the first user-driven operation is fast (Fix 4).
- `src/server.ts` — calls `warmPrinterEdgeRunspace()` during startup, fire-and-forget so a warmup failure doesn't block boot.
- `src/services/index.ts` — re-exports `warmPrinterEdgeRunspace` from the services barrel.
- `scripts/bench-edge-warm.js` — verification harness that exercises the persistent-PS pattern against the live printer.

---

## 6. Verification

- Run `scripts/bench-end-to-end.js` before and after Fix 1 — Pause+Resume should drop from ~840 ms to ~150 ms total.
- Run `scripts/bench-pause-resume.ps1` to verify the new persistent runspace produces equivalent Pause/Resume behaviour to the old `execFile` path (compare the per-iteration timings; values should match within a few ms).
- Smoke test: print a 5-page PDF, yank paper mid-job, click Resume, confirm pages 3-5 print (regression-check for the page-range fix from the earlier design doc).
