import fs from 'node:fs';
import path from 'node:path';

const firmwarePath = path.resolve(process.cwd(), 'esp32-captive-portal.ino');

describe('ESP32 Wi-Fi provisioning contract', () => {
  const firmware = fs.readFileSync(firmwarePath, 'utf8');

  test('requires WiFiManager provisioning before normal hardware operation', () => {
    expect(firmware).toContain('#include <WiFiManager.h>');
    expect(firmware).toContain('PrintBit-Setup');
    expect(firmware).toContain('setBreakAfterConfig(true)');
    expect(firmware).toContain('provisioningComplete');
  });

  test('does not ship a reusable AP password', () => {
    expect(firmware).not.toContain('printbit123');
    expect(firmware).not.toMatch(/String\s+apPass\s*=\s*"[^"]+"/);
  });

  test('keeps the permanent PrintBit AP fixed at 192.168.4.1', () => {
    expect(firmware).toContain('IPAddress printBitApIp(192, 168, 4, 1)');
    expect(firmware).toContain(
      'WiFi.softAPConfig(printBitApIp, printBitApIp, printBitSubnet)',
    );
  });

  test('redirects every otherwise-unhandled GET request to the registered kiosk portal', () => {
    expect(firmware).toContain(
      'if (method == "GET") {\n    replyRedirect(client, kioskPortalUrl);',
    );
  });

  test('provides an explicit factory-reset command', () => {
    expect(firmware).toContain('WIFI_FACTORY_RESET');
    expect(firmware).toContain('wifiManager.resetSettings()');
    expect(firmware).toContain('preferences.clear()');
  });
});
