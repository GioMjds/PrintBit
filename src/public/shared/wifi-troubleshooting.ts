export type HotspotConfig = {
  provider?: 'esp32';
  ssid?: string;
  password?: string;
  authType?: string;
  captivePortalPath?: string;
  startsManagedHotspot?: boolean;
};

export type WifiTroubleshootingDetails = {
  ssid: string;
  password: string;
  authType: string;
  isPasswordRequired: boolean;
  qrPayload: string;
};

/**
 * Escapes characters per the MeCard / ZXing Wi-Fi QR code spec.
 */
export function escapeWifiQrValue(value: string): string {
  return value.replace(/([\\;,:"])/g, '\\$1');
}

/**
 * Builds the standard WIFI: QR code string format.
 * Format: WIFI:T:<WPA|WEP|nopass>;S:<ssid>;P:<password>;;
 */
export function buildWifiQrPayload(
  ssid: string,
  password: string,
  authType?: string,
): string {
  const safeSsid = escapeWifiQrValue(ssid);
  const safePassword = escapeWifiQrValue(password);
  const normalizedAuth = authType?.trim().toLowerCase() ?? '';
  const isOpenNetwork =
    normalizedAuth === 'nopass' ||
    normalizedAuth === 'open' ||
    normalizedAuth === 'none' ||
    safePassword.length === 0;

  if (isOpenNetwork) {
    return `WIFI:T:nopass;S:${safeSsid};;`;
  }
  return `WIFI:T:WPA;S:${safeSsid};P:${safePassword};;`;
}

/**
 * Resolves safe Wi-Fi details and scannable QR payload for UI presentation.
 */
export function resolveWifiTroubleshootingDetails(
  config?: HotspotConfig | null,
): WifiTroubleshootingDetails {
  const configuredSsid = config?.ssid?.trim() ?? '';
  const ssid = configuredSsid.length > 0 ? configuredSsid : 'PrintBit';
  const configuredPassword = config?.password?.trim() ?? '';
  const authType = config?.authType?.trim() ?? '';
  const normalizedAuth = authType.toLowerCase();
  const isPasswordRequired =
    configuredPassword.length > 0 &&
    normalizedAuth !== 'nopass' &&
    normalizedAuth !== 'open' &&
    normalizedAuth !== 'none';

  return {
    ssid,
    password: configuredPassword,
    authType,
    isPasswordRequired,
    qrPayload: buildWifiQrPayload(ssid, configuredPassword, authType),
  };
}
