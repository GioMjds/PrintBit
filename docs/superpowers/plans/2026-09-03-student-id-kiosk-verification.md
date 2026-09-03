# Student ID Kiosk Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require an active, locally verified Student ID session before a PrintBit kiosk can start or settle customer print, copy, or scan transactions.

**Architecture:** Keep ESP32 responsible for hotspot/DNS captive redirection and serve the identity portal from Node. Add an isolated `student-session` module backed by SQLite: it validates an HMAC-keyed allow-list, atomically claims the single kiosk, emits kiosk state over Socket.IO, and records durable transaction attribution. Existing wireless upload sessions remain independent and are never used as proof of student identity.

**Tech Stack:** Node.js 22, TypeScript, Express 5, Socket.IO 4, Node SQLite `DatabaseSync`, Jest, browser TypeScript bundles.

**Spec:** `STUDENT_ID_SESSION.md`

## Global Constraints

- V1 validates only the local admin-imported `student_id,active` roster; no university API, name, email, QR, barcode, NFC, or SSO integration.
- Normalize seven digits to `XXX-XXXX`; reject every other form before lookup.
- Persist only `HMAC-SHA256(PRINTBIT_STUDENT_ID_HMAC_SECRET, normalizedStudentId)`; raw IDs must not appear in SQLite, Socket.IO, worker payloads, browser storage, receipts, or routine logs.
- Fail startup when verification is enabled and `PRINTBIT_STUDENT_ID_HMAC_SECRET` is missing outside test mode.
- Exactly one active kiosk identity session is allowed. End it on explicit kiosk action, existing idle timeout, and process startup recovery.
- Keep C# worker contracts unchanged: only existing transaction/job identifiers cross the Node-worker boundary.

---

## File structure

- `src/modules/student-session/`: roster import, identity session lifecycle, portal/controller routes, and module registration.
- `src/core/database/models/student-session.model.ts`: SQLite queries and typed records for roster rows, sessions, and immutable transaction attributions.
- `src/middleware/student-session.ts`: reusable kiosk-request guard that resolves the active session and attaches its opaque ID to `res.locals`.
- `src/public/student-portal/`: phone-only ID entry/status page; `src/public/shared/student-session.ts` updates kiosk UI from Socket.IO and ends sessions on idle timeout.
- `tests/modules/student-session/` and `tests/middleware/`: service/controller/database and transaction-guard coverage; extend existing copy, scanner, and financial tests for enforcement.

### Task 1: Add secure configuration and SQLite persistence

**Files:**

- Modify: `src/config/http.config.ts`, `src/core/database/sqlite-storage.ts`
- Create: `src/core/database/models/student-session.model.ts`
- Test: `tests/core/database/student-session.model.spec.ts`, `tests/config/student-id-verification.spec.ts`

**Interfaces:**

- Produces `STUDENT_ID_VERIFICATION_ENABLED`, `STUDENT_ID_HMAC_SECRET`, `normalizeStudentId(raw): string | null`, and `studentSessionStore`.
- `studentSessionStore` exposes `replaceRoster(entries)`, `findActiveRosterEntry(studentIdHmac)`, `claimSession(input)`, `getActiveSession()`, `endSession(id, reason)`, `endAllActiveSessions(reason)`, and `attributeTransaction(input)`.

- [ ] **Step 1: Write failing configuration tests** for enabled mode without a secret, test-mode secret fallback, and `1234567` / `123-4567` normalization.
- [ ] **Step 2: Run the configuration test file** with `pnpm test -- tests/config/student-id-verification.spec.ts`; confirm the missing exports/tests fail.
- [ ] **Step 3: Add environment parsing** for `PRINTBIT_STUDENT_ID_VERIFICATION` (default `false`) and `PRINTBIT_STUDENT_ID_HMAC_SECRET`; throw at startup only when verification is enabled, not in `NODE_ENV=test`, and use `node:crypto.createHmac('sha256', secret)` for the lookup key.
- [ ] **Step 4: Write failing SQLite store tests** covering atomic roster replacement, active lookup, one-active-session conflict, explicit end, startup end-all, and one immutable attribution per transaction ID.
- [ ] **Step 5: Add the schema and model**: `student_roster(student_id_hmac PRIMARY KEY, active, imported_at)`, `student_kiosk_sessions(id PRIMARY KEY, student_id_hmac, status, started_at, ended_at, end_reason)`, and `student_transaction_attributions(transaction_id PRIMARY KEY, kiosk_session_id, student_id_hmac, operation, attributed_at)`. Add indexes for active session and attribution lookup; perform roster replacement and session claim within `withTransaction`.
- [ ] **Step 6: Export the store from `sqlite-storage.ts` and run both test files**; expected result: all persistence/configuration tests pass.
- [ ] **Step 7: Commit** with `git add src/config/http.config.ts src/core/database/sqlite-storage.ts src/core/database/models/student-session.model.ts tests/config/student-id-verification.spec.ts tests/core/database/student-session.model.spec.ts && git commit -m "feat: persist HMAC student kiosk sessions"`.

