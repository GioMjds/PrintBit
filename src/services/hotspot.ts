import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync, spawn, ChildProcess } from "node:child_process";
import {
  MYPUBLICWIFI_PATH,
  HOTSPOT_SSID,
  HOTSPOT_PASSWORD,
  PORT,
} from "../config/http";

const MPWF_EXE = path.join(MYPUBLICWIFI_PATH, "MyPublicWiFi.exe");
const MPWF_DB = path.join(MYPUBLICWIFI_PATH, "Data.db");
const MPWF_LOGIN = path.join(MYPUBLICWIFI_PATH, "Web", "login.html");
const MPWF_LOGIN_BACKUP = path.join(MYPUBLICWIFI_PATH, "Web", "login.html.bak");

let hotspotProcess: ChildProcess | null = null;

/* ------------------------------------------------------------------ */
/*  IP helpers                                                        */
/* ------------------------------------------------------------------ */

/** Convert IPv4 string to signed 32-bit int (big-endian, matching MyPublicWiFi's format). */
function ipToInt32(ip: string): number {
  const parts = ip.split(".").map(Number);
  // Big-endian signed 32-bit
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) | 0;
}

/* ------------------------------------------------------------------ */
/*  Database configuration                                            */
/* ------------------------------------------------------------------ */

/**
 * Configure MyPublicWiFi's Data.db with PrintBit settings.
 * Uses the sqlite3 CLI that ships with MyPublicWiFi.
 */
