import os from 'node:os';
import path from 'node:path';

const DEFAULT_PORT = 3000;
const parsedPort = Number.parseInt(process.env.PORT ?? '', 10);
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

/** Hotspot settings (configurable via env) */
export const HOTSPOT_SSID =
  process.env.PRINTBIT_HOTSPOT_SSID ?? 'PrintBit-Kiosk';
export const HOTSPOT_PASSWORD =
  process.env.PRINTBIT_HOTSPOT_PASSWORD ?? 'printbit123';
export const NETWORK_PROVIDER =
  process.env.PRINTBIT_NETWORK_PROVIDER?.trim().toLowerCase() === 'esp32'
    ? 'esp32'
    : 'mypublicwifi';
export const HOTSPOT_AUTH_TYPE =
  process.env.PRINTBIT_HOTSPOT_AUTH_TYPE ??
  (HOTSPOT_PASSWORD.trim().length > 0 ? 'WPA' : 'nopass');
export const ESP32_CAPTIVE_PORTAL_PATH =
  process.env.PRINTBIT_ESP32_CAPTIVE_PORTAL_PATH ?? '/portal';
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

export const PUBLIC_PAGE_ROUTES: Array<{ route: string; filePath: string }> = [
  { route: '/', filePath: path.join(PUBLIC_DIR, 'index.html') },
  { route: '/print', filePath: path.join(PUBLIC_DIR, 'print', 'index.html') },
  { route: '/copy', filePath: path.join(PUBLIC_DIR, 'copy', 'index.html') },
  { route: '/config', filePath: path.join(PUBLIC_DIR, 'config', 'index.html') },
  {
    route: '/confirm',
    filePath: path.join(PUBLIC_DIR, 'confirm', 'index.html'),
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
    route: '/admin/coins',
    filePath: path.join(PUBLIC_DIR, 'admin', 'coin-stats', 'index.html'),
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
