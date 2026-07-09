/**
 * Windows Printer Bridge — PowerShell-based access to System.Printing API.
 *
 * Provides the same interface as the edge-js version but uses PowerShell
 * + Add-Type to call System.Printing, which avoids native module compilation
 * issues on newer Node.js versions.
 *
 * Performance: All public functions share ONE persistent PowerShell
 * runspace (see ./powershell-runspace) instead of spawning a fresh
 * powershell.exe per call. This eliminates ~400 ms of process-startup tax
 * per pause/resume — the actual `Pause()`/`Resume()` calls take 2-14 ms
 * once `System.Printing` is loaded. Calls are serialized through an
 * in-process mutex because the persistent-PS pattern is single-threaded
 * by design.
 *
 * Lifecycle: the runspace is created lazily on first call. A
 * `warmPrinterEdgeRunspace()` helper is also exposed so the kiosk can
 * pre-load the runspace during service startup, eliminating the
 * first-call tax on the very first user-facing pause/resume.
 */

import {
  createMutex,
  createPersistentPS,
  type AsyncMutex,
  type PersistentPS,
} from './powershell-runspace';

// ── Types ────────────────────────────────────────────────────────

export interface EdgePrinterStatus {
  name: string;
  isOutOfPaper: boolean;
  isPaperJam: boolean;
  isOffline: boolean;
  isPaused: boolean;
  isBusy: boolean;
  isDoorOpened: boolean;
  isLowOnToner: boolean;
  isNoToner: boolean;
  isManualFeedRequired: boolean;
  isOutputBinFull: boolean;
  isPaperProblem: boolean;
  status: string;
  queueStatus: string;
}

export interface EdgePrinterError {
  error: string;
}

export interface EdgeJobActionResult {
  success: boolean;
  error?: string;
  /**
   * True when the requested action was a no-op because the job was already
   * in the target state (already paused, or already printing). Callers
   * should treat this as success but may skip downstream resubmission
   * fallbacks.
   */
  alreadyInState?: boolean;
}

// ── Persistent runspace + mutex ──────────────────────────────────

/**
 * Per-call timeouts. Pause/Resume can take 2-6 s on EPSON when the print
 * head is mid-page (driver-bound, not optimizable from our side), so we
 * give them 15 s of headroom. Status / list queries are sub-50 ms once
 * warm; 10 s is plenty.
 */
const STATUS_TIMEOUT_MS = 10_000;
const PAUSE_RESUME_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 15_000;

// Singleton runspace + mutex. The runspace is launched lazily: the
// `Add-Type -AssemblyName System.Printing` cost (~85 ms) plus the
// `LocalPrintServer` first-touch JIT (~200 ms) is only paid when the
// first printer operation runs. Subsequent calls share the warm process
// and complete in <50 ms. See ./powershell-runspace for the runspace
// implementation; see `warmPrinterEdgeRunspace` for priming it during
// service startup.
let cachedRunspace: PersistentPS | null = null;
const psMutex: AsyncMutex = createMutex();

function getRunspace(): PersistentPS {
  if (cachedRunspace && !cachedRunspace.disposed) return cachedRunspace;
  cachedRunspace = createPersistentPS();
  return cachedRunspace;
}

function discardRunspace(): void {
  if (cachedRunspace) {
    try {
      cachedRunspace.dispose();
    } catch {
      /* ignore */
    }
    cachedRunspace = null;
  }
}

/**
 * Pre-load the PowerShell runspace and the System.Printing assembly so
 * the first user-driven pause/resume is fast. Safe to call multiple
 * times — subsequent calls are no-ops once the runspace is warm.
 *
 * Returns once the assembly load completes (the runspace is now in
 * "warm" state). Errors are swallowed and logged; the next per-call
 * invocation will retry the load lazily.
 */
export async function warmPrinterEdgeRunspace(): Promise<void> {
  await psMutex.runExclusive(async () => {
    const ps = getRunspace();
    try {
      // Idempotent: re-running Add-Type on an already-loaded assembly
      // is a cheap no-op. This primes the JIT and warms the
      // LocalPrintServer singleton for subsequent queries.
      await ps.run(
        `Add-Type -AssemblyName System.Printing | Out-Null\n` +
          `$null = [System.Printing.LocalPrintServer]::new()\n`,
        15_000,
      );
    } catch (error) {
      console.warn(
        '[PRINTER-EDGE] warmPrinterEdgeRunspace() failed; runspace will be retried lazily.',
        error instanceof Error ? error.message : String(error),
      );
      discardRunspace();
    }
  });
}

/**
 * Run a PS script through the shared runspace under the shared mutex.
 * On a `runspace already disposed` or hard-failure, recreates the
 * runspace once and retries before giving up.
 */
