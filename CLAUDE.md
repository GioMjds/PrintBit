# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## PrintBit — Windows coin-operated print kiosk

PrintBit is a **Windows-only** coin-operated self-service printing kiosk for campus environments.
Users upload files via QR-initiated ESP32 hotspot; the kiosk handles coin payment, job dispatch,
change dispensing, and receipt generation. Hardware (coin acceptor, hopper, scanner, printer,
ESP32 bridge) is first-class — coin flow, payment safety, and hardware synchronization are not
afterthoughts.

## Stack

- **Backend:** Node.js 22+ + Express 5 + Socket.IO 4 + TypeScript (strict mode, `ts-jest`)
- **Storage:** SQLite via repository pattern (`src/core/database/`) → `printbit.sqlite`
- **Frontend:** Static HTML/CSS + TypeScript bundles compiled with esbuild → `src/public/`
- **Hardware IPC:** `serialport` (coin/hopper shared line), named pipes to a C# Windows worker
  (`worker-command-pipe` / `worker-return-pipe`), ESP32 HTTP bridge (STA mode, WiFiManager)
- **Print dispatch:** PDFtoPrinter / GhostScript (mode-gated by env var),
  optional Sumatra fallback
- **Package manager:** `pnpm@10` only — do not use `npm` or `yarn`

## Build, verify, and run

```bash
# Type-check (required after any .ts change)
pnpm exec tsc --noEmit --ignoreDeprecations 6.0

# Build browser + server bundles (required after src/public/**/*.ts changes)
pnpm run build

# Dev server with hot reload
pnpm run dev          # tsx watch src/server.ts

# Run all tests
pnpm test
pnpm test:watch
pnpm test:coverage

# Lint
pnpm run lint
pnpm run lint:fix

# Production start (after pnpm run build)
pnpm start
```

Test discovery uses `jest.config.ts` (`**/*.spec.ts`, `**/*.int.ts`, `**/*.e2e.ts`). The `@/*`
path alias maps to `./src/*` (see `tsconfig.json`).

## Architecture

The codebase is layered top-down from `src/server.ts`:

```folder
src/
  server.ts             # Bootstraps Express + Socket.IO, runs startup readiness, mounts modules
  app.module.ts         # Registers every feature module + static assets + kiosk-access middleware
  config/               # Env-driven runtime constants (HTTP, watchdog, document-analysis, i18n)
  runtime/              # Cross-cutting API-aware Express helpers (api-aware-app.ts)
  modules/              # Feature modules — each owns controllers, services, schemas for its domain
    admin/              # PIN auth, settings, logs, transaction context, owed-change resolution
    financial/          # Balance, pricing, confirm-payment, settlement
    printer/            # Printer status / pause / resume / cancel-remaining
    scanner/            # Scan-and-copy flow
    copy/               # Copy job lifecycle
    wireless-session/   # Phone → kiosk upload session lifecycle + previews
    upload-portal/      # Tokenized mobile upload page rendering
    receipt/            # E-receipt token mint/verify + customer/admin read paths
    hotspot/            # ESP32 registration, captive-portal bridging
    hopper/             # Coin hopper HTTP/serial transport
    feedback/           # Customer feedback submissions
    report/             # Customer report-issue submissions
    anomaly/            # Anomaly aggregation + reporting
    watchdog/           # Health monitoring for serial/printer/hotspot
    language/           # i18n runtime switching
    page/               # HTML page routing
    print-queue/        # Print job state machine (orchestration, consumption, admin supervision)
  services/             # Lower-level shared services (serial, hopper, pricing, dispatcher, db, session)
  core/
    database/           # SQLite facade + schema + repository methods (balance-lock, idempotency)
    middleware/         # Shared Express middleware (auth, rate-limit, exception handling)
    exceptions/         # Typed domain errors
  middleware/           # Captive portal, CSRF, kiosk-access, file validation, static assets
  guards/               # Reusable route guards (e.g. printer-guard.ts)
  utils/                # network, lockout, hash, validators, formatters
  public/               # Browser UI pages (print/upload/config/confirm/copy/scan/admin)
  locales/              # i18n resources
uploads/                # Runtime uploaded files (do not delete during operation)
printbit.sqlite         # Runtime persisted machine state (do not delete during operation)
```

### Module pattern

Every `src/modules/<name>/` exports a `register<Name>Module(app, deps)` function from a
`<name>.module.ts` that wires its controller routes onto the shared Express app. Controllers
hold Express handlers; services under `src/services/` (or co-located in the module) hold
business logic. Cross-cutting concerns (Socket.IO broadcast, SessionStore) are passed in via
`AppModuleDeps` from `app.module.ts`.

### Persistence

All DB operations **must** go through repository methods in `src/core/database/` — never
mutate `printbit.sqlite*` directly. This guarantees audit trails, transactional safety,
and coin-event idempotency. The DB layer exposes:

- `db.ts` — runtime state facade (`runtime_state` table for in-memory-style persistence)
- `sqlite-storage.ts` — operational domains (admin logs, feedback, report issues, receipts,
  receipt access tokens)
- `balance-lock.ts` — coin-slot locking primitives
- `idempotency.ts` — `x-coin-event-id` deduplication

### IPC with the Windows C# worker

PrintBit runs alongside a C# worker that talks to the printer driver. The two communicate over
Windows named pipes:

- `src/services/worker-command-pipe.ts` — outbound commands (pause/resume/cancel/preflight)
- `src/services/worker-return-pipe.ts` — inbound events (`PrinterOffline`, `PrinterError`, etc.)
  → mapped to Socket.IO broadcasts in `server.ts`

