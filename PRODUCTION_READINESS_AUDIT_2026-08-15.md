# PrintBit Production Readiness and Failure-Risk Audit

## Report metadata

| Field               | Value                                                                                                           |
| ------------------- | --------------------------------------------------------------------------------------------------------------- |
| Audit date          | Original audit: 2026-08-15; reassessed: 2026-08-29                                                              |
| Target              | Windows self-service kiosk with ESP32 coin/hopper bridge and Epson L5290                                        |
| Repository revision | Original: `dd4cac2`; reassessed: `e0cdfb7` on `main`                                                            |
| Assessment type     | Original static/browser/hardware audit plus 2026-08-29 source review, CI gates, and production dependency audit |
| Release decision    | **NO-GO for unattended production use — reconfirmed on 2026-08-29**                                             |
| Finding status      | No original release blocker is closed by the reassessment; see the current-verdict section                      |

## Executive summary

PrintBit compiles and its browser bundles build, but it is not ready to accept real money without an attendant. The most serious risks are not cosmetic: clients connected to the kiosk network can reach unauthenticated balance, print, scanner, hotspot, and printer-control operations; the current legacy print route can print before charging; the ESP32 firmware exposes an unauthenticated hopper compatibility command; coin events are not durably queued in firmware; and print/refund state transitions can refund output that may already have reached the Epson printer.

The current machine also has a deployment mismatch. The Windows default Epson USB queue is offline while a separate Epson network queue is online. The only detected serial port is Intel Active Management Technology `COM3`, but the current serial selection logic can label the first available port as an Arduino connection. The project lockdown policy is not applied on the audited machine.

Production dependency scanning found 17 advisories: 2 critical, 10 high, 4 moderate, and 1 low. Several affected libraries directly process untrusted kiosk traffic or documents, including PDF.js, Socket.IO, Multer, Sharp/libvips, WebSocket, and SheetJS.

## 2026-08-29 reassessment — current verdict

**Verdict: NO-GO. Do not operate unattended or accept live money.** The recent work adds useful controls, but it does not clear the release blockers and has introduced failing quality gates. This is a current-code reassessment at `e0cdfb7`; it does not replace the still-required supervised hardware and fault-injection acceptance work.

### Fresh verification evidence

| Check                       | Command                                           | Result                                                                                               |
| --------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| TypeScript                  | `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` | Pass (exit 0)                                                                                        |
| Production build            | `pnpm run build`                                  | Pass (exit 0)                                                                                        |
| Complete Jest suite         | `pnpm run test -- --runInBand --forceExit`        | **Fail:** 6 suites / 27 tests failed; 17 suites / 163 tests passed; Jest required forced termination |
| Lint                        | `pnpm run lint`                                   | **Fail:** 70 errors, 40 warnings                                                                     |
| Production dependency audit | `pnpm audit --prod --json`                        | **Fail:** 2 critical, 9 high, 3 moderate, 1 low advisories                                           |

The changes do reduce part of the attack surface: `KioskAccessService` uses a process-random cookie credential, one-time bootstrap credentials, and constant-time comparison; it is mounted for scanner, copy, confirmation, selected printer-control, and test-balance routes. Node also now refuses the ESP32 network provider without `PRINTBIT_ESP32_COIN_API_KEY` outside tests. These are partial mitigations, not release-ready controls.

### Release-blocker status

| Finding                                           | Current status               | Reassessment evidence                                                                                                                                                                                                                                                            |
| ------------------------------------------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PB-AUTH-001 — HTTP access                         | **Remediated / targeted verification passed** | Kiosk/admin access now precedes every listed mutable kiosk route, including legacy `POST /upload`, legacy `POST /print`, hotspot control, language, and accessibility changes. Static-file serving runs after guarded page/API routes, so it cannot bypass the page guard. |
| PB-AUTH-002 — sessions and Socket.IO              | **Remediated / targeted verification passed** | Session creation is kiosk-only; session-ID reads/mutations require the session token and, for external callers, the owning upload client. The active-token endpoint and portal redirect are removed. Socket.IO uses authenticated control and session namespaces, room binding, and coin-lock authorization. The lockfile pins the patched Socket.IO transitive versions. |
| PB-PAY-001 — legacy print                         | **Open / Critical**          | The unguarded legacy route calls `printFile(...)` before appending its financial ledger event, then transfers the entire current balance to earnings and sets the balance to zero. This preserves both print-before-debit and full-balance charging risk.                        |
| PB-HW-001 — ESP32 hopper                          | **Open / Critical**          | The authenticated `/hopper/dispense` endpoint was added, but firmware still accepts unauthenticated `GET /?coins=...` to start a payout. It also contains default bridge/register/hopper tokens and the default AP password in source.                                           |
| PB-HW-002, PB-HW-003, PB-PRINT-001                | **Open / unverified**        | No durable firmware queue, payout replay, partial-payout, or physical refund/reconciliation evidence was produced in this reassessment. These money-and-hardware findings cannot be closed with source review alone.                                                             |
| PB-FILE-001 — untrusted files                     | **Open / Critical**          | Uploads still use Multer memory storage. The production audit retains critical i18next advisories and high advisories for `pdfjs-dist`, `sharp`, `xlsx`, Socket.IO, and related runtime dependencies. No CSP/security-header configuration was found in the Express setup.       |
| PB-PRICE-001 and PB-PERF-001                      | **Open / High**              | Current document-analysis tests fail on blank/B&W/color classification. `analyzeDocument()` imports worker-thread support but invokes `analyzeDocumentDirect()` on the main thread, so expensive processing remains on the server event loop.                                    |
| PB-WORKER-001 and PB-KIOSK-001                    | **Open / High**              | Worker command-pipe tests currently fail. Startup uses `Promise.allSettled()` for printer, scanner, serial/hopper, and hotspot probes, does not inspect rejected results, and can still call `markStartupReady()`. A failed hardware probe can therefore be advertised as ready. |
| PB-DEVICE-001, PB-SCAN-001, PB-UI-001, PB-DOC-001 | **Not eligible for closure** | Some route protection and documentation/UI work landed, but no fresh kiosk-account printer, serial, scanner/ADF, Assigned Access, browser, or documentation-consistency acceptance evidence was collected.                                                                       |

