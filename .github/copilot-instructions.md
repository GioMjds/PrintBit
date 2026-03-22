# PrintBit Web — Copilot Instructions

## Build, Test, and Lint Commands

| Command | Purpose |
|---|---|
| `pnpm install` | Install all dependencies |
| `pnpm run dev` | Run kiosk server in dev mode (TypeScript via `ts-node-dev`) |
| `pnpm run build` | Compile `src/public/app.ts` → `src/public/bundle.js` (browser bundle) |
| `pnpm exec tsc --noEmit` | Type-check server + client TypeScript without emitting |

> ⚠️ **After any change to `src/public/app.ts`** or any browser-side TypeScript, always run `pnpm run build` to regenerate `bundle.js`. The bundle is committed to the repo and loaded directly by HTML — it is not auto-rebuilt in dev mode.

- **Tests:** No test runner is currently configured. Jest or Vitest are recommended for this stack when tests are introduced.
- **Lint:** No ESLint config is currently configured. `eslint` with `@typescript-eslint` is recommended.
- **Package manager:** Always use `pnpm` (not `npm` or `yarn`). The repo uses `pnpm-workspace.yaml`.

---

## Repository File & Directory Layout

```text
printbit/
├── .github/
│   └── copilot-instructions.md
├── scripts/              # Shell/bash scripts for setup and kiosk lifecycle (see below)
├── src/
│   ├── server.ts         # Express + HTTP + Socket.IO entrypoint
│   ├── core/
│   │   └── database/
│   │       ├── db.ts          # Shared schema/runtime database facade (SQLite runtime_state)
│   │       └── sqlite-storage.ts  # SQLite persistence for operational domains
│   ├── services/
│   │   ├── serial.ts     # Coin acceptor hardware via serialport
│   │   ├── printer.ts    # OS print dispatch
│   │   └── session.ts    # Upload session tokens + MIME type enforcement
│   ├── routes/           # Express route handlers (print, upload, etc.)
│   └── public/
│       ├── app.ts        # Browser-side kiosk logic → compiled to bundle.js
│       ├── bundle.js     # Committed compiled output — never hand-edit
│       ├── globals.css   # Global styles
│       ├── *.html        # Kiosk UI pages (one per workflow)
│       └── *.css         # Component styles co-located with their *.ts modules
├── uploads/              # Runtime multer upload destination
├── printbit.sqlite       # Runtime SQLite database (state, feedback, reports, logs)
├── PRINTBIT_NOTES.txt    # Developer notes and operational reminders
├── PRINTBIT_PRINTING_FLOW.md  # Full end-to-end printing flow documentation
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.json
```

> `uploads/` and `printbit.sqlite*` are **runtime state artifacts**. Do not destructively modify or delete these paths during feature work; they hold live kiosk state.

---

## Scripts Directory (`scripts/`)

The `scripts/` directory contains **shell/bash scripts** for environment setup and kiosk lifecycle management. These run on the host machine (e.g. Raspberry Pi or deployment box) — they are not part of the Node.js runtime.

- **Convention:** All scripts should be **idempotent** (safe to re-run) and include inline comments explaining each step.
- Do not `require()` or `import` shell scripts from any Node.js or TypeScript module.
- Update this section as new scripts are added, documenting their name and purpose.

---

## High-Level Architecture

### Server Entrypoint — `src/server.ts`
Initializes Express + HTTP + Socket.IO, serves static files from `src/public` (and `dist/public`), and listens on `0.0.0.0:3000`.

### Money / Balance State — `src/services/db.ts`
Uses **LowDB** with `db.json` storing `{ balance, earnings }`. This state object is shared across route handlers and serial event callbacks. Always persist via the LowDB write methods — never write `db.json` directly.

### Coin Hardware Flow — `src/services/serial.ts`
Auto-selects the first available serial port at **9600 baud**, parses incoming data as integer coin values, increments `db.data.balance`, persists to `db.json`, and emits a live `balance` update over Socket.IO to all connected clients.

> **Port selection note:** Auto-detection works for single-port setups. If multiple serial ports exist on the host, the first enumerated port wins. Consider adding an explicit `SERIAL_PORT` environment variable if multi-port ambiguity becomes an issue.