`server.ts` blocks startup on the return-pipe `ready` promise; if the bind fails the kiosk
refuses to come up rather than running with a broken IPC channel.

### Socket.IO surface

Live machine events broadcast via Socket.IO (`io.emit`): balance updates, coin accepted, upload
status, serial status, coin-slot lock/unlock, printer status, and translated printer errors
(see `translateHardwarePrinterError` in `server.ts` for the WMI → `PrintError` mapping).

## Critical invariants

**Coin idempotency:** Every coin event from the ESP32 bridge carries `x-coin-event-id`; both
ESP32 (suppress retransmit) and kiosk (`src/core/database/idempotency.ts`) deduplicate.
**Never remove either check** — removing either causes double-credit.

**Coin slot locking:** A socket may `lockCoinSlot` to claim exclusive deposit/print rights while
a user is mid-flow; only the owning socket may `unlockOwnedCoinSlot` (also fires on disconnect).

**Session security:** Authentication uses argon2id + httpOnly cookies + account lockout
(`src/utils/lockout.ts`). Never bypass or weaken session/admin checks.

**Kiosk access gating:** `createKioskAccessMiddleware()` is applied to every write-side printer
endpoint, confirm-payment, and balance mutations. Read-only probes (`GET /api/printer/status`)
are intentionally unguarded so non-bootstrapped browsers can still render kiosk UI.

**CSRF:** `createCsrfProtectionMiddleware()` is mounted globally after `cookieParser()`.

**Trusted time:** `PRINTBIT_TRUSTED_TIME_ENFORCE=true` blocks financial operations when NTP
sync is lost; `startTrustedTimeMonitor` publishes transitions to `adminService` and
`anomalyService`.

## Hardware integration rules

- The shared serial port is owned by `src/services/serial*.ts` — do not open another connection.
  Serial commands are newline-terminated ASCII; `KIOSK_IP:<ip>` tells the ESP32 the kiosk's
  current IP.
- Hopper dispense is initiated by the kiosk and acknowledged via serial; concurrent requests
  must be guarded. Only **1-peso coins** are dispensed — pricing is always whole-peso.
- The ESP32 firmware is in `esp32-captive-portal.ino` (root). Architecture is **STA mode via
  WiFiManager**; AP-only mode was retired because it caused phantom coin events on reconnect.
  Coin events must be suppressed while WiFi is reconnecting — never block `loop()`, use
  `millis()` timers.
- ESP32 → kiosk coin POST requires `x-coin-source`, `x-coin-api-key` (must equal
  `PRINTBIT_ESP32_COIN_API_KEY`), and `x-coin-event-id` (UUID per physical insertion).
- ESP32 hopper endpoints: `POST /hopper/dispense` (`token`, `coins`, optional `requestId`) and
  `GET /hopper/status?token=...`.

## Print dispatch modes (`PRINTBIT_PRINT_DISPATCH_MODE`)

| Mode       | Behavior                                                             |
| ---------- | -------------------------------------------------------------------- |
| `legacy`   | Sumatra PDF only                                                     |
| `phased`   | PDFtoPrinter → GhostScript, Sumatra emergency fallback |
| `new-only` | PDFtoPrinter → GhostScript only                        |

Binary paths and timeouts: see `agent_docs/print-dispatch.md`. LibreOffice first launch is
slow — keep `PRINTBIT_PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS` ≥ 60s in production.

## Kiosk lifecycle scripts (Windows PowerShell)

These scripts are launched via `pnpm run` wrappers in `package.json`:

- `pnpm run ensure-network` — verify ESP32 WiFi and reapply static IP
- `pnpm run install-startup` / `uninstall-startup` — register PrintBit at Windows startup
- `pnpm run watchdog:install` / `:uninstall` / `:verify` / `:run-once` — process watchdog
- `pnpm run lockdown:apply` / `:verify` / `:revert` — kiosk lockdown (Assigned Access)
- `pnpm run updates:apply` / `:verify` / `:revert` — controlled updates
- `pnpm run driver:verify` — verify printer driver version
- `pnpm run kiosk` — launch the kiosk UI shell
- `pnpm run db:reset` — wipe `printbit.sqlite` (destructive)

## Documentation by topic

For task-specific details, see:

| Topic                                         | File                                       |
| --------------------------------------------- | ------------------------------------------ |
| Routes, env vars, architecture changes        | `agent_docs/documentation-sync.md`         |
| Serial, ESP32 coin bridge, hopper integration | `agent_docs/hardware-integration.md`       |
| Print dispatch modes, binaries, spooler setup | `agent_docs/print-dispatch.md`             |
| Active in-progress areas (do not regress)     | `agent_docs/in-progress.md`                |
| API surface and request/response shapes       | `API_DOCUMENTATION.md`                     |
| High-level architecture and flows             | `ARCHITECTURE.md`                          |
| End-user guides + step-by-step                | `README.md`                                |
| Operations and runbooks                       | `OPERATIONS.md`                            |
| Windows install + dependencies                | `INSTALLATION_AND_DEPENDENCIES.md`         |
| Kiosk lockdown configuration                  | `WINDOWS_KIOSK_LOCKDOWN_SETUP.md`          |
| ESP32 + tablet kiosk deployment               | `WINDOWS_TABLET_ESP32_KIOSK_SETUP.md`      |
| Coin troubleshooting playbook                 | `ESP32_COIN_TROUBLESHOOTING.md`            |
| Production-readiness audit                    | `PRODUCTION_READINESS_AUDIT_2026-08-15.md` |

When you change routes, env vars, architecture, hardware integration, or operational
procedures, **update the matching doc in the same task** (see
`agent_docs/documentation-sync.md`).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:

- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