### Decision rationale and required next gate

The passing type-check and build do not outweigh the remaining anonymous money/hardware paths, physical payout bypass, print-before-debit path, unresolved critical/high dependency advisories, and failed test/lint gates. All original production acceptance gates remain intentionally unchecked.

Before reconsidering even a supervised paid pilot, first: remove or production-disable the legacy upload/print and ESP32 compatibility payout paths; authenticate every HTTP and Socket.IO control boundary; replace provisioned firmware secrets with unique credentials; make startup fail closed on a failed critical probe; restore a clean test/lint run; and remediate or formally replace the production dependency vulnerabilities. After that, run the original supervised fault matrix and 72-hour unattended soak under the kiosk account before changing this verdict.

### Release blockers at a glance

| ID            | Severity | Area                     | Failure or abuse outcome                                                                   |
| ------------- | -------- | ------------------------ | ------------------------------------------------------------------------------------------ |
| PB-AUTH-001   | Critical | HTTP APIs                | Free printing, balance reset, remote scanner/hotspot/printer control                       |
| PB-AUTH-002   | Critical | Sessions and Socket.IO   | Active-token disclosure, session takeover, room snooping, coin-slot denial of service      |
| PB-PAY-001    | Critical | Legacy printing          | Physical output before debit, full-balance overcharge, duplicate output on retry           |
| PB-HW-001     | Critical | ESP32 hopper             | Unauthenticated physical coin dispensing and embedded shared secrets                       |
| PB-HW-002     | Critical | Coin intake              | A swallowed physical coin can be lost during network/server interruption                   |
| PB-HW-003     | Critical | Change payout            | Duplicate or partial payout can be recorded as fully owed                                  |
| PB-PRINT-001  | Critical | Cancellation/refunds     | Refund after physical pages have printed; mixed-price refunds are inaccurate               |
| PB-WORKER-001 | High     | Worker lifecycle         | Stuck jobs, out-of-order terminal events, false failure/refund                             |
| PB-FILE-001   | Critical | Untrusted files          | Browser code execution, memory exhaustion, parser exploitation, disk exhaustion            |
| PB-KIOSK-001  | High     | Windows kiosk            | Browser-only kiosk escape/recovery gaps and permanent loading screen                       |
| PB-DEVICE-001 | High     | Printer/serial selection | Online Epson ignored; unrelated COM port reported healthy                                  |
| PB-SCAN-001   | High     | Scanner                  | Unauthorized scans, cross-job cancellation, fake stub success, wrong ADF page count        |
| PB-PRICE-001  | High     | Pricing                  | Grayscale scans charged as color; contradictory fallback classifications                   |
| PB-PERF-001   | High     | Event loop/resources     | Large documents block coin acknowledgement and health checks                               |
| PB-UI-001     | Medium   | Browser pages            | Missing asset, invalid IDs, uncaught redirect error, accessibility defects                 |
| PB-DOC-001    | Medium   | Operations documentation | Deployment staff may install an architecture different from the firmware in the repository |

## Scope and method

The audit covered:

- Express routes, middleware ordering, authentication, CSRF behavior, cookies, and Socket.IO events.
- SQLite repositories plus direct runtime-state mutations, idempotency, settlement, ledger, change, recovery, and refunds.
- ESP32 firmware coin forwarding, registration, captive portal, serial protocol, and hopper logic.
- Legacy and phased/new-only print dispatch, worker handoff, named pipes, spooler monitoring, cancellation, and restart recovery.
- Upload validation, pricing analysis, PDF/image/Office processing, scanner delivery, and retention behavior.
- All 21 HTML pages at desktop and mobile viewport sizes.
- Current Windows printer, serial-port, scanner-driver, spooler, runtime, and lockdown posture.
- Type-check, production build, ESLint, focused and full Jest runs, and production dependency advisories.

