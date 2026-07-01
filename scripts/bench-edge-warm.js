// Mimics the kiosk's NEW pausePrintJobViaEdge() end-to-end via the
// persistent PowerShell runspace. Submit a synthetic job, then run a
// sequence of Pause/Resume round-trips against the shared runspace.
//
// The expected improvement vs scripts/bench-end-to-end.js:
//   - Cold first call: ~450 ms (process spawn is unavoidable).
//   - Warm subsequent Pause/Resume: <100 ms (just PS command round-trip).

const { execFile } = require('node:child_process');

function runPs(script, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true },
      (error, stdout, stderr) => {
        const elapsed = Date.now() - t0;
        if (error) reject(new Error(stderr?.trim() || error.message));
        else resolve({ stdout: stdout.trim(), elapsed });
      },
    );
  });
}

async function timeScript(label, script) {
  const t0 = Date.now();
  try {
    const { stdout, elapsed } = await runPs(script);
    const total = Date.now() - t0;
    console.log(
      '  ' + label + ': total=' + total + ' ms (ps=' + elapsed + ' ms) stdout=' + stdout.slice(0, 60),
    );
  } catch (err) {
    const total = Date.now() - t0;
    console.log('  ' + label + ': FAILED after ' + total + ' ms - ' + err.message.slice(0, 80));
  }
}

// Simulates the persistent runspace's behavior: one process, many queries,
// sentinel-delimited output. Spawning it ourselves in JS proves the savings
// don't depend on anything internal to the kiosk — it's just the cost of
// re-using a single PowerShell process.
const { spawn } = require('node:child_process');

function createRunspace() {
  const ps = spawn(
    'powershell.exe',
    ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  ps.stderr.resume();
  let disposed = false;

  function run(script, timeoutMs = 10000) {
    if (disposed) return Promise.reject(new Error('disposed'));
    return new Promise((resolve, reject) => {
      const sentinel = `__DONE_${Date.now()}_${Math.random().toString(36).slice(2)}__`;
      let output = '';
      const timer = setTimeout(() => {
        ps.stdout.off('data', onData);
        reject(new Error('timeout'));
      }, timeoutMs);
      const onData = (chunk) => {
        output += chunk.toString();
        if (output.includes(sentinel)) {
          clearTimeout(timer);
          ps.stdout.off('data', onData);
          resolve(output.slice(0, output.indexOf(sentinel)).trim());
        }
      };
      ps.stdout.on('data', onData);
      ps.stdin.write(`${script}\nWrite-Output '${sentinel}'\n`);
    });
  }

  return { run, dispose: () => { disposed = true; try { ps.kill(); } catch {} } };
}

(async () => {
  console.log('--- Cold start (Add-Type + LocalPrintServer + Refresh) ---');
  // First call: still pays the cold-start cost.
  await timeScript(
    'Cold first call',
    "Add-Type -AssemblyName System.Printing | Out-Null\n" +
      "$ps = [System.Printing.LocalPrintServer]::new()\n" +
      "$q = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')\n" +
      "$q.Refresh()\n" +
      "@{name=$q.Name; isPaused=[bool]$q.IsPaused; jobs=$q.GetPrintJobInfoCollection().Count} | ConvertTo-Json -Compress",
  );

  console.log('--- Persistent runspace (warm) ---');
  const ps = createRunspace();
  // Warm-up: prime the assembly + LocalPrintServer inside the runspace.
  await ps.run(
    "Add-Type -AssemblyName System.Printing | Out-Null\n" +
      "$null = [System.Printing.LocalPrintServer]::new()\n",
  );

  // Subsequent calls share the warm runspace.
  const warmScript =
    "$ps = [System.Printing.LocalPrintServer]::new()\n" +
    "$q = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')\n" +
    "$q.Refresh()\n" +
    "@{name=$q.Name; isPaused=[bool]$q.IsPaused; jobs=$q.GetPrintJobInfoCollection().Count} | ConvertTo-Json -Compress";

  for (let i = 1; i <= 5; i += 1) {
    const t0 = Date.now();
    try {
      const out = await ps.run(warmScript, 5000);
      const total = Date.now() - t0;
      console.log('  Warm query #' + i + ': total=' + total + ' ms stdout=' + out.slice(0, 80));
    } catch (err) {
      const total = Date.now() - t0;
      console.log('  Warm query #' + i + ': FAILED after ' + total + ' ms - ' + err.message);
    }
  }

  // Bonus: a real Pause/Resume round-trip against the runspace (only run if
  // there is a real spooler job present, otherwise skip with a notice).
  console.log('--- Pause/Resume against warm runspace ---');
  const pauseScript =
    "$ps = [System.Printing.LocalPrintServer]::new()\n" +
    "$q = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')\n" +
    "$q.Refresh()\n" +
    "$job = $q.GetPrintJobInfoCollection() | Where-Object { -not $_.IsPaused } | Select-Object -First 1\n" +
    "if ($job) { $job.Pause(); 'paused=' + $job.JobIdentifier } else { 'nojobs' }";
  const resumeScript =
    "$ps = [System.Printing.LocalPrintServer]::new()\n" +
    "$q = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')\n" +
    "$q.Refresh()\n" +
    "$job = $q.GetPrintJobInfoCollection() | Where-Object { $_.IsPaused } | Select-Object -First 1\n" +
    "if ($job) { $job.Resume(); 'resumed=' + $job.JobIdentifier } else { 'nopaused' }";

  for (let i = 1; i <= 3; i += 1) {
    const t0 = Date.now();
    try {
      const out = await ps.run(pauseScript, 15000);
      const total = Date.now() - t0;
      console.log('  Pause #' + i + ': total=' + total + ' ms stdout=' + out);
    } catch (err) {
      const total = Date.now() - t0;
      console.log('  Pause #' + i + ': FAILED after ' + total + ' ms - ' + err.message);
    }
    await new Promise((r) => setTimeout(r, 300));
    const t1 = Date.now();
    try {
      const out = await ps.run(resumeScript, 15000);
      const total = Date.now() - t0;
      console.log('  Resume #' + i + ': total=' + total + ' ms stdout=' + out);
    } catch (err) {
      const total = Date.now() - t1;
      console.log('  Resume #' + i + ': FAILED after ' + total + ' ms - ' + err.message);
    }
  }

  ps.dispose();
})();
