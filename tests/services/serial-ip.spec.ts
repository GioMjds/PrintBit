import {
  parseSerialTelemetryLine,
  formatKioskIpCommand,
  type SerialTelemetryEvent,
} from '@/services/serial-ip-protocol';

describe('serial-ip-protocol', () => {
  describe('formatKioskIpCommand', () => {
    it('formats a valid KIOSK_IP command with ip, port, and path', () => {
      const command = formatKioskIpCommand('192.168.4.15', 3000, '/portal');
      expect(command).toBe('KIOSK_IP 192.168.4.15 3000 /portal\n');
    });

    it('falls back to default port 3000 and path /portal if omitted', () => {
      const command = formatKioskIpCommand('192.168.4.2');
      expect(command).toBe('KIOSK_IP 192.168.4.2 3000 /portal\n');
    });

    it('returns null if the IP address is invalid', () => {
      expect(formatKioskIpCommand('not-an-ip')).toBeNull();
      expect(formatKioskIpCommand('999.999.999.999')).toBeNull();
      expect(formatKioskIpCommand('')).toBeNull();
    });
  });

  describe('parseSerialTelemetryLine', () => {
    it('parses AP_IP telemetry line', () => {
      const event = parseSerialTelemetryLine('AP_IP:192.168.4.1');
      expect(event).toEqual({
        type: 'AP_IP',
        value: '192.168.4.1',
      });
    });

    it('parses STA_IP telemetry line', () => {
      const event = parseSerialTelemetryLine('STA_IP:192.168.1.150');
      expect(event).toEqual({
        type: 'STA_IP',
        value: '192.168.1.150',
      });
    });

    it('parses KIOSK_IP telemetry line', () => {
      const event = parseSerialTelemetryLine('KIOSK_IP:192.168.4.15');
      expect(event).toEqual({
        type: 'KIOSK_IP',
        value: '192.168.4.15',
      });
    });

    it('parses coin_target URL telemetry line', () => {
      const event = parseSerialTelemetryLine('coin_target:http://192.168.4.15:3000/coin');
      expect(event).toEqual({
        type: 'COIN_TARGET',
        value: 'http://192.168.4.15:3000/coin',
      });
    });

    it('parses portal_target URL telemetry line', () => {
      const event = parseSerialTelemetryLine('portal_target:http://192.168.4.15:3000/portal');
      expect(event).toEqual({
        type: 'PORTAL_TARGET',
        value: 'http://192.168.4.15:3000/portal',
      });
    });

    it('returns null for unrelated serial lines', () => {
      expect(parseSerialTelemetryLine('SYSTEM READY')).toBeNull();
      expect(parseSerialTelemetryLine('HOPPER ACK req-123')).toBeNull();
      expect(parseSerialTelemetryLine('10')).toBeNull();
      expect(parseSerialTelemetryLine('')).toBeNull();
    });
  });
});