No real coin was inserted, no hopper payout was requested, no physical document was printed, and no physical scan was started. Those actions could spend money, move hardware, consume ink/paper, or interfere with a customer session and therefore require a supervised acceptance procedure.

## Verification evidence

| Check                   | Command or method                                                        | Result                                                            |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| TypeScript              | `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`                        | Pass                                                              |
| Browser/server bundles  | `pnpm run build`                                                         | Pass                                                              |
| Focused pricing tests   | `pnpm exec jest tests/document-analysis.spec.ts --runInBand --forceExit` | Fail: 14 failed, 3 passed                                         |
| Full test run           | Isolated Jest run                                                        | 73 passed, 14 failed; Jest retained open handles after completion |
| Lint                    | `pnpm exec eslint "src/**/*.ts"`                                         | Fail: 48 errors, 36 warnings                                      |
| Production dependencies | `pnpm audit --prod --json`                                               | 2 critical, 10 high, 4 moderate, 1 low                            |
| Browser pages           | Isolated local production build in headless Chromium                     | 21 pages checked at desktop and mobile sizes                      |
| Printer discovery       | Windows print-management and CIM queries                                 | USB default offline; Epson network queue online                   |
| Serial discovery        | `serialport` enumeration                                                 | Only Intel AMT `COM3`; no identifiable ESP32 serial device        |
| Scanner discovery       | NAPS2 device enumeration                                                 | Epson L5290 present through TWAIN; no WIA device listed           |
| Lockdown posture        | Project registry checks, read-only                                       | Lockdown state not applied; expected controls unset               |

The audited runtime is Node.js `25.9.0`. Node 25 reached end of life on 2026-03-31. The Node.js project recommends Active LTS or Maintenance LTS for production applications: <https://nodejs.org/en/about/previous-releases>.

## Detailed findings

### PB-AUTH-001 — Mutable kiosk and hardware APIs are unauthenticated

**Severity:** Critical  
**Remediation update (2026-08-29):** The process-random kiosk cookie (or an authenticated admin session) now guards the listed scanner, copy, printer-control, confirmation, balance, hotspot, language, accessibility, and legacy print paths. The legacy upload endpoint receives a method-specific `POST /upload` guard so that the public tokenized `GET /upload/:token` portal remains available without exposing the legacy API. Static assets are registered only after the guarded page and API routes, preventing a directory index from bypassing route middleware.

**Targeted verification:** `src/middleware/kiosk-access.spec.ts` rejects a non-kiosk network request with `403` and accepts the kiosk cookie; the focused authorization suite passes 8 tests with open-handle detection. The existing full lint failure and unrelated production blockers still keep the overall release verdict at **NO-GO**.

**Original evidence (remediated):** `src/modules/financial/financial.controller.ts`, `src/modules/scanner/scanner.controller.ts`, `src/modules/printer/printer.controller.ts`, `src/modules/hotspot/hotspot.controller.ts`, and `src/modules/language/language.controller.ts` registered mutable routes without an authentication or device-identity middleware.

Exposed operations include:

- `POST /api/balance/reset`
- `POST /api/balance/add-test-coin`
- `POST /upload`
- `POST /print`
- `POST /api/confirm-payment`
- `POST /api/printer/pause`
- `POST /api/printer/resume`
- `POST /api/printer/cancel-remaining`
- `POST /api/scanner/scan`
- `POST /api/scanner/soft-copy/charge`
- `POST /api/scanner/wireless-link`
- `POST /api/scan/jobs`
- `POST /api/scan/preview`
- `POST /api/scan/jobs/:id/cancel`
- `POST /api/hotspot/start`
- `POST /api/hotspot/stop`
- `PUT /api/language`
- `PUT /api/accessibility`

The CSRF middleware skips unsafe requests that do not already carry an admin cookie. It is therefore not authorization for these routes. In a normal deployed state, a hotspot client can repeatedly credit test coins, upload a file, and call the legacy print endpoint.

**Required remediation:**

1. Compile test and legacy routes out of production or guard them with an explicit production-disabled feature flag that fails closed.
2. Introduce separate identities for the kiosk browser, ESP32 bridge, worker service, and admin user.
3. Require authentication and authorization on every state-changing route, not merely same-origin checks.
4. Bind kiosk-device-only routes to loopback or a mutually authenticated local IPC channel where possible.
5. Add negative integration tests proving anonymous LAN clients receive `401` or `403` for every mutable route.

**Acceptance gate:** An unauthenticated client on the ESP32 network cannot change balance, session, language, hotspot, scanner, printer, hopper, payment, or job state.

### PB-AUTH-002 — Active sessions and Socket.IO rooms can be claimed or disrupted

