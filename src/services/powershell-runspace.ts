/**
 * Persistent PowerShell runspace shared across kiosk services.
 *
 * The kiosk calls PowerShell + System.Printing / Get-PrintJob many times per
 * minute (status polls, pause, resume, job queries). Spawning a fresh
 * `powershell.exe` per call costs ~400 ms of process startup that is pure
 * overhead — the actual driver / API calls are 2-50 ms once the assembly is
 * loaded.
 *
 * `createPersistentPS()` keeps one PowerShell process alive across many
 * queries, multiplexing commands on a single stdin/stdout pipe via a unique
 * sentinel per call. This is the same pattern used by `print-spooler.ts`.
 *
 * Caveats:
 *   - The implementation is single-threaded by design. Callers MUST serialize
 *     concurrent invocations through a mutex (see `withMutex` helper or the
 *     `psMutex` exported by `windows-printer-edge.ts`).
 *   - If a command's process crashes or the runspace hangs, the singleton is
 *     stuck. Callers should detect `runspace already disposed` errors and
 *     recreate. A `dispose()` followed by a fresh `createPersistentPS()`
 *     recovers cleanly.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

export interface PersistentPS {
  run: (script: string, timeoutMs?: number) => Promise<string>;
  dispose: () => void;
  readonly disposed: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export function createPersistentPS(): PersistentPS {
  const ps: ChildProcessWithoutNullStreams = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );

  // Drain stderr so the process never blocks on a full stderr pipe buffer.
  // We don't need it — non-fatal PS warnings go there and can be ignored.
  ps.stderr.resume();

  let disposed = false;

  function run(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
    // NOTE: This implementation is NOT safe for concurrent calls.
    // Always await the previous run() before calling again.
    if (disposed) {
      return Promise.reject(new Error('PS runspace already disposed'));
    }

    return new Promise((resolve, reject) => {
      // A unique sentinel lets us know exactly when this command's output ends,
      // since stdout is a continuous stream shared across all run() calls.
      const sentinel = `__PS_DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
      let output = '';

      const timer = setTimeout(() => {
        ps.stdout.off('data', onData);
        dispose();
        reject(new Error('PS runspace query timed out'));
      }, timeoutMs);

      const onData = (chunk: Buffer): void => {
        output += chunk.toString();
        if (output.includes(sentinel)) {
          clearTimeout(timer);
          ps.stdout.off('data', onData);
          // Return everything before the sentinel line, trimmed
          resolve(output.slice(0, output.indexOf(sentinel)).trim());
        }
      };

      ps.stdout.on('data', onData);
      // Append Write-Output of the sentinel so we detect end-of-output
      ps.stdin.write(`${script}\nWrite-Output '${sentinel}'\n`);
    });
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    try {
      ps.stdin.end();
    } catch {
      /* ignore — process may already be gone */
    }
    try {
      ps.kill();
    } catch {
      /* ignore */
    }
  }

  return {
    run,
    dispose,
    get disposed() {
      return disposed;
    },
  };
}

/**
 * Tiny single-slot async mutex. Wraps the persistent-PS pattern so that
 * concurrent callers serialize cleanly on the shared stdin/stdout pipe.
 *
 * Usage:
 *   const mutex = createMutex();
 *   await mutex.runExclusive(() => ps.run(script));
 */
export interface AsyncMutex {
  runExclusive<T>(fn: () => Promise<T>): Promise<T>;
}

export function createMutex(): AsyncMutex {
  let chain: Promise<unknown> = Promise.resolve();
  return {
    runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      const next = chain.then(fn, fn);
      // Reset the chain even on rejection so a failed task doesn't poison
      // subsequent tasks.
      chain = next.catch(() => undefined);
      return next;
    },
  };
}
