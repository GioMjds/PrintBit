import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const logsDir = path.resolve('src', 'public', 'admin', 'logs');

function stylesheetUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}

describe('admin logs mobile layout', () => {
  it('uses the full viewport and keeps controls and long log content readable at 425px', () => {
    expect(fs.existsSync(chromePath)).toBe(true);

    const source = fs.readFileSync(path.join(logsDir, 'index.html'), 'utf8');
    const logRow = `
      <tr data-log-id="layout-test">
        <td class="logs-td logs-td--ts" data-label="Timestamp">9/8/2026, 10:33:52 PM</td>
        <td class="logs-td logs-td--msg" data-label="Message">
          <div class="logs-msg-wrap">
            <span class="log-badge log-badge--system">TRANSIENT_STARTUP_CLEANUP_COMPLETED</span>
            <span class="logs-msg-text">Startup transient files were cleaned successfully.</span>
          </div>
        </td>
      </tr>`;
    const probe = `<script>
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
        const sidebar = rect('.sidebar');
        const main = rect('.main');
        const action = rect('#refreshBtn');
        const badge = rect('.log-badge');
        const message = rect('.logs-msg-text');
        const logText = getComputedStyle(document.querySelector('.logs-msg-text'));
        const navLinks = [...document.querySelectorAll('.sidebar__nav .nav-btn')];
        const firstNav = navLinks[0].getBoundingClientRect();
        const secondNav = navLinks[1].getBoundingClientRect();
        document.body.dataset.layoutProbe = JSON.stringify({
          viewportWidth: innerWidth,
          sidebarIsLeftRail: sidebar.left <= 2 && sidebar.width <= 70 && sidebar.height >= innerHeight * 0.8,
          noPageOverflow: document.documentElement.scrollWidth <= innerWidth,
          badgeStaysReadable: badge.width >= 100 && badge.height <= 26,
          messageUsesCardWidth: message.width >= 200,
          mobileBodyTextIsCompact: parseFloat(logText.fontSize) <= 12 && parseFloat(logText.fontSize) >= 11,
          mobileNavigationIsNamed: navLinks.every((link) => link.getAttribute('aria-label')),
          lockControlIsNamed: Boolean(document.querySelector('.lock-btn').getAttribute('aria-label')),
        });
      }));
    </script>`;

    const html = source
      .replace('/globals.css', stylesheetUrl(path.resolve('src', 'public', 'globals.css')))
      .replace('/admin/shared.css', stylesheetUrl(path.resolve('src', 'public', 'admin', 'shared.css')))
      .replace('/admin/logs/styles.css', stylesheetUrl(path.join(logsDir, 'styles.css')))
      .replace(/<script>[\s\S]*?<\/script>/, '')
      .replace('<div id="adminAuthView" class="auth-gate">', '<div id="adminAuthView" class="auth-gate hidden">')
      .replace('<div id="adminDashboard" class="shell hidden">', '<div id="adminDashboard" class="shell">')
      .replace('<tbody id="logsBody"></tbody>', `<tbody id="logsBody">${logRow}</tbody>`)
      .replace('<script src="/admin/logs/app.js"></script>', probe);

    const fixturePath = path.join(os.tmpdir(), 'printbit-admin-logs-mobile-layout.html');
    fs.writeFileSync(fixturePath, html, 'utf8');

    const dump = execFileSync(
      chromePath,
      [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--allow-file-access-from-files',
        '--window-size=425,777',
        '--virtual-time-budget=1000',
        '--dump-dom',
        pathToFileURL(fixturePath).href,
      ],
      { encoding: 'utf8' },
    );
    const encoded = dump.match(/data-layout-probe="([^"]+)"/)?.[1];
    expect(encoded).toBeDefined();
    const result = JSON.parse(
      (encoded ?? '')
        .replaceAll('&quot;', '"')
        .replaceAll('&amp;', '&'),
    ) as Record<string, boolean | number>;

    expect(result).toEqual({
      // Headless Chrome enforces a 500px minimum content viewport on Windows.
      // This still exercises the mobile rules that cover the reported 425px PWA.
      viewportWidth: 504,
      sidebarIsLeftRail: true,
      noPageOverflow: true,
      badgeStaysReadable: true,
      messageUsesCardWidth: true,
      mobileBodyTextIsCompact: true,
      mobileNavigationIsNamed: true,
      lockControlIsNamed: true,
    });
  });
});
