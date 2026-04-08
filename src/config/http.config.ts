import os from 'node:os';
import path from 'node:path';

const DEFAULT_PORT = 3000;
const rawPort = process.env.PORT?.trim();
const parsedPort =
  rawPort !== undefined && /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
export const PORT =
  Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535
    ? parsedPort
    : DEFAULT_PORT;
export const UPLOAD_DIR = 'uploads/';
export const PORTAL_ASSETS = new Set(['styles.css', 'app.js']);
export const PORTAL_DIR = path.resolve('src/public/upload');
export const PUBLIC_DIR = path.resolve('src/public');
export const PREVIEW_CACHE_DIR = path.join(
  os.tmpdir(),
  'printbit-preview-cache',
);

export const NETWORK_PROVIDER =
  process.env.PRINTBIT_NETWORK_PROVIDER?.trim().toLowerCase() === 'esp32'
    ? 'esp32'
    : 'mypublicwifi';
const DEFAULT_HOTSPOT_SSID =
  NETWORK_PROVIDER === 'esp32' ? 'PrintBit' : 'PrintBit-Kiosk';
const DEFAULT_HOTSPOT_PASSWORD =
  NETWORK_PROVIDER === 'esp32' ? '' : 'printbit123';

/** Hotspot settings (configurable via env) */
export const HOTSPOT_SSID =
  process.env.PRINTBIT_HOTSPOT_SSID ?? DEFAULT_HOTSPOT_SSID;
export const HOTSPOT_PASSWORD =
  process.env.PRINTBIT_HOTSPOT_PASSWORD ?? DEFAULT_HOTSPOT_PASSWORD;
const rawHotspotAuthType = process.env.PRINTBIT_HOTSPOT_AUTH_TYPE?.trim();
const normalizedHotspotAuthType =
  rawHotspotAuthType && rawHotspotAuthType.length > 0
    ? rawHotspotAuthType
    : HOTSPOT_PASSWORD.trim().length > 0
      ? 'WPA'
      : 'nopass';
export const HOTSPOT_AUTH_TYPE =
  HOTSPOT_PASSWORD.trim().length > 0 &&
  normalizedHotspotAuthType.toUpperCase() === 'NOPASS'
    ? 'WPA'
    : normalizedHotspotAuthType;
export const ESP32_CAPTIVE_PORTAL_PATH =
  process.env.PRINTBIT_ESP32_CAPTIVE_PORTAL_PATH ?? '/portal';
export const ESP32_AP_BASE_URL =
  process.env.PRINTBIT_ESP32_AP_BASE_URL?.trim() || 'http://192.168.4.1';
export const ESP32_REGISTER_TOKEN =
  process.env.PRINTBIT_ESP32_REGISTER_TOKEN?.trim() ||
  'printbit-register-token';
export const ESP32_KIOSK_SUBNET_PREFIX =
  process.env.PRINTBIT_ESP32_KIOSK_SUBNET_PREFIX?.trim() || '192.168.4.';
/** Explicit kiosk IP on the ESP32 AP network (bypasses auto-detection). */
export const ESP32_KIOSK_IP =
  process.env.PRINTBIT_ESP32_KIOSK_IP?.trim() || undefined;
export const ESP32_COIN_BRIDGE_SOURCE =
  process.env.PRINTBIT_ESP32_COIN_SOURCE?.trim() || 'esp32';
const rawEsp32CoinBridgeApiKey =
  process.env.PRINTBIT_ESP32_COIN_API_KEY?.trim() || '';
if (NETWORK_PROVIDER === 'esp32' && rawEsp32CoinBridgeApiKey.length === 0) {
  throw new Error(
    'PRINTBIT_ESP32_COIN_API_KEY must be set when PRINTBIT_NETWORK_PROVIDER=esp32.',
  );
}
export const ESP32_COIN_BRIDGE_API_KEY =
  rawEsp32CoinBridgeApiKey.length > 0
    ? rawEsp32CoinBridgeApiKey
    : 'printbit-coin-bridge-key';