### Task 2: Implement roster import and student-session service

**Files:**

- Create: `src/modules/student-session/student-session.service.ts`, `src/modules/student-session/student-session.types.ts`
- Test: `tests/modules/student-session/student-session.service.spec.ts`

**Interfaces:**

- Consumes `studentSessionStore`, HMAC configuration, `SocketIOServer`, and `adminService.appendAdminLog`.
- Produces `StudentSessionService.identify(rawId)`, `getKioskState()`, `endActiveSession(reason)`, `requireActiveSession()`, `attributeTransaction(transactionId, operation)`, and `replaceRosterCsv(csvText)`.

- [ ] **Step 1: Write failing service tests** for valid active ID identification, invalid/inactive indistinguishable rejection, a competing claim returning `KIOSK_IN_USE`, CSV header/row validation, duplicate IDs after normalization, and no partial import after an invalid row.
- [ ] **Step 2: Run** `pnpm test -- tests/modules/student-session/student-session.service.spec.ts`; confirm it fails before implementation.
- [ ] **Step 3: Implement `identify`** to normalize, HMAC, check `active = 1`, atomically claim a new opaque UUID session, and emit `kiosk.session.started` with `{ sessionId, status: 'active' }`. Return only `{ ok: true, sessionId }` or `{ ok: false, code: 'IDENTIFICATION_FAILED' | 'KIOSK_IN_USE' }`.
- [ ] **Step 4: Implement CSV import** requiring exactly `student_id,active`, accepting `true`/`false` case-insensitively, normalizing every ID before HMAC, rejecting blank/invalid/duplicate rows, then calling one transactional roster replacement. Append an admin audit log with row counts and no ID-derived values.
- [ ] **Step 5: Implement session end/recovery and attribution** so ending emits `kiosk.session.ended` with opaque state, and attribution uses the currently active session’s stored HMAC without passing identity data into callers.
- [ ] **Step 6: Run the service tests** and commit with `git add src/modules/student-session tests/modules/student-session/student-session.service.spec.ts && git commit -m "feat: add student identity session service"`.

### Task 3: Expose portal, kiosk, and protected admin APIs

**Files:**

- Create: `src/modules/student-session/student-session.controller.ts`, `src/modules/student-session/student-session.module.ts`, `src/modules/student-session/index.ts`
- Modify: `src/app.module.ts`, `src/config/http.config.ts`, `src/modules/page/page.controller.ts`
- Test: `tests/modules/student-session/student-session.controller.spec.ts`

**Interfaces:**

- `POST /api/portal/identify` accepts `{ studentId: string }` and sets an HttpOnly, SameSite=Lax portal-status cookie containing only an opaque random token.
- `GET /api/portal/student-session` returns phone-safe status only; `GET /api/kiosk/student-session` and `POST /api/kiosk/student-session/end` require existing kiosk access middleware.
- `POST /api/admin/student-roster/import` requires `requireAdminLocalAccess` and `requireAdminPin` and accepts CSV upload/text according to the existing Multer/error pattern.

- [ ] **Step 1: Write controller tests** for successful identification cookie behavior, generic invalid-ID response, active-kiosk conflict, kiosk-only status/end authorization, and admin-local-plus-PIN roster import authorization.
- [ ] **Step 2: Run** `pnpm test -- tests/modules/student-session/student-session.controller.spec.ts`; confirm it fails.
- [ ] **Step 3: Implement routes and rate limiting** using the repository’s `createRateLimit` helper: 10 identify attempts per IP per minute; responses must set `Cache-Control: no-store`. Do not redirect portal callers to kiosk-only pages or expose another session’s data.
- [ ] **Step 4: Register the module in `registerAppModules`** and change `/portal` to serve the identity portal when verification is enabled, retaining the current upload-waiting page when disabled. Add the new portal assets to the explicit static/asset allow-list.
- [ ] **Step 5: Run controller tests and the existing captive-portal tests** with `pnpm test -- tests/modules/student-session/student-session.controller.spec.ts tests/middleware/captive-portal.spec.ts`.
- [ ] **Step 6: Commit** with `git add src/app.module.ts src/config/http.config.ts src/modules/page/page.controller.ts src/modules/student-session tests/modules/student-session/student-session.controller.spec.ts && git commit -m "feat: expose student verification portal APIs"`.

