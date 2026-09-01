# Security Policy

## PrintBit — Coin-Operated Self-Service Printing Kiosk

---

## Supported Versions

PrintBit is an active capstone project. Security fixes are applied to the
**`main` branch** only. No long-term support (LTS) versions are maintained.

| Branch / Version | Supported |
| ---------------- | --------- |
| `main` (latest)  | ✅ Yes    |
| Forked / older   | ❌ No     |

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

If you discover a security vulnerability in PrintBit, report it responsibly
by opening a **[GitHub Security Advisory](https://github.com/GioMjds/printbit/security/advisories/new)**
(private disclosure) or by emailing the lead developer directly via the
contact listed on their [GitHub profile](https://github.com/GioMjds).

Please include:

- A clear description of the vulnerability.
- Steps to reproduce or a proof-of-concept.
- The affected component (backend, firmware, frontend, scripts).
- The potential impact (data exposure, coin bypass, privilege escalation, etc.).

We will acknowledge your report within **72 hours** and aim to release a fix
or mitigation within **14 days** for critical issues.

---

## Security Architecture

### File Upload & Malware Scanning

- All uploaded files are validated against their **magic bytes** before
  being accepted (e.g., PDF `%PDF-`, DOCX ZIP magic bytes).
- Infected files are **quarantined** and never reach the print pipeline.
- File names are **sanitized** to prevent path traversal attacks.
- Accepted MIME types are whitelisted: `application/pdf`, `image/*`,
  `application/vnd.openxmlformats-officedocument.wordprocessingml.document`.

### Admin Access & Authentication

- Admin credentials are hashed using **Argon2id** (memory-hard, resistant
  to GPU brute-forcing).
- Failed login attempts trigger an **account lockout** after a configurable
  threshold.
- Sessions are managed via **httpOnly cookies** (not accessible to JavaScript).
- The admin entry point is hidden behind a **5-tap gesture** on the kiosk UI,
  obscuring it from casual users.
- A **PIN field** is required to access sensitive admin settings.

### Coin & Payment Security

- Coin acceptor communication runs over a dedicated **serial (UART)** channel
  isolated from the network stack.
- Payment state is validated server-side; the frontend cannot unilaterally
  advance the print flow.
- Printer preflight checks run before payment is accepted to prevent
  coin-loss on printer failure.
- All coin transactions are logged with a **reference ID** (`PB-YYYYMMDD-XXXX`)
  for auditability.

### Network & Hardware (ESP32 / WiFiManager)

- The ESP32 captive portal operates on an **isolated AP network** during
  Wi-Fi provisioning; it does not expose the kiosk's internal LAN.
- Wi-Fi credentials provisioned via captive portal are stored in **ESP32
  NVS (Non-Volatile Storage)**, not in plaintext files.
- First boot exposes only the temporary open `PrintBit-Setup` AP. Normal
  coin, hopper, registration, and redirect behavior remains disabled until an
  administrator defines an 8–63 character permanent `PrintBit` AP password.
- Reprovisioning requires the explicit `WIFI_FACTORY_RESET` serial command;
  the firmware contains no shared fallback Wi-Fi password.
- Serial communication between the ESP32 and the Node.js host is
  **rate-limited** and validated to prevent command injection.

### Windows Kiosk Hardening

- The kiosk runs under a **dedicated Windows Assigned Access account**
  (`printbit`) with restricted permissions.
- PowerShell execution policy and scheduled tasks are configured to
  run only signed or explicitly allowed scripts.
- A **watchdog service** (scheduled task) automatically restarts the
  kiosk process on crash to prevent an exposed desktop.

### Data Privacy & File Lifecycle

- Uploaded documents are stored **temporarily** and deleted after the
  print job completes or expires.
- A **file lifecycle service** enforces configurable retention windows;
  no user files persist beyond the session by default.
- PrintBit does not collect personally identifiable information (PII)
  beyond what is transiently needed for a print session.
- Operators must comply with the **Philippine Data Privacy Act
  (Republic Act No. 10173)** when deploying this system.

---

## Known Limitations

| Area                 | Limitation                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| SQLite               | Local storage — not suitable for high-concurrency or multi-kiosk deployments.                                   |
| Self-signed / no TLS | Local kiosk-only deployment; no HTTPS is configured by default. Add a reverse proxy if exposing over a network. |
| Physical access      | An attacker with physical access to the kiosk hardware can bypass software controls. Secure the enclosure.      |

---

## Dependency Auditing

Run the following to audit for known vulnerabilities in Node.js dependencies:

```bash
pnpm audit
```

Monitor upstream advisories for:

- [Node.js](https://nodejs.org/en/blog/vulnerability/)
- [Express.js](https://expressjs.com/en/advanced/security-updates.html)
- [Socket.IO](https://github.com/socketio/socket.io/security/advisories)

---

## Changelog

Security-relevant changes are noted in commit messages with the prefix
`[security]` and tracked via GitHub Security Advisories when applicable.

---

_For general bugs and non-security issues, open a regular
[GitHub Issue](https://github.com/GioMjds/printbit/issues)._
