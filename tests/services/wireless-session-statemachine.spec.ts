import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';
import type { Server } from 'socket.io';

describe('WirelessSessionService State Machine & Pairing', () => {
  let service: WirelessSessionService;
  let mockIo: Partial<Server>;
  let mockHopperService: { dispenseChange: jest.Mock };

  beforeEach(() => {
    mockIo = {
      emit: jest.fn(),
      to: jest.fn().mockReturnThis() as any,
    };
    mockHopperService = {
      dispenseChange: jest.fn().mockResolvedValue({ success: true, count: 2 }),
    };
    service = new WirelessSessionService({
      io: mockIo as Server,
      sessionStore: {} as any,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
      hopperService: mockHopperService,
    });
  });

  afterEach(() => {
    service.cleanup?.();
  });

  it('should start in IDLE state', () => {
    expect(service.getKioskState()).toBe('IDLE');
  });

  it('should generate a 6-digit PIN on pairing request and transition to PAIRING', () => {
    const result = service.requestPairing('192.168.4.5');
    expect('pin' in result).toBe(true);
    if ('pin' in result) {
      expect(result.pin).toMatch(/^\d{6}$/);
      expect(result.expiresIn).toBe(120);
      expect(service.getKioskState()).toBe('PAIRING');
    }
    expect(mockIo.emit).toHaveBeenCalledWith('session:state_changed', { state: 'PAIRING' });
    expect(mockIo.emit).toHaveBeenCalledWith('kiosk:state_changed', { state: 'PAIRING' });
  });

  it('should reject pairing request when already in ACTIVE state', () => {
    const req1 = service.requestPairing('192.168.4.5');
    if ('pin' in req1) {
      service.verifyPairingPin(req1.pin);
    }
    expect(service.getKioskState()).toBe('ACTIVE');

    const req2 = service.requestPairing('192.168.4.6');
    expect(req2).toEqual({ error: 'KIOSK_BUSY' });
  });

  it('should verify correct PIN and transition to ACTIVE state with signed token', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      const verify = service.verifyPairingPin(req.pin);
      expect(verify.success).toBe(true);
      expect(verify.sessionToken).toBeDefined();
      expect(verify.sessionId).toBeDefined();
      expect(verify.sessionToken!.length).toBe(64); // 32 bytes hex
      expect(service.getKioskState()).toBe('ACTIVE');
      expect(service.validateSessionToken(verify.sessionToken!)).toBe(true);
    }
  });

  it('should reject invalid PIN and stay in current state', () => {
    service.requestPairing('192.168.4.5');
    const verify = service.verifyPairingPin('000000');
    expect(verify.success).toBe(false);
    expect(verify.error).toBe('INVALID_PIN');
    expect(service.getKioskState()).toBe('PAIRING');
  });

  it('should return pairing status with portalUrl when active', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
      const status = service.getPairingStatus(req.pairingId);
      expect(status.status).toBe('ACTIVE');
      expect(status.portalUrl).toContain('/portal?token=');
    }
  });

  it('should validate session token correctly', () => {
    expect(service.validateSessionToken('')).toBe(false);
    expect(service.validateSessionToken('fake_token')).toBe(false);

    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      const verify = service.verifyPairingPin(req.pin);
      expect(service.validateSessionToken(verify.sessionToken!)).toBe(true);
      expect(service.validateSessionToken('other_token')).toBe(false);
    }
  });

  it('should end active session, dispense change, and return to IDLE', async () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      const verify = service.verifyPairingPin(req.pin);
      expect(verify.success).toBe(true);
    }

    // Deposit coins
    expect(service.handleCoinDeposit(10, 'evt-1')).toBe(true);
    expect(service.getActiveSessionBalance()).toBe(10);

    // Record expense
    service.recordExpense(4);
    expect(service.getActiveSessionBalance()).toBe(6);

    const endResult = await service.endActiveSession('user_completed');
    expect(endResult.success).toBe(true);
    expect(endResult.dispensedChange).toBe(6);
    expect(mockHopperService.dispenseChange).toHaveBeenCalledWith(6);
    expect(service.getKioskState()).toBe('IDLE');
    expect(mockIo.emit).toHaveBeenCalledWith('session:ended', { dispensedChange: 6, reason: 'user_completed' });
    expect(mockIo.emit).toHaveBeenCalledWith('balance', 0);
  });

  it('should reject coin deposits when kiosk is not in ACTIVE state', () => {
    expect(service.getKioskState()).toBe('IDLE');
    const deposited = service.handleCoinDeposit(5, 'evt-idle');
    expect(deposited).toBe(false);
    expect(service.getActiveSessionBalance()).toBe(0);
  });
});
