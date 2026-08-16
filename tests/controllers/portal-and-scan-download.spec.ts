import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import express from 'express';
import { PageController } from '../../src/modules/page/page.controller';
import { ScannerController } from '../../src/modules/scanner/scanner.controller';
import { ScannerService } from '../../src/modules/scanner/scanner.service';
import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';
import { coinBridgeService } from '../../src/services/coin-bridge';

describe('Portal and Scan Download Flows (Task 5)', () => {
  let app: express.Express;
  let wirelessService: WirelessSessionService;
  let scannerService: ScannerService;
  let scannerController: ScannerController;
  let pageController: PageController;
  let sessionStoreMock: any;
  let testScanFile: string;

  beforeAll(() => {
    const scansDir = path.resolve('uploads', 'scans');
    fs.mkdirSync(scansDir, { recursive: true });
    testScanFile = path.join(scansDir, 'test_scan_artifact.pdf');
    fs.writeFileSync(testScanFile, '%PDF-1.4 test scan content');
  });

  afterAll(() => {
    if (fs.existsSync(testScanFile)) {
      try {
        fs.unlinkSync(testScanFile);
      } catch {
        // ignore
      }
    }
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());

    sessionStoreMock = {
      getActiveSessionToken: jest.fn().mockReturnValue(null),
      isTokenValid: jest.fn().mockReturnValue(true),
      createSession: jest.fn(),
      cancelSession: jest.fn(),
    };

    wirelessService = new WirelessSessionService({
      io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } as any,
      sessionStore: sessionStoreMock,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
    });

    coinBridgeService.setWirelessSessionService(wirelessService);

    scannerService = new ScannerService();
    scannerService.setLatestScan('test_scan_artifact.pdf');

    scannerController = new ScannerController(scannerService, {
      io: { emit: jest.fn() } as any,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      wirelessSessionService: wirelessService,
    });

    pageController = new PageController({
      sessionStore: sessionStoreMock,
      publicPageRoutes: [],
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
    });

    app.use(scannerController.router);
    app.use(pageController.router);
  });

  afterEach(() => {
    wirelessService.cleanup?.();
  });

  describe('Portal routing (/portal)', () => {
    it('GET /portal?token=xyz redirects to /upload/xyz', async () => {
      const res = await request(app).get('/portal?token=test_token_123');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/upload/test_token_123');
    });

    it('GET /portal/:token redirects to /upload/:token', async () => {
      const res = await request(app).get('/portal/direct_path_token_456');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/upload/direct_path_token_456');
    });

    it('GET /portal with active session token redirects to /upload/:token', async () => {
      sessionStoreMock.getActiveSessionToken.mockReturnValue('active_sess_tok');
      const res = await request(app).get('/portal');
      expect(res.status).toBe(302);
      expect(res.header.location).toBe('/upload/active_sess_tok');
    });

    it('GET /portal without active session displays waiting page', async () => {
      sessionStoreMock.getActiveSessionToken.mockReturnValue(null);
      const res = await request(app).get('/portal');
      expect(res.status).toBe(200);
      expect(res.text).toContain('PrintBit upload portal');
      expect(res.text).toContain('No active print upload session');
    });
  });

  describe('Scan download (/session/download)', () => {
    it('GET /session/download rejects with 401 when no token is provided', async () => {
      const res = await request(app).get('/session/download');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED_SESSION');
    });

    it('GET /session/download rejects with 401 for invalid session token', async () => {
      const res = await request(app).get('/session/download?token=invalid_tok_999');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('UNAUTHORIZED_SESSION');
    });

    it('GET /session/download streams scan file when valid token is provided in query', async () => {
      // Create and pair active session
      const reqRes = wirelessService.requestPairing('192.168.4.5');
      expect('pin' in reqRes).toBe(true);
      if ('pin' in reqRes) {
        const verifyRes = wirelessService.verifyPairingPin(reqRes.pin);
        expect(verifyRes.success).toBe(true);
        const token = verifyRes.sessionToken!;

        const res = await request(app)
          .get(`/session/download?token=${token}&filename=test_scan_artifact.pdf`)
          .buffer(true);
        expect(res.status).toBe(200);
        expect(res.header['content-disposition']).toMatch(/^attachment; filename="PrintBit_Scan_\d+\.pdf"$/);
        expect(res.header['content-type']).toBe('application/pdf');
        expect(res.body.toString()).toBe('%PDF-1.4 test scan content');
      }
    });

    it('GET /session/download streams scan file when valid token is provided in x-session-token header', async () => {
      const reqRes = wirelessService.requestPairing('192.168.4.5');
      if ('pin' in reqRes) {
        const verifyRes = wirelessService.verifyPairingPin(reqRes.pin);
        const token = verifyRes.sessionToken!;

        const res = await request(app)
          .get('/session/download')
          .set('x-session-token', token);

        expect(res.status).toBe(200);
        expect(res.header['content-disposition']).toMatch(/^attachment; filename="PrintBit_Scan_\d+\.pdf"$/);
      }
    });

    it('GET /api/session/download route alias works as expected', async () => {
      const reqRes = wirelessService.requestPairing('192.168.4.5');
      if ('pin' in reqRes) {
        const verifyRes = wirelessService.verifyPairingPin(reqRes.pin);
        const token = verifyRes.sessionToken!;

        const res = await request(app)
          .get('/api/session/download')
          .set('x-session-token', token);

        expect(res.status).toBe(200);
        expect(res.header['content-disposition']).toMatch(/^attachment; filename="PrintBit_Scan_\d+\.pdf"$/);
      }
    });

    it('GET /session/download returns 404 if file does not exist on disk', async () => {
      const reqRes = wirelessService.requestPairing('192.168.4.5');
      if ('pin' in reqRes) {
        const verifyRes = wirelessService.verifyPairingPin(reqRes.pin);
        const token = verifyRes.sessionToken!;

        const res = await request(app)
          .get('/session/download?token=' + token + '&filename=non_existent_file.pdf');

        expect(res.status).toBe(404);
        expect(res.body.error).toBe('No scan document available for download');
      }
    });
  });
});