const relaxedBridgeTokens = new Set(['1', 'true', 'yes', 'on']);
export const ESP32_COIN_BRIDGE_RELAXED_MODE = relaxedBridgeTokens.has(
  process.env.PRINTBIT_ESP32_COIN_BRIDGE_RELAXED?.trim().toLowerCase() ?? '',
);
const alwaysAcceptCoinTokens = new Set(['1', 'true', 'yes', 'on']);
const defaultAlwaysAcceptCoinsToken =
  NETWORK_PROVIDER === 'esp32' ? 'true' : 'false';
export const ESP32_ALWAYS_ACCEPT_COINS = alwaysAcceptCoinTokens.has(
  process.env.PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS
    ?.trim()
    .toLowerCase() ?? defaultAlwaysAcceptCoinsToken,
);
export const CAPTIVE_PORTAL_ENABLED =
  process.env.PRINTBIT_CAPTIVE_PORTAL !== 'false';

/** Kiosk lockdown controls */
export const KIOSK_LOCKDOWN_ENABLED =
  process.env.PRINTBIT_KIOSK_LOCKDOWN === 'true';
const USB_EXPORT_DISABLED_TOKENS = new Set(['false', '0', 'no', '']);
const usbExportEnv =
  process.env.PRINTBIT_USB_EXPORT_ENABLED?.trim().toLowerCase();
export const USB_EXPORT_ENABLED =
  usbExportEnv !== undefined
    ? !USB_EXPORT_DISABLED_TOKENS.has(usbExportEnv)
    : !KIOSK_LOCKDOWN_ENABLED;

/** MyPublicWiFi installation path */
export const MYPUBLICWIFI_PATH =
  process.env.PRINTBIT_MYPUBLICWIFI_PATH ??
  path.join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'MyPublicWiFi',
  );

/** Optional public URL override for tunnel/reverse-proxy (e.g. Cloudflare Tunnel). */
export const PUBLIC_URL =
  process.env.PRINTBIT_PUBLIC_URL?.replace(/\/+$/, '') || undefined;

const rawSessionExpiryEnabled =
  process.env.PRINTBIT_SESSION_EXPIRY_ENABLED?.trim().toLowerCase();
const SESSION_EXPIRY_DISABLED_TOKENS = new Set(['false', '0', 'no', 'off']);
export const SESSION_EXPIRY_ENABLED =
  rawSessionExpiryEnabled === undefined
    ? true
    : !SESSION_EXPIRY_DISABLED_TOKENS.has(rawSessionExpiryEnabled);

export const PUBLIC_PAGE_ROUTES: Array<{ route: string; filePath: string }> = [
  { route: '/', filePath: path.join(PUBLIC_DIR, 'index.html') },
  { route: '/print', filePath: path.join(PUBLIC_DIR, 'print', 'index.html') },
  { route: '/copy', filePath: path.join(PUBLIC_DIR, 'copy', 'index.html') },
  { route: '/config', filePath: path.join(PUBLIC_DIR, 'config', 'index.html') },
  {
    route: '/confirm',
    filePath: path.join(PUBLIC_DIR, 'confirm', 'index.html'),
  },
  {
    route: '/receipt/:transactionId',
    filePath: path.join(PUBLIC_DIR, 'receipt', 'index.html'),
  },
  { route: '/scan', filePath: path.join(PUBLIC_DIR, 'scan', 'index.html') },
  {
    route: '/admin/dashboard',
    filePath: path.join(PUBLIC_DIR, 'admin', 'dashboard', 'index.html'),
  },
  {
    route: '/admin/earnings',
    filePath: path.join(PUBLIC_DIR, 'admin', 'earnings', 'index.html'),
  },
  {
    route: '/admin/system',
    filePath: path.join(PUBLIC_DIR, 'admin', 'system', 'index.html'),
  },
  {
    route: '/admin/settings',
    filePath: path.join(PUBLIC_DIR, 'admin', 'settings', 'index.html'),
  },
  {
    route: '/admin/logs',
    filePath: path.join(PUBLIC_DIR, 'admin', 'logs', 'index.html'),
  },
  {
    route: '/admin/feedback',
    filePath: path.join(PUBLIC_DIR, 'admin', 'feedback', 'index.html'),
  },
  {
    route: '/admin/report',
    filePath: path.join(PUBLIC_DIR, 'admin', 'report', 'index.html'),
  },
  {
    route: '/admin/alerts',
    filePath: path.join(PUBLIC_DIR, 'admin', 'alerts', 'index.html'),
  },
];
