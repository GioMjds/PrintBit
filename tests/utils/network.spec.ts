import os from 'node:os';
import {
  getLocalIPv4,
  normalizeRemoteIp,
  isLoopbackRequest,
  findMatchingIpv4ForSubnet,
  getAllLocalIPv4s,
} from '@/utils/network';

describe('network utilities', () => {
  describe('normalizeRemoteIp', () => {
    it('strips IPv4-mapped IPv6 prefix', () => {
      expect(normalizeRemoteIp('::ffff:192.168.4.2')).toBe('192.168.4.2');
      expect(normalizeRemoteIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
    });

    it('leaves standard IPv4 and IPv6 untouched', () => {
      expect(normalizeRemoteIp('192.168.4.2')).toBe('192.168.4.2');
      expect(normalizeRemoteIp('127.0.0.1')).toBe('127.0.0.1');
      expect(normalizeRemoteIp('::1')).toBe('::1');
    });
  });

  describe('isLoopbackRequest', () => {
    it('identifies loopback addresses correctly', () => {
      expect(isLoopbackRequest('127.0.0.1')).toBe(true);
      expect(isLoopbackRequest('::1')).toBe(true);
      expect(isLoopbackRequest('::ffff:127.0.0.1')).toBe(true);
      expect(isLoopbackRequest('localhost')).toBe(true);
      expect(isLoopbackRequest('192.168.4.2')).toBe(false);
      expect(isLoopbackRequest('10.0.0.1')).toBe(false);
    });
  });

  describe('findMatchingIpv4ForSubnet', () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      'Wi-Fi': [
        {
          address: '192.168.4.15',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:55',
          internal: false,
          cidr: '192.168.4.15/24',
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

    it('matches interface on the ESP32 subnet (192.168.4.)', () => {
      const match = findMatchingIpv4ForSubnet('192.168.4.', mockInterfaces);
      expect(match).toBe('192.168.4.15');
    });

    it('matches interface when prefix is provided with gateway IP (192.168.4.1)', () => {
      const match = findMatchingIpv4ForSubnet('192.168.4.1', mockInterfaces);
      expect(match).toBe('192.168.4.15');
    });

    it('matches campus Ethernet interface on 192.168.1. subnet', () => {
      const match = findMatchingIpv4ForSubnet('192.168.1.', mockInterfaces);
      expect(match).toBe('192.168.1.100');
    });

    it('returns null when no interface matches subnet', () => {
      const match = findMatchingIpv4ForSubnet('10.50.0.', mockInterfaces);
      expect(match).toBeNull();
    });

    it('ignores internal loopback interfaces even if prefix matches', () => {
      const match = findMatchingIpv4ForSubnet('127.', mockInterfaces);
      expect(match).toBeNull();
    });
  });

  describe('getAllLocalIPv4s', () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
      'Wi-Fi': [
        {
          address: '192.168.4.15',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:55',
          internal: false,
          cidr: '192.168.4.15/24',
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

    it('enumerates all local non-internal IPv4 adapters', () => {
      const result = getAllLocalIPv4s(mockInterfaces);
      expect(result).toEqual([
        { name: 'Wi-Fi', address: '192.168.4.15', isInternal: false },
        { name: 'Ethernet', address: '192.168.1.100', isInternal: false },
      ]);
    });
  });

  describe('getLocalIPv4 with preferredPrefix', () => {
    const mockInterfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = {
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
      'Wi-Fi': [
        {
          address: '192.168.4.15',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '00:11:22:33:44:55',
          internal: false,
          cidr: '192.168.4.15/24',
        },
      ],
    };

    it('prioritizes preferred prefix when specified', () => {
      const result = getLocalIPv4('192.168.4.', mockInterfaces);
      expect(result).toBe('192.168.4.15');
    });

    it('falls back to other private IPv4 if preferred prefix does not match', () => {
      const result = getLocalIPv4('10.0.0.', mockInterfaces);
      expect(result).toBe('192.168.1.100');
    });
  });
});
