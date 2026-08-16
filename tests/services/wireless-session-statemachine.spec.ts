import { WirelessSessionService } from '@/modules/wireless-session/wireless-session.service';
import { SessionState } from '@/modules/wireless-session/wireless-session.types';

describe('WirelessSessionService State Machine & Pairing', () => {
  let service: WirelessSessionService;
  let mockIo: any;
  let mockSessionStore: any;

  beforeEach(() => {
    mockIo = { emit: jest.fn(), to: jest.fn().mockReturnThis() };
    mockSessionStore = {
      createSession: jest.fn().mockResolvedValue({ id: 'sess_123' }),
      destroySession: jest.fn().mockResolvedValue(true),
      getSessionState: jest.fn().mockReturnValue('active'),
      tryGetSession: jest.fn().mockReturnValue({ id: 'sess_123', token: 'tok_123' }),
    };
    service = new WirelessSessionService({
      io: mockIo,
      sessionStore: mockSessionStore,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
    });
  });

  afterEach(() => {
    service.cleanup();
  });

  test('should start in IDLE state', () => {
    expect(service.getState()).toBe(SessionState.IDLE);
  });

  test('should generate a 6-digit PIN on pairing request and transition to PAIRING', () => {
    const res = service.createPairingRequest('192.168.4.5');
    expect(res.success).toBe(true);
    expect(res.pin).toMatch(/^\d{6}$/);
    expect(res.pairingId).toBeDefined();
    expect(res.expiresIn).toBe(120);
    expect(service.getState()).toBe(SessionState.PAIRING);
  });

  test('should reject pairing request when already in ACTIVE state', () => {
    service.forceStateForTesting(SessionState.ACTIVE);
    const res = service.createPairingRequest('192.168.4.6');
    expect(res.success).toBe(false);
    expect(res.code).toBe('KIOSK_BUSY');
  });

  test('should verify correct PIN and transition to ACTIVE state with signed token', () => {
    const pairRes = service.createPairingRequest('192.168.4.5');
    expect(pairRes.pin).toBeDefined();
    const verifyRes = service.verifyPairingPin(pairRes.pin!);
    expect(verifyRes.success).toBe(true);
    expect(verifyRes.sessionToken).toBeDefined();
    expect(service.getState()).toBe(SessionState.ACTIVE);
    expect(service.validateSessionToken(verifyRes.sessionToken!)).toBe(true);
  });

  test('should reject invalid PIN and stay in current state', () => {
    service.createPairingRequest('192.168.4.5');
    const verifyRes = service.verifyPairingPin('000000');
    expect(verifyRes.success).toBe(false);
    expect(verifyRes.code).toBe('INVALID_PIN');
    expect(service.getState()).toBe(SessionState.PAIRING);
  });

  test('should return pairing status with portalUrl when active', () => {
    const pairRes = service.createPairingRequest('192.168.4.5');
    const statusBefore = service.getPairingStatus(pairRes.pairingId!);
    expect(statusBefore.status).toBe(SessionState.PAIRING);

    service.verifyPairingPin(pairRes.pin!);
    const statusAfter = service.getPairingStatus(pairRes.pairingId!);
    expect(statusAfter.status).toBe(SessionState.ACTIVE);
    expect(statusAfter.sessionToken).toBeDefined();
    expect(statusAfter.portalUrl).toContain('/portal?token=');
  });
});
