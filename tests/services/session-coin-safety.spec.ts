import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';
import { CoinBridgeService, coinBridgeService } from '../../src/services/coin-bridge';

describe('Coin Gating & Auto Change Dispensing', () => {
  let service: WirelessSessionService;
  let mockHopperService: any;

  beforeEach(() => {
    mockHopperService = {
      dispenseChange: jest.fn().mockResolvedValue({ success: true, dispensedCoins: 5 }),
    };
    service = new WirelessSessionService({
      io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } as any,
      sessionStore: {} as any,
      hopperService: mockHopperService,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
    });
    coinBridgeService.setWirelessSessionService(service);
  });

  afterEach(() => {
    service.cleanup?.();
    coinBridgeService.setWirelessSessionService(null);
    coinBridgeService.clearProcessedEventIds();
  });

  it('rejects coin credit when kiosk is IDLE', () => {
    const result = service.handleIncomingCoin(5, 'evt_1001');
    expect(result.accepted).toBe(false);
    expect(result.newBalance).toBe(0);
  });

  it('accepts and credits coin deposit when kiosk is ACTIVE', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }
    const result = service.handleIncomingCoin(5, 'evt_1002');
    expect(result.accepted).toBe(true);
    expect(result.newBalance).toBe(5);
  });

  it('prevents duplicate deposits with identical coin event IDs', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }
    service.handleIncomingCoin(5, 'evt_1003');
    const dupResult = service.handleIncomingCoin(5, 'evt_1003');
    expect(dupResult.accepted).toBe(false);
    expect(dupResult.newBalance).toBe(5);
  });

  it('automatically triggers hopper change dispensing on teardownSessionAndRefund', async () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }
    service.handleIncomingCoin(10, 'evt_1004');
    service.recordExpense(3);

    const teardown = await service.teardownSessionAndRefund();
    expect(teardown.success).toBe(true);
    expect(teardown.refunded).toBe(7);
    expect(mockHopperService.dispenseChange).toHaveBeenCalledWith(7);
    expect(service.getKioskState()).toBe('IDLE');
  });

  it('rejects coin credit when kiosk is in PAIRING state', () => {
    service.requestPairing('192.168.4.5');
    expect(service.getKioskState()).toBe('PAIRING');

    const result = service.handleIncomingCoin(5, 'evt_pairing');
    expect(result.accepted).toBe(false);
    expect(result.newBalance).toBe(0);
  });

  it('does not trigger hopper dispense if balance is 0 on teardown', async () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }

    const teardown = await service.teardownSessionAndRefund();
    expect(teardown.success).toBe(true);
    expect(teardown.refunded).toBe(0);
    expect(mockHopperService.dispenseChange).not.toHaveBeenCalled();
    expect(service.getKioskState()).toBe('IDLE');
  });

  it('handles mismatching sessionId during teardownSessionAndRefund', async () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }
    service.handleIncomingCoin(5, 'evt_mismatch');

    const teardown = await service.teardownSessionAndRefund('wrong_session_id');
    expect(teardown.success).toBe(false);
    expect(teardown.refunded).toBe(0);
    expect(service.getKioskState()).toBe('ACTIVE');
  });

  it('routes coin pulses through CoinBridgeService to WirelessSessionService', () => {
    const bridge = new CoinBridgeService();
    bridge.setWirelessSessionService(service);

    // Kiosk is IDLE
    const idleResult = bridge.handleIncomingCoin(5, 'evt_bridge_idle');
    expect(idleResult.accepted).toBe(false);
    expect(idleResult.reason).toBe('SESSION_NOT_ACTIVE');

    // Activate kiosk session
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }

    const activeResult = bridge.handleIncomingCoin(10, 'evt_bridge_active');
    expect(activeResult.accepted).toBe(true);
    expect(activeResult.newBalance).toBe(10);

    // Duplicate event via bridge
    const dupResult = bridge.handleIncomingCoin(10, 'evt_bridge_active');
    expect(dupResult.accepted).toBe(false);
    expect(dupResult.newBalance).toBe(10);
  });
});
