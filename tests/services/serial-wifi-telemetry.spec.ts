import {
  parseSerialTelemetryLine,
  formatWifiCommand,
} from '@/services/serial-ip-protocol';

describe('serial Wi-Fi telemetry & commands', () => {
  describe('parseSerialTelemetryLine - Wi-Fi events', () => {
    it('parses STA_IP event with IP address', () => {
      const event = parseSerialTelemetryLine('STA_IP:192.168.1.150');
      expect(event).toEqual({
        type: 'STA_IP',
        value: '192.168.1.150',
      });
    });

    it('parses WIFI_STA_CONNECTED event', () => {
      const event = parseSerialTelemetryLine('WIFI_STA_CONNECTED');
      expect(event).toEqual({
        type: 'WIFI_STA_CONNECTED',
        value: 'connected',
      });
    });

    it('parses WIFI_STA_DISCONNECTED event', () => {
      const event = parseSerialTelemetryLine('WIFI_STA_DISCONNECTED');
      expect(event).toEqual({
        type: 'WIFI_STA_DISCONNECTED',
        value: 'disconnected',
      });
    });

    it('parses WIFI_STA_CONNECTING event', () => {
      const event = parseSerialTelemetryLine('WIFI_STA_CONNECTING:MyCampusWifi');
      expect(event).toEqual({
        type: 'WIFI_STA_CONNECTING',
        value: 'MyCampusWifi',
      });
    });

    it('parses WIFI_SETUP_READY event', () => {
      const event = parseSerialTelemetryLine('WIFI_SETUP_READY:http://192.168.4.1/setup');
      expect(event).toEqual({
        type: 'WIFI_SETUP_READY',
        value: 'http://192.168.4.1/setup',
      });
    });
  });

  describe('formatWifiCommand', () => {
    it('formats WIFI_STATUS command', () => {
      expect(formatWifiCommand('status')).toBe('WIFI_STATUS\n');
    });

    it('formats WIFI_DISCONNECT command', () => {
      expect(formatWifiCommand('disconnect')).toBe('WIFI_DISCONNECT\n');
    });

    it('formats WIFI_SCAN command', () => {
      expect(formatWifiCommand('scan')).toBe('WIFI_SCAN\n');
    });
  });
});
