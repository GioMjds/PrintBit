/**
 * Windows Printer Bridge — PowerShell-based access to System.Printing API.
 *
 * Provides the same interface as the edge-js version but uses PowerShell
 * + Add-Type to call System.Printing, which avoids native module compilation
 * issues on newer Node.js versions.
 */

import { execFile } from 'node:child_process';

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
}

// ── Helpers ──────────────────────────────────────────────────────

const PS_TIMEOUT_MS = 8_000;

function runPs(script: string, timeoutMs = PS_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr?.trim() || error.message));
        } else {
          resolve(stdout.trim());
        }
      },
    );
  });
}

function escapePsString(value: string): string {
  return value.replace(/'/g, "''");
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Queries detailed printer queue status via System.Printing.PrintQueue
 * through PowerShell Add-Type.
 */
export async function getPrinterStatusViaEdge(
  printerName: string,
): Promise<EdgePrinterStatus | EdgePrinterError> {
  const escaped = escapePsString(printerName);
  const script = `
    Add-Type -AssemblyName System.Printing
    try {
      $ps = New-Object System.Printing.LocalPrintServer
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
    const json = await runPs(script);
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
    Add-Type -AssemblyName System.Printing
    try {
      $ps = New-Object System.Printing.LocalPrintServer
      $queue = New-Object System.Printing.PrintQueue($ps, '${escaped}')
      $found = $false
      foreach ($job in $queue.GetPrintJobInfoCollection()) {
        if ($job.JobIdentifier -eq ${jobId}) {
          $job.Pause()
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
    const json = await runPs(script);
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
    Add-Type -AssemblyName System.Printing
    try {
      $ps = New-Object System.Printing.LocalPrintServer
      $queue = New-Object System.Printing.PrintQueue($ps, '${escaped}')
      $found = $false
      foreach ($job in $queue.GetPrintJobInfoCollection()) {
        if ($job.JobIdentifier -eq ${jobId}) {
          $job.Resume()
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
    const json = await runPs(script);
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
    Add-Type -AssemblyName System.Printing
    try {
      $ps = New-Object System.Printing.LocalPrintServer
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
    const json = await runPs(script, 10_000);
    if (!json || json === 'null') return [];
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}