**Severity:** Critical  
**Remediation update (2026-08-29):** `GET /api/session/active` and the `/portal` active-token redirect are removed. New session creation is kiosk-only. Session-ID reads and mutations validate the short-lived opaque session token and bind external calls to the first verified upload-client identifier; kiosk calls additionally use the kiosk credential. Socket.IO now rejects unauthenticated handshakes, separates privileged kiosk/admin control sockets from external session sockets, binds an external socket to one owned session room, and denies coin-lock control outside the privileged namespace. Session events are emitted only to those authenticated rooms and are suppressed once the session is inactive.

`package.json` and the lockfile also override the Socket.IO transitive fixes: `engine.io` 6.6.9, `socket.io-parser` 4.2.7, and `ws` 8.20.1. A production deployment must run `pnpm install --frozen-lockfile` to materialize those locked versions.

**Targeted verification:** `src/middleware/socket-access.spec.ts` verifies handshake rejection, session-room binding, control authorization, and both namespace middlewares; `src/modules/wireless-session/wireless-session.controller.spec.ts` verifies the authorization guard precedes every session-ID read/mutation. The raw QR URL remains a bearer capability by design and must be treated as a physical secret; it is no longer disclosed by an unauthenticated active-session endpoint.

**Original evidence (remediated):** `src/app.module.ts` returned the active upload token from `GET /api/session/active`. `src/server.ts` accepted arbitrary `joinSession`, `lockCoinSlot`, and `unlockCoinSlot` socket events without authenticating the socket or validating room ownership.

`GET /api/wireless/sessions` also creates a session and resets the global balance to zero. Session lookup, preview, analysis, and document-related APIs expose more data by session identifier than the upload-owner checks protect.

**Potential outcomes:**

- Race the legitimate phone for ownership of the active token.
- Keep a session alive by polling it.
- Read another session's document metadata or preview where the session ID is known.
- Join arbitrary Socket.IO rooms.
- Hold the coin-slot lock until disconnect.
- Observe global transaction and printer lifecycle events.

**Required remediation:** Use signed, short-lived, purpose-scoped tokens; authenticate the Socket.IO handshake; authorize every room join; stop broadcasting transaction identifiers and spooler correlation keys globally; make session creation a kiosk-only operation; and remove the active raw token endpoint.

### PB-PAY-001 — Legacy print dispatch violates charge-before-service invariants

**Severity:** Critical  
**Evidence:** `src/modules/financial/financial.service.ts` calls `printFile()` before debiting the balance. After dispatch, it sets `chargedAmount` to the entire current balance, moves that amount to earnings, and resets balance to zero.

**Failure modes:**

- Process or database failure after dispatch but before debit gives free output.
- A request retry can print the same file again.
- A customer with more balance than the job price loses the entire balance.
- The endpoint does not bind filename, quote, payment, request owner, and physical print to one transaction.

The configured dispatch mode at audit time was `legacy`, so this is an active deployment risk rather than only dormant compatibility code.

**Required remediation:** Remove `/print` from production. Use one persistent transaction with a server-computed quote, payload fingerprint, owner/session binding, idempotency key, settlement record, dispatch record, and guarded terminal state. Never trust a caller-supplied filename as sufficient authority to print.

### PB-HW-001 — ESP32 exposes unauthenticated hopper control

**Severity:** Critical  
**Evidence:** `esp32-captive-portal.ino` embeds the hotspot password, kiosk registration token, coin bridge key, and hopper key. Its legacy `GET /?coins=N` compatibility path calls `startDispense()` without token validation and accepts as many as 50 coins.

The firmware is AP-only through `WiFi.softAP()`. It is not the STA/WiFiManager implementation described by current documentation. The registration endpoint accepts an arbitrary syntactically valid IPv4 address after checking a known embedded token, which can redirect the portal and coin target.

**Required remediation:** Delete the legacy hopper route; rotate all device-specific secrets; provision unique per-device credentials outside source control; bind commands to authenticated request IDs and exact payloads; add replay protection; restrict the registration source; and document/flash the same network architecture that the application expects.

### PB-HW-002 — Coin events are not durable from pulse to ledger

**Severity:** Critical  
**Evidence:** Firmware creates an event ID and attempts an HTTP GET up to three times. If the kiosk is unavailable or registration is missing, the method returns and the event exists only in logs. The ESP32 has no persistent outbound queue.

Node's `coin_bridge_events` table and `BEGIN IMMEDIATE` transaction are good persistent idempotency controls once an event reaches the server. They do not protect a pulse that never arrives.

ESP32 mode also defaults `PRINTBIT_ESP32_ALWAYS_ACCEPT_COINS` to true, bypassing the coin-slot lock and printer-availability gate. The wiring represented in firmware has coin and hopper pulse inputs plus the hopper relay, but no physical coin-acceptor inhibit or escrow control.

**Required remediation:**

