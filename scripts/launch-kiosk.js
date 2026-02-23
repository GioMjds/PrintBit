const os = require('os');
const { spawn } = require('child_process');

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return null;
}

const host = getLocalIPv4() || 'localhost';
const port = process.env.PORT || '3000';
const url = `http://${host}:${port}`;
const args = ['--kiosk', url, '--edge-kiosk-type=fullscreen'];

// detach so Edge keeps running after this process exits
const child = spawn('msedge.exe', args, {
  detached: true,
  stdio: 'ignore',
});

child.unref();