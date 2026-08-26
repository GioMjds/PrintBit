/**
 * Protocol formatting and telemetry parser for ESP32 serial IP discovery and Wi-Fi management.
 */

export interface SerialTelemetryEvent {
  type:
    | 'AP_IP'
    | 'STA_IP'
    | 'KIOSK_IP'
    | 'COIN_TARGET'
    | 'PORTAL_TARGET'
    | 'WIFI_STA_CONNECTED'
    | 'WIFI_STA_DISCONNECTED'
    | 'WIFI_STA_CONNECTING'
    | 'WIFI_SETUP_READY';
  value: string;
}

function isValidIpv4(ip: string): boolean {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) return false;
  }
  return true;
}

/**
 * Formats a KIOSK_IP command string to send to the ESP32 over serial.
 */
export function formatKioskIpCommand(
  ip: string,
  port = 3000,
  path = '/portal',
): string | null {
  const trimmedIp = ip.trim();
  if (!isValidIpv4(trimmedIp)) return null;

  const validPort =
    Number.isInteger(port) && port > 0 && port <= 65535 ? port : 3000;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  return `KIOSK_IP ${trimmedIp} ${validPort} ${normalizedPath}\n`;
}

/**
 * Formats a Wi-Fi maintenance command string.
 */
export function formatWifiCommand(action: 'status' | 'disconnect' | 'scan'): string {
  switch (action) {
    case 'status':
      return 'WIFI_STATUS\n';
    case 'disconnect':
      return 'WIFI_DISCONNECT\n';
    case 'scan':
      return 'WIFI_SCAN\n';
  }
}

/**
 * Parses telemetry lines received from the ESP32 firmware over serial.
 */
export function parseSerialTelemetryLine(
  rawLine: string,
): SerialTelemetryEvent | null {
  const token = rawLine.trim();
  if (token.length === 0) return null;

  if (token === 'WIFI_STA_CONNECTED') {
    return { type: 'WIFI_STA_CONNECTED', value: 'connected' };
  }

  if (token === 'WIFI_STA_DISCONNECTED') {
    return { type: 'WIFI_STA_DISCONNECTED', value: 'disconnected' };
  }

  if (token.startsWith('WIFI_STA_CONNECTING:')) {
    const ssid = token.slice('WIFI_STA_CONNECTING:'.length).trim();
    return { type: 'WIFI_STA_CONNECTING', value: ssid };
  }

  if (token.startsWith('WIFI_SETUP_READY:')) {
    const url = token.slice('WIFI_SETUP_READY:'.length).trim();
    return { type: 'WIFI_SETUP_READY', value: url };
  }

  if (token.startsWith('AP_IP:')) {
    const ip = token.slice('AP_IP:'.length).trim();
    if (isValidIpv4(ip)) return { type: 'AP_IP', value: ip };
  }

  if (token.startsWith('STA_IP:')) {
    const ip = token.slice('STA_IP:'.length).trim();
    if (isValidIpv4(ip)) return { type: 'STA_IP', value: ip };
  }

  if (token.startsWith('KIOSK_IP:')) {
    const ip = token.slice('KIOSK_IP:'.length).trim();
    if (isValidIpv4(ip)) return { type: 'KIOSK_IP', value: ip };
  }

  if (token.startsWith('coin_target:')) {
    const url = token.slice('coin_target:'.length).trim();
    if (url.length > 0) return { type: 'COIN_TARGET', value: url };
  }

  if (token.startsWith('portal_target:')) {
    const url = token.slice('portal_target:'.length).trim();
    if (url.length > 0) return { type: 'PORTAL_TARGET', value: url };
  }

  return null;
}
