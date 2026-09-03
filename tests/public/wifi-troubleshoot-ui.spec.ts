import fs from 'node:fs';
import path from 'node:path';

describe('Wi-Fi QR Troubleshooting UI Integration', () => {
  const printHtmlPath = path.resolve(
    __dirname,
    '../../src/public/print/index.html',
  );
  const confirmHtmlPath = path.resolve(
    __dirname,
    '../../src/public/confirm/index.html',
  );
  const printCssPath = path.resolve(
    __dirname,
    '../../src/public/print/styles.css',
  );
  const confirmCssPath = path.resolve(
    __dirname,
    '../../src/public/confirm/styles.css',
  );

  let printHtml: string;
  let confirmHtml: string;
  let printCss: string;
  let confirmCss: string;

  beforeAll(() => {
    printHtml = fs.readFileSync(printHtmlPath, 'utf-8');
    confirmHtml = fs.readFileSync(confirmHtmlPath, 'utf-8');
    printCss = fs.readFileSync(printCssPath, 'utf-8');
    confirmCss = fs.readFileSync(confirmCssPath, 'utf-8');
  });

  describe('Print page (src/public/print)', () => {
    it('contains the troubleshooting button for the upload QR code', () => {
      expect(printHtml).toContain('id="showWifiModalBtn"');
      expect(printHtml).toContain('class="wifi-troubleshoot-fab"');
      expect(printHtml).toContain('aria-haspopup="dialog"');
      expect(printHtml).toContain('aria-controls="startupOnboardingOverlay"');
      expect(printHtml).toMatch(/QR code not opening\? Check Wi-Fi/i);
    });

    it('contains the Wi-Fi troubleshooting modal with canvas and credentials fields', () => {
      expect(printHtml).toContain('id="startupOnboardingOverlay"');
      expect(printHtml).toContain('id="startupWifiQrCanvas"');
      expect(printHtml).toContain('id="wifiSsidVal"');
      expect(printHtml).toContain('id="wifiPasswordVal"');
      expect(printHtml).toContain('id="startupContinueBtn"');
      expect(printHtml).toContain('QR Code Not Opening?');
    });

    it('contains 3-step self-troubleshooting instructions in modal', () => {
      expect(printHtml).toContain('Connect to kiosk Wi-Fi');
      expect(printHtml).toContain('Stay connected');
      expect(printHtml).toContain('Re-scan upload QR');
    });

    it('has styles for button and modal overlay', () => {
      expect(printCss).toContain('.wifi-troubleshoot-fab');
      expect(printCss).toContain('.wifi-modal-overlay');
      expect(printCss).toContain('.wifi-modal-card');
      expect(printCss).toContain('.wifi-credentials-card');
    });
  });

  describe('Confirm page (src/public/confirm)', () => {
    it('contains the troubleshooting button in the success/thank-you modal', () => {
      expect(confirmHtml).toContain('id="confirmWifiHelpBtn"');
      expect(confirmHtml).toContain('aria-haspopup="dialog"');
      expect(confirmHtml).toContain('aria-controls="confirmWifiModalOverlay"');
      expect(confirmHtml).toMatch(/QR code not opening on phone\? Check Wi-Fi/i);
    });

    it('contains the troubleshooting button in the maintenance resolution screen', () => {
      expect(confirmHtml).toContain('id="maintenanceWifiHelpBtn"');
      expect(confirmHtml).toContain('aria-haspopup="dialog"');
      expect(confirmHtml).toContain('aria-controls="confirmWifiModalOverlay"');
      expect(confirmHtml).toMatch(/QR code not opening\? Check Wi-Fi/i);
    });

    it('contains the Wi-Fi troubleshooting modal overlay and controls', () => {
      expect(confirmHtml).toContain('id="confirmWifiModalOverlay"');
      expect(confirmHtml).toContain('id="confirmWifiQrCanvas"');
      expect(confirmHtml).toContain('id="confirmWifiSsidVal"');
      expect(confirmHtml).toContain('id="confirmWifiPasswordVal"');
      expect(confirmHtml).toContain('id="confirmWifiModalCloseBtn"');
      expect(confirmHtml).toContain('QR Code Not Opening?');
    });

    it('contains 3-step self-troubleshooting instructions in confirm modal', () => {
      expect(confirmHtml).toContain('Connect to kiosk Wi-Fi');
      expect(confirmHtml).toContain('Stay connected');
      expect(confirmHtml).toContain('Re-scan QR code');
    });

    it('has styles for button and modal overlay with elevated z-index for confirm page', () => {
      expect(confirmCss).toContain('.qr-troubleshoot-btn');
      expect(confirmCss).toContain('.wifi-modal-overlay');
      expect(confirmCss).toContain('z-index: 250');
      expect(confirmCss).toContain('.wifi-credentials-card');
    });
  });
});
