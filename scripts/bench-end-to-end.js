// Mimics the kiosk's pausePrintJobViaEdge() end-to-end:
// spawn powershell.exe -> Add-Type System.Printing -> connect LocalPrintServer
// -> open PrintQueue -> find job -> call Pause(). The job is left alone after.

const { execFile } = require('node:child_process');

function runPs(script) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 8000, windowsHide: true },
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
      '  ' + label + ': total=' + total + ' ms (runPs=' + elapsed + ' ms) stdout=' + stdout.slice(0, 60),
    );
  } catch (err) {
    const total = Date.now() - t0;
    console.log('  ' + label + ': FAILED after ' + total + ' ms - ' + err.message.slice(0, 80));
  }
}

const connectScript =
  "Add-Type -AssemblyName System.Printing\n" +
  "$ps = New-Object System.Printing.LocalPrintServer\n" +
  "$q = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')\n" +
  "$q.Refresh()\n" +
  "$job = $q.GetPrintJobInfoCollection() | Select-Object -First 1\n" +
  "if ($job) { 'job=' + $job.JobIdentifier } else { 'nojobs' }";

const pauseScript =
  "Add-Type -AssemblyName System.Printing\n" +
  "$ps = New-Object System.Printing.LocalPrintServer\n" +
  "$q = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')\n" +
  "$q.Refresh()\n" +
  "$job = $q.GetPrintJobInfoCollection() | Select-Object -First 1\n" +
  "if ($job) { $job.Pause(); 'paused=' + $job.JobIdentifier } else { 'nojobs' }";

const resumeScript =
  "Add-Type -AssemblyName System.Printing\n" +
  "$ps = New-Object System.Printing.LocalPrintServer\n" +
  "$q = New-Object System.Printing.PrintQueue($ps, 'EPSON L5290 Series')\n" +
  "$q.Refresh()\n" +
  "$job = $q.GetPrintJobInfoCollection() | Where-Object { $_.IsPaused } | Select-Object -First 1\n" +
  "if ($job) { $job.Resume(); 'resumed=' + $job.JobIdentifier } else { 'nopaused' }";

(async () => {
  console.log('--- Kiosk-equivalent (cold start per call) ---');
  await timeScript('Connect (cold)', connectScript);
  await timeScript('Connect (warm)', connectScript);
  await timeScript('Pause',          pauseScript);
  await timeScript('Resume',         resumeScript);
})();