### Task 4: Add a central transaction identity guard and attribution hook

**Files:**

- Create: `src/middleware/student-session.ts`
- Modify: `src/app.module.ts`, `src/modules/financial/financial.module.ts`, `src/modules/copy/copy.module.ts`, `src/modules/scanner/scanner.module.ts`
- Test: `tests/middleware/student-session.spec.ts`, `tests/modules/financial/student-session-guard.spec.ts`, `tests/modules/copy/student-session-guard.spec.ts`, `tests/modules/scanner/student-session-guard.spec.ts`

**Interfaces:**

- `requireStudentSession(service): RequestHandler` returns `403 { code: 'STUDENT_IDENTIFICATION_REQUIRED' }` when enabled and no active session exists, otherwise sets `res.locals.studentKioskSessionId`.
- `attributeStudentTransaction(service, transactionId, operation)` is called immediately after each definitive transaction ID exists and before a charge, print dispatch, or scan charge can proceed.

- [ ] **Step 1: Write failing middleware tests** for disabled compatibility mode, enabled/no-session rejection, active-session pass-through, and a session ending between separate requests.
- [ ] **Step 2: Implement the middleware** without trusting any request-supplied session ID or portal cookie; resolve only the server-side active kiosk session.
- [ ] **Step 3: Attach the guard after existing kiosk-cookie middleware** to customer work routes: `/api/copy`, customer scan/create/charge routes, `/api/confirm-payment`, and legacy `/print`; leave read-only health/status/receipt endpoints unguarded.
- [ ] **Step 4: Write failing operation tests** asserting no worker queue handoff or balance debit occurs without identification, and asserting the final print transaction ID, copy job ID, and scan charge ID each receive exactly one attribution.
- [ ] **Step 5: Inject the service through financial/copy/scanner module dependencies** and invoke attribution at the existing transaction-ID creation points: payment confirmation before settlement/queue handoff, `CopyService.createCopyJob` after job creation, and `ScannerService.chargeSoftCopy` after `scan-*` ID creation.
- [ ] **Step 6: Run all guard tests** with `pnpm test -- tests/middleware/student-session.spec.ts tests/modules/financial/student-session-guard.spec.ts tests/modules/copy/student-session-guard.spec.ts tests/modules/scanner/student-session-guard.spec.ts`.
- [ ] **Step 7: Commit** with `git add src/middleware/student-session.ts src/app.module.ts src/modules/financial src/modules/copy src/modules/scanner tests/middleware/student-session.spec.ts tests/modules/financial/student-session-guard.spec.ts tests/modules/copy/student-session-guard.spec.ts tests/modules/scanner/student-session-guard.spec.ts && git commit -m "feat: require student session for transactions"`.

### Task 5: Build phone portal and kiosk unlock/end-session UX

**Files:**

- Create: `src/public/student-portal/index.html`, `src/public/student-portal/app.ts`, `src/public/student-portal/styles.css`, `src/public/shared/student-session.ts`
- Modify: `src/public/index.html`, `src/public/app.ts`, `src/public/print/app.ts`, `src/public/copy/app.ts`, `src/public/scan/app.ts`, `src/public/confirm/app.ts`, `src/services/idle-timeout.ts`
- Test: `tests/public/student-session.spec.ts`, `tests/public/student-portal.spec.ts`

**Interfaces:**

- Phone portal submits `{ studentId }` to `/api/portal/identify`, formats digits as `XXX-XXXX`, and renders only success, generic rejection, or kiosk-in-use status.
- `initializeStudentSessionKiosk(options)` subscribes to `kiosk.session.started`/`kiosk.session.ended`, queries kiosk session state on load, blocks navigation while inactive, and exposes `endStudentSession(reason)`.

- [ ] **Step 1: Write failing UI helper tests** for socket-driven lock/unlock, initial state fetch, guarded navigation, and an end action calling the kiosk endpoint once.
- [ ] **Step 2: Implement the phone portal** with accessible label/error/live-status elements, input normalization, disabled repeat submission, `no-store` fetch handling, and no use of localStorage/sessionStorage for identity state.
- [ ] **Step 3: Implement kiosk state helper** and integrate it with the existing home idle overlay: inactive kiosks show the Wi-Fi QR/start instruction and cannot open print/copy/scan; an active session reveals existing actions plus a visible End session control.
- [ ] **Step 4: Extend page idle timeout callbacks** so timeout first posts `/api/kiosk/student-session/end` with `{ reason: 'idle_timeout' }`, then performs each page’s existing cleanup/navigation. Explicit end uses `{ reason: 'user_ended' }`.
- [ ] **Step 5: Add phone portal tests** for masking/formatting and generic errors; run `pnpm test -- tests/public/student-session.spec.ts tests/public/student-portal.spec.ts`.
- [ ] **Step 6: Run the production bundle** with `pnpm run build` and commit with `git add src/public src/services/idle-timeout.ts tests/public/student-session.spec.ts tests/public/student-portal.spec.ts && git commit -m "feat: unlock kiosk after student verification"`.