async function runEdgeScript(
  script: string,
  timeoutMs: number,
): Promise<string> {
  return psMutex.runExclusive(async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const ps = getRunspace();
      try {
        return await ps.run(script, timeoutMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isRecoverable =
          message.includes('PS runspace already disposed') ||
          message.includes('PS runspace query timed out');
        if (!isRecoverable || attempt === 1) {
          throw error;
        }
        console.warn(
          '[PRINTER-EDGE] Persistent runspace failed; recreating.',
          { attempt: attempt + 1, error: message },
        );
        discardRunspace();
      }
    }
    // Unreachable — the loop above either returns or throws.
    throw new Error('[PRINTER-EDGE] runspace script failed after retry');
  });
}

function escapePsString(value: string): string {
  return value.replace(/'/g, "''");
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Queries detailed printer queue status via System.Printing.PrintQueue.
 *
 * Uses the shared persistent runspace — the first call after warmup
 * takes <50 ms (no Add-Type, no New-Object, no Process spawn).
 */
export async function getPrinterStatusViaEdge(
  printerName: string,
): Promise<EdgePrinterStatus | EdgePrinterError> {
  const escaped = escapePsString(printerName);
  // Add-Type is idempotent — re-running on a warm runspace is a no-op.
  // We keep it here as a belt-and-braces measure in case warmup() was
  // skipped (e.g. in unit tests).
  const script = `
    Add-Type -AssemblyName System.Printing | Out-Null
    try {
      $ps = [System.Printing.LocalPrintServer]::new()
      $queue = New-Object System.Printing.PrintQueue($ps, '${escaped}')
      $queue.Refresh()
      @{
        name                = $queue.Name
        isOutOfPaper        = [bool]$queue.IsOutOfPaper
        isPaperJam          = [bool]$queue.IsPaperJam
        isOffline           = [bool]$queue.IsOffline
        isPaused            = [bool]$queue.IsPaused
        isBusy              = [bool]$queue.IsBusy
        isDoorOpened        = [bool]$queue.IsDoorOpened
        isLowOnToner        = [bool]$queue.IsLowOnToner
        isNoToner           = [bool]$queue.IsNoToner
        isManualFeedRequired = [bool]$queue.IsManualFeedRequired
        isOutputBinFull     = [bool]$queue.IsOutputBinFull
        isPaperProblem      = [bool]$queue.IsPaperProblem
        status              = $queue.QueueStatus.ToString()
        queueStatus         = $queue.QueueStatus.ToString()
      } | ConvertTo-Json -Compress
    } catch {
      @{ error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;

  try {
    const json = await runEdgeScript(script, STATUS_TIMEOUT_MS);
    if (!json) return { error: 'Empty response from printer status query' };
    const parsed = JSON.parse(json);
    // PowerShell serialises booleans as True/False — normalise to JS bools
    if ('error' in parsed) return { error: String(parsed.error) };
    return {
      name: String(parsed.name ?? ''),
      isOutOfPaper: Boolean(parsed.isOutOfPaper),
      isPaperJam: Boolean(parsed.isPaperJam),
      isOffline: Boolean(parsed.isOffline),
      isPaused: Boolean(parsed.isPaused),
      isBusy: Boolean(parsed.isBusy),
      isDoorOpened: Boolean(parsed.isDoorOpened),
      isLowOnToner: Boolean(parsed.isLowOnToner),
      isNoToner: Boolean(parsed.isNoToner),
      isManualFeedRequired: Boolean(parsed.isManualFeedRequired),
      isOutputBinFull: Boolean(parsed.isOutputBinFull),
      isPaperProblem: Boolean(parsed.isPaperProblem),
      status: String(parsed.status ?? ''),
      queueStatus: String(parsed.queueStatus ?? ''),
    };
  } catch (err) {
    return {
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Pauses a specific print job in the Windows spooler via
 * System.Printing.PrintSystemJobInfo.Pause().
 */
export async function pausePrintJobViaEdge(
  printerName: string,
  jobId: number,
): Promise<EdgeJobActionResult> {
  const escaped = escapePsString(printerName);
  const script = `
    Add-Type -AssemblyName System.Printing | Out-Null
    try {
      $ps = [System.Printing.LocalPrintServer]::new()
      $queue = New-Object System.Printing.PrintQueue($ps, '${escaped}')
      $queue.Refresh()
      $found = $false
      $alreadyInState = $false
      foreach ($job in $queue.GetPrintJobInfoCollection()) {
        if ($job.JobIdentifier -eq ${jobId}) {
          if ($job.IsPaused) {
            $alreadyInState = $true
          } else {
            $job.Pause()
          }
          $found = $true
          break
        }
      }
      if ($found) {
        @{ success = $true; alreadyInState = $alreadyInState } | ConvertTo-Json -Compress
      } else {
        @{ success = $false; error = 'Job not found in queue'; alreadyInState = $false } | ConvertTo-Json -Compress
      }
    } catch {
      @{ success = $false; error = $_.Exception.Message; alreadyInState = $false } | ConvertTo-Json -Compress
    }
  `;

  try {
    const json = await runEdgeScript(script, PAUSE_RESUME_TIMEOUT_MS);
    if (!json) return { success: false, error: 'Empty response' };
    return JSON.parse(json) as EdgeJobActionResult;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Resumes a specific paused print job in the Windows spooler via
 * System.Printing.PrintSystemJobInfo.Resume().
 */
export async function resumePrintJobViaEdge(
  printerName: string,
  jobId: number,
): Promise<EdgeJobActionResult> {
  const escaped = escapePsString(printerName);
  const script = `
    Add-Type -AssemblyName System.Printing | Out-Null
    try {
      $ps = [System.Printing.LocalPrintServer]::new()
      $queue = New-Object System.Printing.PrintQueue($ps, '${escaped}')
      $queue.Refresh()
      $found = $false
      $alreadyInState = $false
      foreach ($job in $queue.GetPrintJobInfoCollection()) {
        if ($job.JobIdentifier -eq ${jobId}) {
          # EPSON L5290 quirk: when the driver recovers from paper-out it
          # leaves IsPaused=false but the firmware is still parked waiting for
          # the PE-sensor rising edge. Calling Resume() again forces the
          # driver to re-send the start signal to the firmware. If the job is
          # genuinely already printing, the second Resume() is a no-op.
          if ($job.IsPaused) {
            $job.Resume()
          } else {
            $job.Resume()
            $alreadyInState = $true
          }
          $found = $true
          break
        }
      }
      if ($found) {
        @{ success = $true; alreadyInState = $alreadyInState } | ConvertTo-Json -Compress
      } else {
        @{ success = $false; error = 'Job not found in queue'; alreadyInState = $false } | ConvertTo-Json -Compress
      }
    } catch {
      @{ success = $false; error = $_.Exception.Message; alreadyInState = $false } | ConvertTo-Json -Compress
    }
  `;

  try {
    const json = await runEdgeScript(script, PAUSE_RESUME_TIMEOUT_MS);
    if (!json) return { success: false, error: 'Empty response' };
    return JSON.parse(json) as EdgeJobActionResult;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Lists all installed printers with basic status flags.
 */
export async function listPrintersViaEdge(): Promise<any[]> {
  const script = `
    Add-Type -AssemblyName System.Printing | Out-Null
    try {
      $ps = [System.Printing.LocalPrintServer]::new()
      $defaultName = ''
      try { $defaultName = $ps.DefaultPrintQueue.FullName } catch {}
      $result = @()
      foreach ($queue in $ps.GetPrintQueues()) {
        try {
          $queue.Refresh()
          $result += @{
            name         = $queue.Name
            isOutOfPaper = [bool]$queue.IsOutOfPaper
            isPaperJam   = [bool]$queue.IsPaperJam
            isOffline    = [bool]$queue.IsOffline
            isPaused     = [bool]$queue.IsPaused
            isDefault    = ($queue.FullName -eq $defaultName)
          }
        } catch {}
      }
      $result | ConvertTo-Json -Compress
    } catch {
      '[]'
    }
  `;

  try {
    const json = await runEdgeScript(script, LIST_TIMEOUT_MS);
    if (!json || json === 'null') return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Cancels/deletes a specific print job in the Windows spooler via
 * System.Printing.PrintSystemJobInfo.Cancel().
 */
export async function cancelPrintJobViaEdge(
  printerName: string,
  jobId: number,
): Promise<EdgeJobActionResult> {
  const escaped = escapePsString(printerName);
  const script = `
    Add-Type -AssemblyName System.Printing | Out-Null
    try {
      $ps = [System.Printing.LocalPrintServer]::new()
      $queue = New-Object System.Printing.PrintQueue($ps, '${escaped}')
      $queue.Refresh()
      $found = $false
      foreach ($job in $queue.GetPrintJobInfoCollection()) {
        if ($job.JobIdentifier -eq ${jobId}) {
          $job.Cancel()
          $found = $true
          break
        }
      }
      if ($found) {
        @{ success = $true } | ConvertTo-Json -Compress
      } else {
        @{ success = $false; error = 'Job not found in queue' } | ConvertTo-Json -Compress
      }
    } catch {
      @{ success = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
    }
  `;

  try {
    const json = await runEdgeScript(script, PAUSE_RESUME_TIMEOUT_MS);
    if (!json) return { success: false, error: 'Empty response' };
    return JSON.parse(json) as EdgeJobActionResult;
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}