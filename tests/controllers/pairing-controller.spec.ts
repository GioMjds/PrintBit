import request from 'supertest';
import express from 'express';
import { WirelessSessionController } from '../../src/modules/wireless-session/wireless-session.controller';
import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';

describe('WirelessSessionController Pairing Routes', () => {
  let app: express.Express;
  let service: WirelessSessionService;
  let controller: WirelessSessionController;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    service = new WirelessSessionService({
      io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } as any,
      sessionStore: {} as any,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
    });
    controller = new WirelessSessionController(service);
    app.use('/api', controller.router);
  });

  afterEach(() => {
    service.cleanup?.();
  });

  it('GET /api/pairing/request generates PIN and pairingId', async () => {
    const res = await request(app).get('/api/pairing/request');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pin).toMatch(/^\d{6}$/);
    expect(res.body.pairingId).toBeDefined();
    expect(res.body.expiresIn).toBe(120);
  });

  it('GET /api/pairing/request returns 409 when kiosk is in ACTIVE state', async () => {
    const reqRes = await request(app).get('/api/pairing/request');
    await request(app).post('/api/pairing/verify').send({ pin: reqRes.body.pin });

    const busyRes = await request(app).get('/api/pairing/request');
    expect(busyRes.status).toBe(409);
    expect(busyRes.body.success).toBe(false);
    expect(busyRes.body.error).toBe('KIOSK_BUSY');
  });

  it('POST /api/pairing/verify validates PIN', async () => {
    const reqRes = await request(app).get('/api/pairing/request');
    const pin = reqRes.body.pin;

    const verifyRes = await request(app)
      .post('/api/pairing/verify')
      .send({ pin });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.sessionId).toBeDefined();
    expect(verifyRes.body.sessionToken).toBeDefined();
  });

  it('POST /api/pairing/verify returns 400 for invalid PIN', async () => {
    await request(app).get('/api/pairing/request');

    const verifyRes = await request(app)
      .post('/api/pairing/verify')
      .send({ pin: '000000' });

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.success).toBe(false);
    expect(verifyRes.body.error).toBe('INVALID_PIN');
  });

  it('POST /api/pairing/verify returns 400 when pin is missing', async () => {
    const verifyRes = await request(app)
      .post('/api/pairing/verify')
      .send({});

    expect(verifyRes.status).toBe(400);
    expect(verifyRes.body.success).toBe(false);
    expect(verifyRes.body.error).toBe('INVALID_PIN');
  });

  it('GET /api/pairing/status/:pairingId checks status', async () => {
    const reqRes = await request(app).get('/api/pairing/request');
    const pairingId = reqRes.body.pairingId;

    const statusRes = await request(app).get(`/api/pairing/status/${pairingId}`);
    expect(statusRes.status).toBe(200);
    expect(statusRes.body.status).toBe('PENDING');

    // Verify PIN and check status becomes ACTIVE
    await request(app).post('/api/pairing/verify').send({ pin: reqRes.body.pin });

    const activeStatusRes = await request(app).get(`/api/pairing/status/${pairingId}`);
    expect(activeStatusRes.status).toBe(200);
    expect(activeStatusRes.body.status).toBe('ACTIVE');
    expect(activeStatusRes.body.sessionToken).toBeDefined();
    expect(activeStatusRes.body.portalUrl).toContain('/portal?token=');
  });

  it('POST /api/session/mode updates session mode with valid token', async () => {
    const reqRes = await request(app).get('/api/pairing/request');
    const verifyRes = await request(app)
      .post('/api/pairing/verify')
      .send({ pin: reqRes.body.pin });

    const token = verifyRes.body.sessionToken;

    const modeRes = await request(app)
      .post('/api/session/mode')
      .set('x-session-token', token)
      .send({ mode: 'PRINT' });

    expect(modeRes.status).toBe(200);
    expect(modeRes.body.success).toBe(true);
    expect(modeRes.body.mode).toBe('PRINT');
  });

  it('POST /api/session/mode rejects with 401 without valid session token', async () => {
    const modeRes = await request(app)
      .post('/api/session/mode')
      .send({ mode: 'PRINT' });

    expect(modeRes.status).toBe(401);
    expect(modeRes.body.success).toBe(false);
  });

  it('POST /api/session/mode rejects with 400 for invalid mode', async () => {
    const reqRes = await request(app).get('/api/pairing/request');
    const verifyRes = await request(app)
      .post('/api/pairing/verify')
      .send({ pin: reqRes.body.pin });

    const token = verifyRes.body.sessionToken;

    const modeRes = await request(app)
      .post('/api/session/mode')
      .set('x-session-token', token)
      .send({ mode: 'INVALID_MODE' });

    expect(modeRes.status).toBe(400);
    expect(modeRes.body.success).toBe(false);
  });

  it('POST /api/session/end ends active session', async () => {
    const reqRes = await request(app).get('/api/pairing/request');
    await request(app).post('/api/pairing/verify').send({ pin: reqRes.body.pin });

    const endRes = await request(app).post('/api/session/end');
    expect(endRes.status).toBe(200);
    expect(endRes.body.success).toBe(true);
    expect(service.getKioskState()).toBe('IDLE');
  });
});
