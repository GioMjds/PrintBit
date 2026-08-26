import os from 'node:os';
import { detectEsp32KioskIp } from '@/services/hotspot';

describe('hotspot IP discovery', () => {
  it('detects IP matching ESP32 AP subnet (192.168.4.x)', () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      'Wi-Fi': [
        {
          address: '192.168.4.55',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:55',
          internal: false,
          cidr: '192.168.4.55/24',
        },
      ],
      Ethernet: [
        {
          address: '192.168.1.100',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:66',
          internal: false,
          cidr: '192.168.1.100/24',
        },
      ],
    };

    const resolved = detectEsp32KioskIp(mockInterfaces);
    expect(resolved).toBe('192.168.4.55');
  });

  it('falls back to private IPv4 when no interface is on the 192.168.4.x subnet', () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      Ethernet: [
        {
          address: '192.168.1.120',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:66',
          internal: false,
          cidr: '192.168.1.120/24',
        },
      ],
    };

    const resolved = detectEsp32KioskIp(mockInterfaces);
    expect(resolved).toBe('192.168.1.120');
  });

  it('returns null if only loopback interfaces exist', () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      Loopback: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8',
        },
      ],
    };

    const resolved = detectEsp32KioskIp(mockInterfaces);
    expect(resolved).toBeNull();
  });
});
