import os from 'os';

export function getLocalIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  let fallback: string | null = null;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      const isHotspot =
        /Wi-Fi Direct|Local Area Connection\*/i.test(name) ||
        iface.address.startsWith('192.168.5.') ||
        iface.address.startsWith('192.168.137.');
      if (isHotspot) return iface.address;

      if (!fallback) fallback = iface.address;
    }
  }

  return fallback;
}