### Print Flow — `src/routes/` (`POST /print`)
1. Validates that current `balance` meets the minimum threshold (see **Pricing** below).
2. Dispatches the file to the OS printer via `src/services/printer.ts`.
3. Transfers `balance` → `earnings`, resets `balance` to `0`.
4. Persists updated state to `db.json`.
5. Emits `balance = 0` over Socket.IO.

### Upload & Session Flow — `src/routes/` (`POST /upload`) + `src/services/session.ts`
The session-based upload flow is **fully wired into routes**. It handles:
- **Session tokens** — uploads require a valid session token.
- **MIME type allowlist** — only permitted file types are accepted.
- **Size limit** — 25 MB maximum per upload.
- Files are stored in `uploads/` via multer.

> Do not bypass the session token check when adding new upload-adjacent routes or modifying the upload handler.

### Frontend — `src/public/`
Static HTML pages served directly. `src/public/app.ts` (compiled → `bundle.js`) is responsible for:
- Kiosk page navigation
- Socket.IO connection and live `balance` rendering
- Binding all UI button interactions via stable element IDs (see below)

---

## UI Element ID Conventions

The following element IDs are **required by `app.ts`**. Do not rename or remove them without updating the corresponding `app.ts` bindings:

| Element ID | Role |
|---|---|
| `openPrintBtn` | Launches the print workflow |
| `openCopyBtn` | Launches the copy workflow |
| `openScanBtn` | Launches the scan workflow |
| `openSettingsBtn` | Opens the settings panel |
| `powerOffBtn` | Triggers kiosk power-off / OS shutdown |
| `balance` | Live balance display node (value set by Socket.IO `balance` events) |

When adding new kiosk actions, follow this pattern: define a stable element ID in HTML, bind it in `app.ts`, and document it in this table.

---

## Socket.IO Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `balance` | Server → Client | `number` | Emitted on every coin insert and after print resets balance to `0` |

> Emit real-time events from the relevant **service** module (e.g. `serial.ts`, `db.ts`), not directly inside route handlers. Document new events in this table.

---

## Route Inventory

| Method | Path | Auth / Guard | Description |
|---|---|---|---|
| `POST` | `/print` | Minimum balance check | Validates balance, dispatches print job, resets state |
| `POST` | `/upload` | Session token + MIME check | Accepts file, enforces 25 MB limit, stores in `uploads/` |

> Update this table whenever new routes are added or existing ones change their guard conditions.

---

## Print Pricing

The minimum balance threshold required to trigger a print job lives in the `POST /print` route handler.

- The original hardcoded value was `5` (coin units).
- **This value has since been updated.** Always check the current route code before building any feature that depends on pricing logic.
- If pricing becomes configurable (per page, per document type, etc.), consider moving the threshold into `db.json` or a dedicated config file rather than hardcoding it in route logic.

---

## Key Repository Conventions

- **Backend vs. browser separation:** Keep all backend runtime code in `src/` (outside `src/public/`). Never import browser-only APIs or code into server modules.
- **CSS co-location:** Global styles → `src/globals.css`. Component styles → `*.css` files next to their corresponding `*.ts` module in `src/public/`.
- **TypeScript config:** Strict mode, CommonJS modules (`tsconfig.json`). New modules must follow the existing import/export style and pass strict type checking.
- **Bundle is committed:** `src/public/bundle.js` is checked into the repo. Run `pnpm run build` before every commit that touches browser TypeScript.
- **No direct SQLite file writes:** Always use the application's SQLite persistence APIs (`getSqliteDb()` and repository methods in `src/core/database/sqlite-storage.ts`) to mutate and persist state. Never write to `printbit.sqlite` directly.
- **pnpm only:** Never use `npm` or `yarn` commands in this repo.

---

## Known In-Progress / Pending Areas

Track these gaps when working on new features:

- [ ] **Test framework** — No test runner is configured. Add Jest or Vitest with `ts-jest` / native TS support.
- [ ] **Lint config** — No ESLint config exists. Add `eslint` + `@typescript-eslint/recommended` + `prettier`.
- [ ] **Serial port config** — Auto-detection is fragile on multi-port hosts. Add a `SERIAL_PORT` env variable as an override.
- [ ] **Print pricing** — Threshold value changed from its original `5`; verify and document the current value explicitly.
- [ ] **Session token lifecycle** — Document token expiry, renewal, and invalidation behavior as the session flow matures.
- [ ] **Error handling** — Confirm that print failures and serial errors surface to the frontend via Socket.IO rather than silently failing.

---
