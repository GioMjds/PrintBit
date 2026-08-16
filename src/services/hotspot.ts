import os from 'node:os';
import { execSync } from 'node:child_process';
import {
  HOTSPOT_SSID,
  HOTSPOT_PASSWORD,
  HOTSPOT_AUTH_TYPE,
  ESP32_CAPTIVE_PORTAL_PATH,
  ESP32_AP_BASE_URL,
  ESP32_REGISTER_TOKEN,
  ESP32_KIOSK_SUBNET_PREFIX,
  ESP32_KIOSK_IP,
  PORT,
} from '@/config/http.config';
import {
  markWatchdogHeartbeat,
  setWatchdogComponentState,
} from './watchdog-health';

const ESP32_REGISTER_ROUTE = '/kiosk/register';
const ESP32_REGISTER_INTERVAL_MS = 15_000;
const ESP32_REGISTER_TIMEOUT_MS = 2_500;

function isValidIpv4Address(value: string): boolean {
  const trimmed = value.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return false;
    const numeric = Number(part);
    if (!Number.isInteger(numeric) || numeric < 0 || numeric > 255)
      return false;
  }
  return true;
}

function extractEsp32SubnetPrefix(): string | null {
  try {
    const baseUrl = new URL(ESP32_AP_BASE_URL);
    const host = baseUrl.hostname.trim();
    if (!isValidIpv4Address(host)) return null;
    const octets = host.split('.');
    return `${octets[0]}.${octets[1]}.${octets[2]}.`;
  } catch {
    return null;
  }
}

function ensureFirewallRules(): void {
  const rules = [{ name: 'PrintBit-Server-3000', port: 3000, proto: 'TCP' }];

  for (const { name, port, proto } of rules) {
    try {
      const check = execSync(
        `netsh advfirewall firewall show rule name="${name}"`,
        { stdio: 'pipe', timeout: 5_000, encoding: 'utf-8' },
      );
      if (check.includes('No rules match')) throw new Error('missing');
    } catch {
      try {
        execSync(
          `netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=${proto} localport=${port}`,
          { stdio: 'ignore', timeout: 5_000 },
        );
        console.log(`[HOTSPOT] → Firewall rule added: ${name}`);
      } catch {
        /* not admin or exists */
      }
    }
  }
}

function detectEsp32KioskIp(): string | null {
  const preferredPrefixes: string[] = [];
  if (ESP32_KIOSK_SUBNET_PREFIX.trim().length > 0) {
    preferredPrefixes.push(ESP32_KIOSK_SUBNET_PREFIX.trim());
  }
  const esp32SubnetPrefix = extractEsp32SubnetPrefix();
  if (esp32SubnetPrefix && !preferredPrefixes.includes(esp32SubnetPrefix)) {
    preferredPrefixes.push(esp32SubnetPrefix);
  }

  let privateFallback: string | null = null;
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (
        preferredPrefixes.some((prefix) => iface.address.startsWith(prefix))
      ) {
        return iface.address;
      }
      if (
        !privateFallback &&
        /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(iface.address)
      ) {
        privateFallback = iface.address;
      }
    }
  }
  return privateFallback;
}

async function registerKioskWithEsp32(): Promise<boolean> {
  const configuredKioskIp = ESP32_KIOSK_IP?.trim();
  const kioskIp =
    configuredKioskIp && isValidIpv4Address(configuredKioskIp)
      ? configuredKioskIp
      : detectEsp32KioskIp();

  if (!kioskIp) {
    console.warn(
      `[HOTSPOT] ⚠ ESP32 provider active, but kiosk IP could not be resolved for registration.`,
    );
    console.warn(
      `[HOTSPOT]   Set PRINTBIT_ESP32_KIOSK_IP in .env or verify kiosk is on the same LAN as the ESP32 base URL (${ESP32_AP_BASE_URL}).`,
    );
    return false;
  }

  const requestUrl = new URL(ESP32_REGISTER_ROUTE, `${ESP32_AP_BASE_URL}/`);
  const payload = new URLSearchParams({
    token: ESP32_REGISTER_TOKEN,
    ip: kioskIp,
    port: String(PORT),
    path: ESP32_CAPTIVE_PORTAL_PATH,
  });
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    ESP32_REGISTER_TIMEOUT_MS,
  );

  try {
    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: payload.toString(),
      signal: abortController.signal,
    });
    if (!response.ok) {
      console.warn(
        `[HOTSPOT] ⚠ ESP32 kiosk registration failed (${response.status}) at ${requestUrl.toString()}`,
      );
      return false;
    }
    console.log(
      `[HOTSPOT] ✓ ESP32 kiosk registration updated: ${kioskIp}:${PORT}${ESP32_CAPTIVE_PORTAL_PATH}`,
    );
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[HOTSPOT] ⚠ Could not register kiosk with ESP32 at ${requestUrl.toString()}: ${message}`,
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

class HotspotService {
  private running = false;
  private esp32RegistrationTimer: NodeJS.Timeout | null = null;

  private stopEsp32RegistrationLoop(): void {
    if (this.esp32RegistrationTimer) {
      clearInterval(this.esp32RegistrationTimer);
      this.esp32RegistrationTimer = null;
    }
  }

  private async startEsp32RegistrationLoop(): Promise<void> {
    this.stopEsp32RegistrationLoop();

    await registerKioskWithEsp32();
    this.esp32RegistrationTimer = setInterval(() => {
      void registerKioskWithEsp32();
    }, ESP32_REGISTER_INTERVAL_MS);
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(): Promise<void> {
    if (this.running) {
      console.log('[HOTSPOT] Already running — skipping');
      markWatchdogHeartbeat('hotspot', { running: true, provider: 'esp32' });
      setWatchdogComponentState(
        'hotspot',
        'healthy',
        'Hotspot already running.',
        {
          running: true,
          provider: 'esp32',
        },
      );
      return;
    }

    ensureFirewallRules();
    this.running = true;
    console.log('[HOTSPOT] ESP32 provider enabled');
    await this.startEsp32RegistrationLoop();
    markWatchdogHeartbeat('hotspot', { running: true, provider: 'esp32' });
    setWatchdogComponentState(
      'hotspot',
      'healthy',
      'ESP32 provider mode active.',
      {
        running: true,
        provider: 'esp32',
      },
    );
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.stopEsp32RegistrationLoop();
    console.log('[HOTSPOT] ESP32 provider stop requested');
    markWatchdogHeartbeat('hotspot', { running: false, provider: 'esp32' });
    setWatchdogComponentState(
      'hotspot',
      'degraded',
      'ESP32 provider stop requested.',
      {
        running: false,
        provider: 'esp32',
      },
    );
  }
}

export const hotspotService = new HotspotService();

export async function startHotspot(): Promise<void> {
  return hotspotService.start();
}
export function stopHotspot(): void {
  hotspotService.stop();
}
export function isHotspotRunning(): boolean {
  return hotspotService.isRunning();
}

export type HotspotConfigPayload = {
  provider: 'esp32';
  ssid: string;
  password: string;
  authType: string;
  captivePortalPath: string;
  startsManagedHotspot: boolean;
};

export function getHotspotConfig(): HotspotConfigPayload {
  return {
    provider: 'esp32',
    ssid: HOTSPOT_SSID,
    password: HOTSPOT_PASSWORD,
    authType: HOTSPOT_AUTH_TYPE,
    captivePortalPath: ESP32_CAPTIVE_PORTAL_PATH,
    startsManagedHotspot: false,
  };
}
