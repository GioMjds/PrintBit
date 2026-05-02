# PrintBit — Agent Instructions

PrintBit is a **Windows-only** coin-operated self-service printing kiosk for campus environments.
Users upload files via QR-initiated hotspot; the kiosk handles coin payment, job dispatch,
change dispensing, and receipt generation. This is a hardware-integrated system—coin flow, payment
safety, and hardware synchronization are first-class concerns, not afterthoughts.

## Stack

- **Backend:** Node.js + Express + Socket.IO + TypeScript (strict mode)
- **Storage:** SQLite via repository pattern (`src/core/database/`)
- **Frontend:** Static HTML/CSS + TypeScript bundles → `src/public/`
- **Hardware:** `serialport` (coin/hopper), ESP32 HTTP bridge (STA mode, WiFiManager)
- **Print dispatch:** PDFtoPrinter / GhostScript / LibreOffice (mode-gated by env var)
- **Package manager:** `pnpm` (not `npm` or `yarn`)

## Critical Context

**Database access:** All DB operations go through repository methods in `src/core/database/`—never
mutate `printbit.sqlite*` directly. This ensures audit trails, transaction safety, and idempotency
for coin events.

**Payment & coin idempotency:** Every coin event from the ESP32 bridge carries `x-coin-event-id`;
idempotency checks prevent duplicate deposits. Never remove or bypass these checks.

**Session & admin security:** Authentication uses argon2id + httpOnly cookies + account lockout.
Never bypass or weaken session checks.

## Build & Verify

```bash
# Type-check (required after any .ts change)
pnpm exec tsc --noEmit --ignoreDeprecations 6.0

# Build browser bundles (required after src/public/**/*.ts changes)
pnpm run build
```

No test runner or lint config active yet.

## Documentation by Topic

For task-specific details, see:

| Topic                                         | File                                 |
| --------------------------------------------- | ------------------------------------ |
| Routes, env vars, architecture changes        | `agent_docs/documentation-sync.md`   |
| Serial, ESP32 coin bridge, hopper integration | `agent_docs/hardware-integration.md` |
| Print dispatch modes, binaries, spooler setup | `agent_docs/print-dispatch.md`       |
| Active in-progress areas (do not regress)     | `agent_docs/in-progress.md`          |
