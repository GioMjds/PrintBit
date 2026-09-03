import {
  buildWifiQrPayload,
  escapeWifiQrValue,
  resolveWifiTroubleshootingDetails,
} from '../../src/public/shared/wifi-troubleshooting';

describe('wifi-troubleshooting helper', () => {
  describe('escapeWifiQrValue', () => {
    it('escapes special characters used in MeCard/ZXing format', () => {
      expect(escapeWifiQrValue('My;Network:Name"With\\Special,Chars')).toBe(
        'My\\;Network\\:Name\\"With\\\\Special\\,Chars',
      );
    });

    it('leaves clean strings unchanged', () => {
      expect(escapeWifiQrValue('PrintBit_5G')).toBe('PrintBit_5G');
    });
  });

  describe('buildWifiQrPayload', () => {
    it('generates WPA payload for standard password-protected network', () => {
      const payload = buildWifiQrPayload('PrintBit', 'secret123');
      expect(payload).toBe('WIFI:T:WPA;S:PrintBit;P:secret123;;');
    });

    it('generates nopass payload when password is empty', () => {
      const payload = buildWifiQrPayload('PrintBit_Guest', '');
      expect(payload).toBe('WIFI:T:nopass;S:PrintBit_Guest;;');
    });

    it('generates nopass payload when authType is nopass or open', () => {
      expect(buildWifiQrPayload('PrintBit', 'ignored', 'nopass')).toBe(
        'WIFI:T:nopass;S:PrintBit;;',
      );
      expect(buildWifiQrPayload('PrintBit', 'ignored', 'open')).toBe(
        'WIFI:T:nopass;S:PrintBit;;',
      );
    });
  });

  describe('resolveWifiTroubleshootingDetails', () => {
    it('provides defaults when config is null or empty', () => {
      const details = resolveWifiTroubleshootingDetails(null);
      expect(details.ssid).toBe('PrintBit');
      expect(details.password).toBe('');
      expect(details.isPasswordRequired).toBe(false);
      expect(details.qrPayload).toBe('WIFI:T:nopass;S:PrintBit;;');
    });

    it('resolves configured secured hotspot', () => {
      const details = resolveWifiTroubleshootingDetails({
        ssid: 'PrintBit-Kiosk-1',
        password: 'pass@word123',
        authType: 'WPA2',
      });
      expect(details.ssid).toBe('PrintBit-Kiosk-1');
      expect(details.password).toBe('pass@word123');
      expect(details.isPasswordRequired).toBe(true);
      expect(details.qrPayload).toBe(
        'WIFI:T:WPA;S:PrintBit-Kiosk-1;P:pass@word123;;',
      );
    });
  });
});