- Persist each accepted pulse/event to flash before acknowledgement.
- Retransmit with bounded exponential backoff until the server returns an authenticated durable acknowledgement.
- Keep the same event ID across reboot and retry.
- Add a physical acceptor inhibit/escrow line controlled by an independent ready signal.
- Default coin acceptance to fail closed and prove the inhibit activates when printer, database, worker, trusted time, or network readiness is unavailable.

### PB-HW-003 — Hopper commands are not exactly-once and lose partial progress

**Severity:** Critical  
**Evidence:** Firmware records `activeDispenseRequestId` and `lastDispenseRequestId` but does not reject or replay a completed request ID. The Node service polls global hopper status without requiring the returned active/last ID to match the current request. On failure, it returns `dispensedCoins: 0` and records the complete requested amount as owed, even if status had reported partial physical progress.

The firmware motor limit is fixed at 10 seconds for requests up to 50 coins. That limit has not been derived from measured worst-case hopper speed, startup latency, sensor bounce, or low-voltage behavior.

**Required remediation:** Implement a firmware request journal keyed by request ID and payload hash; return the prior result on replay; include request ID in every status result; persist partial dispense count; have Node reject mismatched/stale status; record only the undistributed remainder as owed; and calibrate a per-coin timeout plus jam/no-pulse timeout using the real hopper.

### PB-PRINT-001 — Cancellation can refund pages already printed

**Severity:** Critical  
**Evidence:** `src/modules/printer/printer.service.ts` marks the recovery transaction reconciled before sending cancellation to the worker/Windows spooler. It treats a missing Windows queue entry as an acceptable cancel outcome. Missing page progress becomes zero pages printed. Refund is calculated using a single average page price with `Math.ceil`, although mixed B/W and color pages have different prices.

An Epson driver can remove a Windows queue entry after buffering pages internally. Queue disappearance is therefore not proof of physical cancellation.

**Required remediation:** Introduce a `cancel_requested` state; wait for a terminal worker/printer observation; retain uncertainty as `pending_admin_review`; calculate refunds from the original per-page quote; never infer zero physical pages from absent telemetry; and make the financial refund and recovery transition one database transaction after the physical outcome is classified.

### PB-WORKER-001 — Worker lifecycle permits stuck and contradictory jobs

**Severity:** High  
**Evidence:**

- `src/services/job-processor.ts` claims it resumes jobs but selects only rows whose state is `pending`; a restart after setting `processing` leaves the row stranded.
- `src/services/worker-print-lifecycle.ts` handles success, progress, start, and pause explicitly, then treats every other event with a transaction ID as terminal failure. `PrinterOnline`, `PrinterOffline`, and `PrinterError` can therefore trigger refund logic.
- There is no monotonic terminal-state check. Duplicate or reordered success/failure events can overwrite a reconciled result.
- `src/services/worker-return-pipe.ts` checks maximum payload size only after finding a newline, allowing an authenticated or local malicious writer to grow memory indefinitely by never terminating a record.
- Pipe messages have no cryptographic identity and are validated only for truthy `type` and `timestampUtc` fields.
- JSON worker sidecars are written non-atomically; resume logic can delete the old sidecar before safely publishing the replacement.
- The external C# worker source/project is absent from this repository, preventing reproducible review of the complete new-only path.

**Required remediation:** Recover stale `processing` and `retrying` rows; implement a finite state machine with compare-and-set terminal transitions; validate a complete message schema; authenticate the local worker channel; bound the buffer before newline; publish all job files through temporary-file plus atomic rename; and version/control the worker source with the server.

### PB-FILE-001 — Untrusted file handling has exploitable dependencies and weak containment

**Severity:** Critical  
**Evidence:** The production audit reports 17 advisories. Directly relevant findings include:

- PDF.js arbitrary JavaScript execution from malicious PDFs in affected versions. PrintBit loads user PDFs with default scripting and has no Content Security Policy. Advisory: <https://github.com/mozilla/pdf.js/security/advisories/GHSA-hq66-cqwq-w95j>.
- Socket.IO parser memory exhaustion with no authentication required. Advisory: <https://github.com/socketio/socket.io/security/advisories/GHSA-2m8v-j782-fhvr>.
- Multer denial of service through multipart parsing and aborted uploads.
- Sharp/libvips vulnerabilities while decoding untrusted images.
- SheetJS prototype pollution and regular-expression denial of service.
- Additional WebSocket, i18next, UUID, query-string, and body-parser advisories.

Uploads use in-memory Multer storage up to 25 MB. Invalid buffers are copied to `uploads/quarantine` with no count, age, or byte quota. Office/PDF/image files are processed by native libraries or external applications without antivirus scanning or an isolated low-privilege conversion boundary.

**Required remediation:** Upgrade or replace affected dependencies; disable PDF.js scripting immediately; add a restrictive CSP and other security headers; stream uploads to a bounded staging area; apply global and per-session byte quotas; scan with Windows Defender or another approved engine; isolate converters under a low-privilege account/process boundary; enforce CPU, memory, wall-clock, and output-size limits; and purge quarantine through a documented retention policy.