function configureDatabase(): void {
  if (!fs.existsSync(MPWF_DB)) {
    console.warn("⚠ MyPublicWiFi Data.db not found:", MPWF_DB);
    return;
  }

  const routerIp = "192.168.5.1";
  const updates: Record<string, string | number> = {
    NetworkSSID: HOTSPOT_SSID,
    NetworkKey: HOTSPOT_PASSWORD,
    AuthenticationEnabled: "Y",
    TOCGuestAuthenticationEnabled: "Y",
    AutoHotspotStartEnabled: "Y",
    LocalHostAccessDisabled: "N",
    DhcpForceDNS: "Y",
    DhcpDNSServerIP: ipToInt32(routerIp),
    DhcpRouterIP: ipToInt32(routerIp),
    DhcpNetMask: ipToInt32("255.255.255.0"),
    DhcpStartIP: ipToInt32("192.168.5.2"),
    DhcpEndIP: ipToInt32("192.168.5.254"),
  };

  const setClauses = Object.entries(updates)
    .map(([col, val]) => {
      const v = typeof val === "string" ? `'${val.replace(/'/g, "''")}'` : val;
      return `${col}=${v}`;
    })
    .join(", ");

  const sql = `UPDATE HotspotSettings SET ${setClauses} WHERE ID=1;`;

  // Write a temp Python script to avoid cmd.exe quoting issues
  const pyScript = path.join(os.tmpdir(), "printbit-config-mpwf.py");
  try {
    fs.writeFileSync(
      pyScript,
      [
        "import sqlite3",
        `c = sqlite3.connect(r'${MPWF_DB}')`,
        `c.execute("""${sql}""")`,
        "c.commit()",
        "c.close()",
      ].join("\n"),
    );
    execSync(`python "${pyScript}"`, { timeout: 10_000, stdio: "pipe" });
    console.log(`[HOTSPOT] ✓ MyPublicWiFi configured: SSID=${HOTSPOT_SSID}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[HOTSPOT] ⚠ Could not configure Data.db:", msg);
  } finally {
    try { fs.unlinkSync(pyScript); } catch { /* cleanup */ }
  }
}

/* ------------------------------------------------------------------ */
/*  Captive portal redirect page                                      */
/* ------------------------------------------------------------------ */

/** Deploy a redirect login.html that sends phones to PrintBit's upload page. */
function deployLoginPage(): void {
  // Back up original if not already done
  if (fs.existsSync(MPWF_LOGIN) && !fs.existsSync(MPWF_LOGIN_BACKUP)) {
    try {
      fs.copyFileSync(MPWF_LOGIN, MPWF_LOGIN_BACKUP);
    } catch { /* may fail if locked */ }
  }

  const kioskOrigin = `http://192.168.5.1:${PORT}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>PrintBit Kiosk</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: #f0f2f5; display: flex; align-items: center; justify-content: center;
    min-height: 100vh; color: #333;
  }
  .card {
    background: #fff; border-radius: 16px; padding: 2rem; max-width: 360px;
    width: 90%; text-align: center; box-shadow: 0 4px 24px rgba(0,0,0,0.08);
  }
  h2 { margin-bottom: 0.5rem; font-size: 1.3rem; }
  p { color: #666; font-size: 0.95rem; margin-bottom: 1rem; }
  .spinner { width: 32px; height: 32px; border: 3px solid #e0e0e0;
    border-top-color: #1a73e8; border-radius: 50%; animation: spin 0.8s linear infinite;
    margin: 1rem auto; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .fallback { display: none; margin-top: 1rem; }
  .fallback a { color: #1a73e8; text-decoration: none; font-weight: 500; }
</style>
</head>
<body>
<div class="card">
  <h2>📄 PrintBit Kiosk</h2>
  <p id="status">Connecting to upload page…</p>
  <div class="spinner" id="spinner"></div>
  <div class="fallback" id="fallback">
    <p>Could not auto-redirect. <a id="manualLink" href="${kioskOrigin}/upload">Open upload page</a></p>
  </div>
</div>
<script>
(function() {
  var origin = '${kioskOrigin}';
  var statusEl = document.getElementById('status');
  var spinnerEl = document.getElementById('spinner');
  var fallbackEl = document.getElementById('fallback');
  var linkEl = document.getElementById('manualLink');

  function showFallback(msg) {
    statusEl.textContent = msg;
    spinnerEl.style.display = 'none';
    fallbackEl.style.display = 'block';
    linkEl.href = origin + '/upload';
  }

  // Try to fetch active session and redirect
  var xhr = new XMLHttpRequest();
  xhr.open('GET', origin + '/api/session/active', true);
  xhr.timeout = 5000;
  xhr.onload = function() {
    if (xhr.status === 200) {
      try {
        var data = JSON.parse(xhr.responseText);
        if (data.uploadUrl) {
          window.location.replace(data.uploadUrl);
          return;
        }
      } catch(e) {}
    }
    showFallback('No active print session. Please start one on the kiosk screen.');
  };
  xhr.onerror = function() { showFallback('Could not reach kiosk server.'); };
  xhr.ontimeout = function() { showFallback('Connection timed out.'); };
  xhr.send();
})();
</script>
</body>
</html>`;

  try {
    fs.writeFileSync(MPWF_LOGIN, html, "utf-8");
    console.log("[HOTSPOT] ✓ Captive portal redirect page deployed");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[HOTSPOT] ⚠ Could not deploy login.html:", msg);
  }
}

/* ------------------------------------------------------------------ */
/*  Firewall                                                          */
/* ------------------------------------------------------------------ */

function ensureFirewallRules(): void {
  const rules = [
    { name: "PrintBit-Server-3000", port: 3000, proto: "TCP" },
  ];

  for (const { name, port, proto } of rules) {
    try {
      const check = execSync(
        `netsh advfirewall firewall show rule name="${name}"`,
        { stdio: "pipe", timeout: 5_000, encoding: "utf-8" },
      );
      if (check.includes("No rules match")) throw new Error("missing");
    } catch {
      try {
        execSync(
          `netsh advfirewall firewall add rule name="${name}" dir=in action=allow protocol=${proto} localport=${port}`,
          { stdio: "ignore", timeout: 5_000 },
        );
        console.log(`[HOTSPOT] → Firewall rule added: ${name}`);
      } catch { /* not admin or exists */ }
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Process launcher                                                  */
/* ------------------------------------------------------------------ */

/**
 * Start MyPublicWiFi as a background process.
 * Configures the database and captive portal page first.
 */
export async function startHotspot(): Promise<void> {
  if (!fs.existsSync(MPWF_EXE)) {
    console.warn(
      "[HOTSPOT] ⚠ MyPublicWiFi not found at:",
      MYPUBLICWIFI_PATH,
      "\n[HOTSPOT]   Install from https://mypublicwifi.com or set PRINTBIT_MYPUBLICWIFI_PATH",
    );
    return;
  }

  console.log("[HOTSPOT] ── Configuring MyPublicWiFi ──────────────────────");

  ensureFirewallRules();
  configureDatabase();
  deployLoginPage();

  // Kill any existing instance (we'll re-launch with our config)
  try {
    execSync('tasklist /FI "IMAGENAME eq MyPublicWiFi.exe" /NH', {
      encoding: "utf-8",
      timeout: 5_000,
      stdio: "pipe",
    }).includes("MyPublicWiFi.exe") &&
      execSync('taskkill /F /IM MyPublicWiFi.exe', {
        stdio: "ignore",
        timeout: 5_000,
      });
  } catch { /* not running */ }

  // Launch MyPublicWiFi (requires admin — use shell to handle elevated exe)
  hotspotProcess = spawn("cmd", ["/c", "start", "", MPWF_EXE], {
    cwd: MYPUBLICWIFI_PATH,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });

  hotspotProcess.unref();
  hotspotProcess.on("error", (err) => {
    console.warn("[HOTSPOT] ⚠ Failed to launch MyPublicWiFi:", err.message);
  });

  // Wait for hotspot to initialize
  await new Promise<void>((resolve) => setTimeout(resolve, 3_000));
  console.log("[HOTSPOT] ✓ MyPublicWiFi launched — hotspot starting");
}
