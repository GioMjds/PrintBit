const { spawn } = require('child_process');
const port = process.env.PORT || '3000';
const localBaseUrl = `http://127.0.0.1:${port}`;

async function launch() {
  const response = await fetch(
    `${localBaseUrl}/api/kiosk/bootstrap-credential`,
    {
      method: 'POST',
    },
  );
  if (!response.ok)
    throw new Error(`Kiosk bootstrap failed (${response.status})`);
  const payload = await response.json();
  if (typeof payload.credential !== 'string')
    throw new Error('Kiosk bootstrap returned no credential');
  const url = `${localBaseUrl}/kiosk/bootstrap?credential=${encodeURIComponent(payload.credential)}`;
  const args = ['--kiosk', url, '--edge-kiosk-type=fullscreen'];
  const child = spawn('msedge.exe', args, { detached: true, stdio: 'ignore' });
  child.unref();
}

launch().catch((err) => {
  console.error(err instanceof Error ? err.message : 'Unable to launch kiosk.');
  process.exitCode = 1;
});
