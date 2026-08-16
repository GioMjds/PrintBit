/**
 * Network utility functions for IP address handling and detection.
 */
import os from 'os';

/**
 * Get the local IPv4 address, preferring hotspot adapters.
 */
export function getLocalIPv4(): string | null {
  const interfaces = os.networkInterfaces();
  let fallback: string | null = null;

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family !== 'IPv4' || iface.internal) continue;

      // Prefer hotspot adapter: Windows Mobile Hotspot (192.168.137.x)
      const isHotspot =
        /Wi-Fi Direct|Local Area Connection\*/i.test(name) ||
        iface.address.startsWith('192.168.137.');
      if (isHotspot) return iface.address;

      if (!fallback) fallback = iface.address;
    }
  }

  return fallback;
}

/**
 * Normalize a remote IP address by stripping IPv4-mapped IPv6 prefix.
 */
export function normalizeRemoteIp(rawIp: string): string {
  const normalized = rawIp.toLowerCase();
  if (normalized.startsWith('::ffff:')) {
    return normalized.slice('::ffff:'.length);
  }
  return normalized;
}

/**
 * Check if a request originated from localhost.
 */
export function isLoopbackRequest(remoteIp: string): boolean {
  const ip = normalizeRemoteIp(remoteIp);
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}
