const os = require('os');
const { spawn } = require('child_process');

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  const all = [];

  for (const ifaces of Object.values(interfaces)) {
    for (const iface of ifaces || []) {
      if (iface.family === 'IPv4' && !iface.internal) all.push(iface.address);
    }
  }

  // Prefer hotspot ranges first.
  const preferred = all.find(
    ip =>
      ip.startsWith('192.168.4.') ||
      ip.startsWith('192.168.5.') ||
      ip.startsWith('192.168.137.'),
  );
  return preferred ?? all[0] ?? null;
}

const networkProvider = (process.env.PRINTBIT_NETWORK_PROVIDER || '')
  .trim()
  .toLowerCase();
const esp32KioskIp = (process.env.PRINTBIT_ESP32_KIOSK_IP || '192.168.4.2').trim();
const host =
  networkProvider === 'esp32' ? esp32KioskIp : getLocalIPv4() || 'localhost';
const port = process.env.PORT || '3000';
const url = `http://${host}:${port}`;
const args = ['--kiosk', url, '--edge-kiosk-type=fullscreen'];

// detach so Edge keeps running after this process exits
const child = spawn('msedge.exe', args, {
  detached: true,
  stdio: 'ignore',
});

child.unref();