### PB-KIOSK-001 — Current Windows posture is not a resilient kiosk

**Severity:** High  
**Evidence:** The audited registry state has project lockdown `Applied=0`; USB storage service remains enabled; and the policy values checked by `scripts/verify-kiosk-lockdown.ps1` are unset. The current environment has kiosk lockdown disabled.

`scripts/start-kiosk.ps1` can launch Edge after the server fails its readiness wait. The server starts listening on `0.0.0.0` before database and hardware initialization; initialization errors are caught and leave the process alive in a failed/503 state. Watchdog restart-on-unhealthy and restart-when-process-alive default to false, so a permanent loading page may not self-heal.

The launcher supplies `--kiosk` but no idle reset. Microsoft states that Edge's flag alone does not restart a closed kiosk and that common open/save dialogs need additional policy controls. Assigned Access or Shell Launcher provides the restricted shell and restart behavior: <https://learn.microsoft.com/en-us/windows/configuration/assigned-access/> and <https://learn.microsoft.com/en-us/deployedge/microsoft-edge-configure-kiosk-mode>.

**Required remediation:** Configure Assigned Access for a dedicated non-administrator local account; add URL allow/block policies and an idle reset; apply and verify the project lockdown controls; make startup failure terminate with a non-zero exit; enable watchdog recovery for an unhealthy but live process; and run every scanner/printer/native dependency under the exact kiosk account before deployment.

### PB-DEVICE-001 — Printer and serial auto-selection can report the wrong hardware

**Severity:** High

#### Printer

The Windows default `EPSON L5290 Series` USB queue reports `WorkOffline=True`. `L5290 Series(Network)` reports online. Unless `targetPrinterName` is configured, PrintBit selects the Windows default. The Epson network port name begins with an Epson-specific token and is classified as `unknown`, so network/SNMP ink telemetry is not attempted.

**Required remediation:** Explicitly configure the online network queue; remove or disable stale duplicate queues; extend Epson port/IP discovery; and make preflight fail with an actionable diagnostic when configured and default printer identities disagree.

#### Serial

Only Intel AMT `COM3` was detected. `src/services/serial.ts` chooses the first port when no hint is configured and also falls back to the first port when a hint does not match. On open it logs “Arduino connected.” Numeric data from an unrelated serial device can enter the coin-token parser.

**Required remediation:** In HTTP-only ESP32 mode, disable coin serial parsing. Otherwise require an exact path plus expected VID, PID, serial number, and application-level handshake; never fall back to another port; and represent “port open” separately from “authenticated coin controller healthy.”

### PB-SCAN-001 — Scanner operations lack ownership and concurrency safety

**Severity:** High  
**Evidence:** Scanner routes are public. The NAPS2 adapter stores only one `childProc`, so concurrent scans can overwrite that handle and cancellation can terminate the wrong operation. Job result, preview, and color-analysis endpoints are guessable by job ID or filename. The fallback stub reports available capabilities and creates a text file as a successful scan. Both real and stub adapters hardcode `pageCount: 1`.

The Epson L5290 was visible through TWAIN in the current administrator session but not WIA. Epson documents an ADF capacity of approximately 30 Letter/A4 sheets or 10 Legal sheets: <https://files.support.epson.com/docid/cpd6/cpd60263.pdf>. NAPS2 supports explicit TWAIN/WIA, device, source, DPI, and bit-depth selection: <https://www.naps2.com/doc/command-line>.

**Required remediation:** Authenticate kiosk scanner operations; enforce a single active physical scan with a job-owned process handle; reject the stub in production; generate opaque capability tokens for results; derive page count from the completed PDF/images; clean partial files on timeout/cancel; and validate TWAIN, flatbed, and ADF behavior under the Assigned Access account.

### PB-PRICE-001 — Color and blank-page analysis can silently overcharge

**Severity:** High  
**Evidence:** `src/services/document-analysis.ts` treats every PDF image paint operation as color and forces pages containing images into `full_color`. A grayscale scanned PDF is therefore billed as color. Coverage is estimated from drawing-operator count rather than rendered pixel or page area.

On operator-scan failure, the code sets `coverage=1`, `isColor=true`, and `classification=full_color` but does not clear the initial `isBlank=true`. Low confidence is stored but does not block the quote or require confirmation.

The focused suite fails because test mocks still expose an older render interface while production calls `getOperatorList()`. That test drift is separate from the independently visible grayscale-image and inconsistent-fallback defects.

**Required remediation:** Analyze rendered pixels in an isolated worker; measure color and content coverage separately; define a conservative low-confidence policy; prohibit contradictory classification fields through a validated result type; and add real fixture tests for grayscale scans, color scans, blank pages, mixed documents, Office conversion, malformed PDFs, and fallback behavior.

### PB-PERF-001 — Heavy work can block money and health traffic

