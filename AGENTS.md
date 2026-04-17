# PrintBit - AI Agent Baseline Instructions

This file is the **canonical instruction baseline** for all AI coding agents working in this repository.

## 1) Scope and precedence

1. User request and explicit task constraints
2. Safety and platform constraints
3. This `AGENTS.md` baseline
4. Tool-specific overlays (for example `.github/copilot-instructions.md`)

If instructions conflict, follow the highest-priority rule and ask for clarification when needed.

## 2) Hard rules (non-negotiable)

1. **Never delete, reset, or directly mutate runtime state artifacts** unless the user explicitly asks:
   - `printbit.sqlite*`
   - `uploads/`
2. **Never commit, amend, or rewrite git history unless explicitly requested.**
3. **Never run destructive git/file commands** (for example `git reset --hard`, `git checkout -- <file>`, mass deletions) unless explicitly requested.
4. **Never write to SQLite files directly.** Use app persistence APIs and repository methods under `src/core/database/`.
5. **Do not bypass session/security checks** in upload, payment, and admin flows.
6. **Use `pnpm` only** for package/workspace commands (no `npm`, no `yarn`).

## 3) Standard execution workflow

1. Read relevant files first; do not guess architecture or behavior.
2. Make surgical, complete edits that solve the root request.
3. Preserve existing patterns (naming, layering, module boundaries).
4. Avoid unrelated refactors while implementing requested changes.
5. Surface blockers clearly instead of silently skipping behavior.

## 4) Validation and completion gates

For any **code** change (TypeScript/JavaScript/server/client/scripts):

1. Run type-check:
   - `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
2. If browser/client TS changed (anything under `src/public/**/*.ts`), also run:
   - `pnpm run build`

Current repo status:

- No dedicated test runner is configured yet.
- No lint config is configured yet.

## 5) Documentation sync contract

When behavior changes, update docs in the same task. This is mandatory for:

- Route/API changes
- Environment variable changes
- Architecture or flow changes (print/copy/scan/payment/session/hotspot/hopper)
- Operational runbook changes

Primary docs to keep aligned:

- `README.md`
- `ARCHITECTURE.md`
- `API_DOCUMENTATION.md`
- `OPERATIONS.md`
- `INSTALLATIONS.md`
- `WINDOWS_KIOSK_LOCKDOWN_SETUP.md`
- `WINDOWS_TABLET_ESP32_KIOSK_SETUP.md`

## 6) Current project context (active architecture)

PrintBit is a Windows kiosk app for coin-operated print/copy/scan.

- Backend: Node.js + Express + Socket.IO + TypeScript
- State: SQLite (`printbit.sqlite`) with repository helpers in `src/core/database/`
- Frontend: static HTML/CSS + TypeScript bundles under `src/public`
- Upload flow: wireless session-based, tokenized, single-device ownership, idle TTL
- Print payment: quote/confirm flow with settlement + change handling
- Print dispatch: mode-based (`legacy`, `phased`, `new-only`) with PDFtoPrinter/GhostScript/LibreOffice and optional Sumatra fallback
- Coin/hopper: serial/ESP32-integrated paths with idempotency/auth checks on coin bridge

## 7) High-signal repository map

- `src/server.ts` - app entrypoint
- `src/routes/` - HTTP/API/page route registration
- `src/services/` - domain services (serial, session, hotspot, scanner, dispatcher, settlement, admin, hopper)
- `src/core/database/` - DB facade and SQLite storage repositories
- `src/public/` - browser apps and pages
- `scripts/` - kiosk lifecycle/setup PowerShell and Node scripts
- `esp32-captive-portal.ino` - ESP32 captive portal and coin/hopper bridge firmware

## 8) Known in-progress areas (do not regress)

- Session lifecycle hardening and expiry UX
- ESP32 migration and bridge hardening
- Dispatch/spooler reliability and observability
- Kiosk watchdog/lockdown/controlled updates
- Security hardening for admin/payment/upload paths

## 9) Instruction maintenance triggers

Update this file whenever any of these change:

1. Build/typecheck commands or required flags
2. Route inventory/API contracts
3. Core architecture boundaries or service ownership
4. Runtime safety constraints (state artifacts, financial/session integrity)
5. Hardware integration model (serial/hopper/printer/scanner/ESP32)

## 10) Definition of done for AI agents

A task is complete only when:

1. Requested behavior is implemented or documented as blocked with a clear reason.
2. Required validation commands have been run for code changes.
3. Related documentation is updated when behavior/config/routes changed.
4. No forbidden destructive or state-corrupting actions were performed.