### Task 6: Add admin roster management and masked transaction context

**Files:**

- Modify: `src/modules/admin/admin.controller.ts`, `src/modules/admin/admin.service.ts`, `src/public/admin/settings/index.html`, `src/public/admin/settings/app.ts`, `src/public/admin/transactions/app.ts`
- Test: `tests/modules/admin/student-roster.spec.ts`, `tests/modules/admin/student-transaction-context.spec.ts`, `tests/public/admin-student-roster.spec.ts`

**Interfaces:**

- Admin import UI posts the selected CSV to the protected roster endpoint and displays accepted/disabled row counts only.
- Transaction-context response gains optional `{ studentSession: { id, status, studentIdMasked } }`; `studentIdMasked` is the fixed text `Student verified` in HMAC-only V1, not a suffix derived from the ID.

- [ ] **Step 1: Write failing admin API tests** for protected import, audit metadata that excludes IDs/HMACs, and transaction context resolving an attribution without exposing sensitive identity values.
- [ ] **Step 2: Add the settings-page CSV import control** with accepted file type `.csv`, clear success/error copy, and no client-side parsing or retained roster data.
- [ ] **Step 3: Extend transaction context lookup** to join the attribution/session record by transaction ID and return only opaque session state plus `Student verified`.
- [ ] **Step 4: Add tests for the settings UI payload and transaction drawer rendering**, then run all three admin test files.
- [ ] **Step 5: Commit** with `git add src/modules/admin src/public/admin/settings src/public/admin/transactions tests/modules/admin/student-roster.spec.ts tests/modules/admin/student-transaction-context.spec.ts tests/public/admin-student-roster.spec.ts && git commit -m "feat: manage student roster and transaction context"`.

### Task 7: Validate startup recovery, privacy, and end-to-end behavior

**Files:**

- Create: `tests/integration/student-id-kiosk-flow.spec.ts`
- Modify: `README.md` or the existing deployment/environment documentation that lists required `PRINTBIT_*` values

- [ ] **Step 1: Write an integration test** that imports a roster, identifies an active student through the portal, observes `kiosk.session.started`, completes a representative print/copy/scan transaction, verifies attribution, ends the session, and confirms the next customer action is rejected.
- [ ] **Step 2: Add restart recovery coverage**: seed an active session, initialize the app, verify the session becomes ended with `server_restart`, and verify the kiosk starts locked.
- [ ] **Step 3: Add a privacy assertion suite** asserting the entered raw ID is absent from SQLite, Socket.IO payloads, admin logs, receipt payloads, and worker queue inputs. Assert the HMAC appears only in the three new SQLite tables and is absent from Socket.IO, logs, receipts, browser/API responses, and worker queue inputs.
- [ ] **Step 4: Document configuration and operator flow**: generate a high-entropy `PRINTBIT_STUDENT_ID_HMAC_SECRET`, enable verification only after importing a roster, and rotate the secret only with a fresh roster re-import because stored HMACs become invalid.
- [ ] **Step 5: Run focused feature tests** with `pnpm test -- tests/core/database/student-session.model.spec.ts tests/modules/student-session tests/middleware/student-session.spec.ts tests/integration/student-id-kiosk-flow.spec.ts`.
- [ ] **Step 6: Run quality gates**: `pnpm run lint`, `pnpm run build`, and `pnpm test`.
- [ ] **Step 7: Inspect the staged diff for scope and literal secret values**: stage only the named integration test and documentation, run `git diff --cached --check`, then verify no `.env` file or deployment secret is staged before committing `test: cover student identity kiosk flow`. Use a fixture-only test secret.

## Acceptance checklist

- A hotspot-connected phone reaches `/portal`, enters a roster-active Student ID, and unlocks the tablet without any tablet-side sign-in.
- A kiosk can never perform customer work without an active student session while verification is enabled.
- A second phone cannot replace an active student session; timeout, explicit end, and restart restore the locked state.
- Every print, copy, and paid scan has exactly one durable attribution record, and no raw/recoverable student identifier reaches the C# worker or public/admin output.
- Invalid CSV imports do not alter the last valid roster, and all roster changes require local admin access plus a valid PIN.
