import fs from 'node:fs';
import path from 'node:path';

describe('Homepage FAB modal and idle screen hiding', () => {
  const globalsCssPath = path.resolve(__dirname, '../../src/public/globals.css');
  const appTsPath = path.resolve(__dirname, '../../src/public/app.ts');
  const idleScreenTsPath = path.resolve(__dirname, '../../src/public/shared/idle-screen.ts');
  const idleTimeoutTsPath = path.resolve(__dirname, '../../src/services/idle-timeout.ts');

  let globalsCss: string;
  let appTs: string;
  let idleScreenTs: string;
  let idleTimeoutTs: string;

  beforeAll(() => {
    globalsCss = fs.readFileSync(globalsCssPath, 'utf-8');
    appTs = fs.readFileSync(appTsPath, 'utf-8');
    idleScreenTs = fs.readFileSync(idleScreenTsPath, 'utf-8');
    idleTimeoutTs = fs.readFileSync(idleTimeoutTsPath, 'utf-8');
  });

  describe('CSS styling and layer order in globals.css', () => {
    it('sets FAB z-index to 90 so modals and overlays naturally sit above them', () => {
      expect(globalsCss).toMatch(/\.kiosk-fab\s*\{[^}]*z-index:\s*90;/);
      expect(globalsCss).toMatch(/\.printbit-language-fab\s*\{[^}]*z-index:\s*90;/);
    });

    it('defines smooth bidirectional opacity, visibility, and transform transitions for FABs', () => {
      expect(globalsCss).toContain('opacity 240ms ease');
      expect(globalsCss).toContain('visibility 240ms ease');
      expect(globalsCss).toContain('cubic-bezier(0.16, 1, 0.3, 1)');
    });

    it('hides all FABs when any modal or overlay is open', () => {
      expect(globalsCss).toContain('body:has(.pricing-overlay.is-open) :is(.kiosk-fab, .printbit-language-fab)');
      expect(globalsCss).toContain('body:has(.guide-overlay.is-visible) :is(.kiosk-fab, .printbit-language-fab)');
      expect(globalsCss).toContain('body:has(.report-overlay.is-visible) :is(.kiosk-fab, .printbit-language-fab)');
      expect(globalsCss).toContain('body:has(.feedback-overlay.is-visible) :is(.kiosk-fab, .printbit-language-fab)');
      expect(globalsCss).toContain('body:has(.wifi-overlay.is-visible) :is(.kiosk-fab, .printbit-language-fab)');
      expect(globalsCss).toContain('body:has(.admin-overlay.is-visible) :is(.kiosk-fab, .printbit-language-fab)');
    });

    it('hides all FABs when idle attractor screen or idle timeout warning is active', () => {
      expect(globalsCss).toContain('body:has(.idle-overlay.is-visible) :is(.kiosk-fab, .printbit-language-fab)');
      expect(globalsCss).toContain('body:has(.idle-warning-overlay');
      expect(globalsCss).toContain('.kiosk-fab.is-hidden');
      expect(globalsCss).toContain('.printbit-language-fab.is-hidden');
    });

    it('preserves FAB transitions in kiosk static mode', () => {
      expect(globalsCss).toMatch(/html\[data-kiosk-static='true'\]\s*:where\(\s*\.kiosk-fab,\s*\.printbit-language-fab\s*\)/);
    });
  });

  describe('JavaScript synchronization in app.ts', () => {
    it('defines syncFabVisibility and coordinates FAB states with modal toggles', () => {
      expect(appTs).toContain('function syncFabVisibility(): void');
      expect(appTs).toContain('setPricingModalOpen');
      expect(appTs).toContain('openWifiModal');
      expect(appTs).toContain('closeWifiModal');
      expect(appTs).toContain('openFeedbackModal');
      expect(appTs).toContain('closeFeedbackModal');
      expect(appTs).toContain('openReportModal');
      expect(appTs).toContain('closeReportModal');
      expect(appTs).toContain('openAdminModal');
      expect(appTs).toContain('closeAdminModal');
    });

    it('connects idle screen callbacks to syncFabVisibility', () => {
      expect(appTs).toMatch(/onShow:\s*\(\)\s*=>\s*syncFabVisibility\(\)/);
      expect(appTs).toMatch(/onHide:\s*\(\)\s*=>\s*syncFabVisibility\(\)/);
    });
  });

  describe('Idle screen and timeout service synchronization', () => {
    it('shared idle screen hides FABs on show and unhides them on dismiss', () => {
      expect(idleScreenTs).toMatch(/showIdleOverlay[\s\S]*?\.kiosk-fab[\s\S]*?\.add\('is-hidden'\)/);
      expect(idleScreenTs).toMatch(/hideIdleOverlay[\s\S]*?\.kiosk-fab[\s\S]*?\.remove\('is-hidden'\)/);
    });

    it('idle timeout warning hides FABs on show and unhides them on dismiss', () => {
      expect(idleTimeoutTs).toMatch(/showPageIdleWarning[\s\S]*?\.kiosk-fab[\s\S]*?\.add\('is-hidden'\)/);
      expect(idleTimeoutTs).toMatch(/hidePageIdleWarning[\s\S]*?\.kiosk-fab[\s\S]*?\.remove\('is-hidden'\)/);
    });
  });
});