**Severity:** High  
**Evidence:** Although a worker entry file exists, the public `analyzeDocument()` function directly invokes `analyzeDocumentDirect()` on the Node main thread. The in-memory pricing queue calls that function sequentially and never purges completed entries from its `Map`.

Large PDFs/images, Office conversion, memory-buffered uploads, synchronous database-state rewrites, and unbounded named-pipe fragments can delay coin acknowledgement, Socket.IO updates, health responses, and shutdown. Firmware then abandons the coin event after its short retry sequence.

**Required remediation:** Actually use worker threads or a separate constrained analysis process; impose concurrency and queue limits; remove completed queue records; add event-loop lag and heap/disk metrics; and keep coin acknowledgement on a minimal, bounded path.

### PB-UI-001 — Browser-page defects and admin middleware bypass

**Severity:** Medium

All customer and admin pages were scanned at desktop and mobile sizes. No horizontal overflow was observed, and logged-out admin API checks correctly returned `401`.

Defects found:

- `/admin/` references `/admin/app.js`, but the production build has no output target for that file. The request returns `404` before the meta redirect completes.
- The full admin pages contain duplicate `id="adminMessage"` elements, creating invalid DOM and ambiguous ARIA references.
- `/confirm/` throws an uncaught `Missing print configuration` error after initiating its redirect.
- The root and scan pages contain empty image `src` attributes, producing broken images/current-document requests.
- Automated accessible-name checks found unnamed controls on configuration, transactions, scan, and upload pages.
- Express static assets are registered before protected page routes. A direct `/admin/.../index.html` request bypasses `requireAdminLocalAccess`, although protected APIs still require an admin session.
- Direct `/upload/` renders an unresolved `{{token}}` placeholder; only `/upload/:token` is valid.

**Required remediation:** Add or remove the root admin bundle reference; make IDs unique; replace exception-based redirect control flow; omit empty `src`; fix labels/ARIA; register protected admin files behind middleware or keep them out of the public static root; and return an intentional redirect/error for un-tokenized upload paths.

### PB-DOC-001 — Operational documentation contradicts the repository

**Severity:** Medium  
**Evidence:**

- `README.md`, `ARCHITECTURE.md`, and `agent_docs/hardware_integration.md` describe STA mode with WiFiManager, while firmware calls `WiFi.softAP()` and contains no WiFiManager implementation.
- Hardware documentation specifies `POST /coin` and UUID event IDs, while firmware sends GET requests and creates a random/millis/counter string.
- `README.md` and `OPERATIONS.md` advertise `pnpm run db:migrate:legacy`, but no such package script exists.
- `ARCHITECTURE.md` refers to old route/controller layouts that are absent from the current modular structure.

**Potential outcome:** An operator can flash, cable, configure, or recover the kiosk according to an architecture the current software does not implement.

**Required remediation:** Choose the intended ESP32 architecture, implement it, and update README, architecture, hardware, installation, operations, API, and Windows setup documents in the same change. Add automated documentation checks for package scripts and referenced paths.

## Page coverage matrix

| Surface        | Pages exercised                                                                                                                                                                | Result summary                                                                |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Customer/kiosk | `/`, `/scan`, `/upload`, `/config`, `/confirm`, `/copy`, `/print`, `/receipt`, `/loading`, `/feedback`, `/report`                                                              | Responsive at tested sizes; defects listed in PB-UI-001                       |
| Administration | `/admin`, `/admin/dashboard`, `/admin/earnings`, `/admin/system`, `/admin/settings`, `/admin/logs`, `/admin/transactions`, `/admin/feedback`, `/admin/report`, `/admin/alerts` | Logged-out APIs rejected; root asset missing; duplicate IDs across full pages |

The browser exercise used an isolated temporary server/database and intentionally missing print dependencies. It verified routing, loading, layout, assets, console output, and unauthenticated behavior without activating the Epson printer, scanner, coin acceptor, or hopper.

## Existing controls worth preserving

- ESP32 coin events that reach Node are persisted in a dedicated table with a primary key and an immediate SQLite transaction, providing durable duplicate-event suppression.
- SQLite WAL mode and busy timeout reduce common kiosk write-contention failures.
- Upload validation checks extensions, MIME declarations, magic bytes, disguised executable suffixes, and OOXML structure before normal processing.
- Admin passwords use Argon2id and admin cookies are HTTP-only with strict SameSite behavior.
- Recovery, owed-change, receipt, anomaly, and financial-ledger concepts already exist and provide a foundation for a stricter state machine.
- TypeScript strict compilation and the production build currently pass.

These controls do not offset the blockers above, but remediation should extend them rather than bypass or remove them.

## Recommended remediation program

### Phase 0 — Stop unsafe production exposure

1. Remove or production-disable test coin, balance reset, legacy upload, and legacy print routes.
2. Authenticate all mutable HTTP and Socket.IO operations.
3. Delete the unauthenticated ESP32 hopper route and rotate all embedded/default credentials.
4. Disable PDF scripting, add CSP/security headers, and upgrade directly exposed vulnerable packages.
5. Pin a supported Node LTS version and retest native modules (`edge-js`, `serialport`, `argon2`, `canvas`, and `sharp`).

### Phase 1 — Establish money-safe state machines

1. Define persistent coin, payment, hopper, print, cancel, and refund state diagrams.
2. Require payload-bound idempotency keys for every money/hardware command.
3. Guard terminal transitions with database compare-and-set operations.
4. Record partial and uncertain physical outcomes without automatically converting uncertainty into full credit/refund.
5. Reconcile stale in-progress work on startup.

### Phase 2 — Correct hardware identity and communication

1. Bind the exact online Epson queue and verify its driver/port under the kiosk account.
2. Require a serial device identity and handshake or disable serial in HTTP-only mode.
3. Add durable ESP32 coin storage, authenticated acknowledgements, and physical acceptor inhibit.
4. Add hopper replay protection, request-correlated status, and calibrated timeout/jam behavior.
5. Run scanner operations through one authenticated, mutually exclusive job manager.

### Phase 3 — Contain untrusted work and resource use

1. Move rendering/analysis/conversion off the Express event loop.
2. Stream uploads to bounded staging and apply cumulative quotas.
3. Scan files before conversion and execute converters with least privilege.
4. Bound IPC, queue length, heap, disk, conversion output, and operation duration.
5. Add retention jobs for quarantine, previews, failed worker files, and completed pricing jobs.

### Phase 4 — Deploy and verify the Windows kiosk

1. Configure Assigned Access with a dedicated standard local account.
2. Apply Edge URL, keyboard, download, print-dialog, idle-reset, and restart policies.
3. Apply and pass all project lockdown checks.
4. Enable watchdog restart for unhealthy live processes and make startup failures exit.
5. Validate Epson printing, NAPS2 TWAIN, network access, updates, and recovery under the kiosk account—not the administrator account.

### Phase 5 — Supervised physical acceptance and soak testing

Run a fault-injection matrix covering at least:

- Duplicate, delayed, reordered, and lost coin HTTP events.
- Server outage before and after durable coin acknowledgement.
- ESP32 reboot with queued coin events.
- Hopper HTTP response loss before, during, and after payout.
- Hopper jam/no-pulse and partial payout.
- Printer offline, USB/network queue mismatch, paper-out, paper jam, cover open, low/empty ink, and power removal.
- Worker/server reboot before enqueue, after enqueue, during spooling, and after Epson buffering.
- Pause, resume, cancel, and repeated cancel at every page boundary.
- Mixed B/W/color documents, grayscale scanned PDFs, blank pages, ADF multi-page scans, malformed files, and maximum-size uploads.
- Disk full, low memory, clock drift, Wi-Fi interruption, kiosk logout/reboot, and watchdog recovery.

Run a minimum 72-hour unattended soak with repeated uploads, coins, prints, scans, controlled faults, and automated reconciliation checks before accepting real customers.

## Production acceptance gates

PrintBit is ready for a production pilot only when all of the following are true:

- [ ] No anonymous client can mutate financial, session, printer, scanner, hotspot, language, admin, or hardware state.
- [ ] Test and legacy payment/print routes do not exist in the production route table.
- [ ] Every physical coin is either durably credited once or retained in recoverable pending state across outage/reboot.
- [ ] Every hopper request is exactly-once and records partial physical payout accurately.
- [ ] Charge, print, cancel, and refund transitions are persistent, payload-bound, and terminally monotonic.
- [ ] Uncertain printer outcomes require reconciliation; queue disappearance never automatically proves zero output.
- [ ] The configured Epson queue is online and verified by an actual supervised test under the kiosk account.
- [ ] ESP32 identity is verified, or serial coin parsing is disabled.
- [ ] TWAIN flatbed and ADF page counts are correct under the kiosk account.
- [ ] Pricing fixtures correctly classify grayscale scans, blank pages, and mixed-color documents.
- [ ] Type-check, build, lint, dependency policy, and the complete test suite pass without forced termination or open handles.
- [ ] Supported Node LTS and patched direct dependencies are pinned in the lockfile.
- [ ] Assigned Access, lockdown verification, URL restrictions, idle reset, and watchdog restart are proven after reboot.
- [ ] Resource, disk, event-loop, hardware, owed-change, and reconciliation alerts reach an operator through a channel outside the kiosk UI.
- [ ] The supervised fault matrix and 72-hour soak complete without unexplained balance, earnings, payout, or page-count deltas.

## Suggested finding closure format

When resolving an item, record the following in the pull request or follow-up report:

```text
Finding: PB-XXX-000
Fix revision:
Threat/failure removed:
Automated regression test:
Physical test performed:
Observed financial/hardware result:
Remaining limitation:
Reviewer/date:
```

Do not close a money or hardware finding using code inspection alone. It requires an automated regression test plus a supervised physical or fault-injection result appropriate to the failure mode.
