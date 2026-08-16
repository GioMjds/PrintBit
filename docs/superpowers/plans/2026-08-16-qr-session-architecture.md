# QR Code Per-Session Kiosk Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the QR code per-session architecture for PrintBit, replacing legacy multi-QR flows with a single WiFi QR + 6-digit PIN pairing state machine, synchronized kiosk/mobile views, direct local uploads, and automated coin balance escrow/change dispensing.

**Architecture:** The Node.js Express + Socket.IO backend (`192.168.4.2:3000`) serves as the single authority for session state (`IDLE` $\rightarrow$ `PAIRING` $\rightarrow$ `ACTIVE` $\rightarrow$ `ENDING` $\rightarrow$ `IDLE`), issuing 120s TTL PINs and signed `sessionToken`s. The ESP32 (`192.168.4.1`) operates as a lightweight SoftAP, Captive Portal redirector, and hardware bridge. The kiosk UI provides an on-screen touch numpad in `IDLE` state, unlocking Print/Copy/Scan and auto change dispensing in `ACTIVE`/`ENDING` states.

**Tech Stack:** Node.js, Express 5, TypeScript, Socket.IO, SQLite repository pattern, Vanilla HTML/CSS/TS browser bundles (esbuild), Arduino/C++ (ESP32).

## Global Constraints

- Windows-only kiosk deployment environment.
- All database operations MUST go through repository methods in `src/core/database/`—never mutate SQLite directly.
- Every coin pulse carries `x-coin-event-id` for idempotent balance ledger crediting.
- Only ONE customer session can be `ACTIVE` at any given time.
- All heavy uploads/downloads flow directly between mobile browser and Kiosk backend (`192.168.4.2:3000`), never through the ESP32.
- Admin routes (`/admin`) remain strictly isolated from customer pairing state.

---

### Task 1: Session State Machine & Pairing Lifecycle Store

**Files:**

- Modify: `src/services/session/types.ts`
- Modify: `src/modules/wireless-session/wireless-session.service.ts`
- Test: `tests/services/wireless-session-statemachine.spec.ts`

**Interfaces:**

- Consumes: `SessionStore`, `Server` (Socket.IO)
- Produces:
  - `KioskSessionState = 'IDLE' | 'PAIRING' | 'ACTIVE' | 'ENDING'`
  - `requestPairing(clientIp?: string): { pairingId: string; pin: string; expiresIn: number } | { error: 'KIOSK_BUSY' }`
  - `verifyPairingPin(pin: string): { success: boolean; sessionToken?: string; sessionId?: string; error?: string }`
  - `getPairingStatus(pairingId: string): { status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED'; sessionToken?: string; portalUrl?: string }`
  - `endActiveSession(reason: string): Promise<{ success: boolean; dispensedChange: number }>`

- [ ] **Step 1: Write the failing unit tests for state transitions and PIN pairing**

Create `tests/services/wireless-session-statemachine.spec.ts`:

```typescript
import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';
import type { Server } from 'socket.io';

describe('WirelessSessionService State Machine & Pairing', () => {
  let service: WirelessSessionService;
  let mockIo: Partial<Server>;

  beforeEach(() => {
    mockIo = {
      emit: jest.fn(),
      to: jest.fn().mockReturnThis(),
    };
    service = new WirelessSessionService({
      io: mockIo as Server,
      sessionStore: {} as any,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
    });
  });

  it('should start in IDLE state', () => {
    expect(service.getKioskState()).toBe('IDLE');
  });

  it('should generate a 6-digit PIN on pairing request and transition to PAIRING', () => {
    const result = service.requestPairing('192.168.4.5');
    expect('pin' in result).toBe(true);
    if ('pin' in result) {
      expect(result.pin).toMatch(/^\d{6}$/);
      expect(result.expiresIn).toBe(120);
      expect(service.getKioskState()).toBe('PAIRING');
    }
  });

  it('should reject pairing request when already in ACTIVE state', () => {
    const req1 = service.requestPairing('192.168.4.5');
    if ('pin' in req1) {
      service.verifyPairingPin(req1.pin);
    }
    expect(service.getKioskState()).toBe('ACTIVE');

    const req2 = service.requestPairing('192.168.4.6');
    expect(req2).toEqual({ error: 'KIOSK_BUSY' });
  });

  it('should verify correct PIN and transition to ACTIVE state with signed token', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      const verify = service.verifyPairingPin(req.pin);
      expect(verify.success).toBe(true);
      expect(verify.sessionToken).toBeDefined();
      expect(service.getKioskState()).toBe('ACTIVE');
    }
  });

  it('should reject invalid PIN and stay in current state', () => {
    service.requestPairing('192.168.4.5');
    const verify = service.verifyPairingPin('000000');
    expect(verify.success).toBe(false);
    expect(verify.error).toBe('INVALID_PIN');
    expect(service.getKioskState()).toBe('PAIRING');
  });

  it('should return pairing status with portalUrl when active', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
      const status = service.getPairingStatus(req.pairingId);
      expect(status.status).toBe('ACTIVE');
      expect(status.portalUrl).toContain('/portal?token=');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/services/wireless-session-statemachine.spec.ts`
Expected: FAIL with missing methods (`getKioskState`, `requestPairing`, `verifyPairingPin`, etc.)

- [ ] **Step 3: Implement the State Machine and Pairing Store logic**

Update `src/services/session/types.ts` and `src/modules/wireless-session/wireless-session.service.ts`:

- Define `KioskSessionState`, `PairingRequestRecord`, `ActiveCustomerSession`.
- Implement `requestPairing`, `verifyPairingPin`, `getPairingStatus`, `endActiveSession`, `validateSessionToken`.
- Add cryptographic token generation via `node:crypto` (`randomBytes(32).toString('hex')`).
- Add automatic 120s TTL cleanup interval for stale pending pairing requests.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/services/wireless-session-statemachine.spec.ts`
Expected: PASS (6 tests passing)

- [ ] **Step 5: Commit changes**

```bash
git add src/services/session/types.ts src/modules/wireless-session/wireless-session.service.ts tests/services/wireless-session-statemachine.spec.ts
git commit -m "feat(session): add kiosk state machine and pairing PIN lifecycle"
```

---

### Task 2: Pairing & Session HTTP Endpoints and Socket.IO Controller

**Files:**

- Modify: `src/modules/wireless-session/wireless-session.controller.ts`
- Modify: `src/modules/wireless-session/wireless-session.module.ts`
- Modify: `src/server.ts`
- Test: `tests/controllers/pairing-controller.spec.ts`

**Interfaces:**

- Consumes: `WirelessSessionService`
- Produces:
  - `GET /api/pairing/request`
  - `POST /api/pairing/verify`
  - `GET /api/pairing/status/:pairingId`
  - `POST /api/session/mode`
  - `POST /api/session/end`

- [ ] **Step 1: Write controller integration tests**

Create `tests/controllers/pairing-controller.spec.ts`:

```typescript
import request from 'supertest';
import express from 'express';
import { WirelessSessionController } from '../../src/modules/wireless-session/wireless-session.controller';
import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';

describe('WirelessSessionController Pairing Routes', () => {
  let app: express.Express;
  let service: WirelessSessionService;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    service = new WirelessSessionService({
      io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } as any,
      sessionStore: {} as any,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
    });
    const controller = new WirelessSessionController(service);
    app.use('/api', controller.router);
  });

  it('GET /api/pairing/request generates PIN and pairingId', async () => {
    const res = await request(app).get('/api/pairing/request');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.pin).toMatch(/^\d{6}$/);
    expect(res.body.pairingId).toBeDefined();
  });

  it('POST /api/pairing/verify validates PIN', async () => {
    const reqRes = await request(app).get('/api/pairing/request');
    const pin = reqRes.body.pin;

    const verifyRes = await request(app)
      .post('/api/pairing/verify')
      .send({ pin });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.sessionId).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/controllers/pairing-controller.spec.ts`
Expected: FAIL with 404 on `/api/pairing/request`

- [ ] **Step 3: Implement controller endpoints and router registration**

In `src/modules/wireless-session/wireless-session.controller.ts`:

- Add route handlers for `/pairing/request`, `/pairing/verify`, `/pairing/status/:pairingId`, `/session/mode`, `/session/end`.
- Add `sessionTokenAuthGuard` middleware protecting `/session/upload`, `/session/mode`, `/session/end`, and `/session/download`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/controllers/pairing-controller.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/modules/wireless-session/wireless-session.controller.ts src/modules/wireless-session/wireless-session.module.ts src/server.ts tests/controllers/pairing-controller.spec.ts
git commit -m "feat(api): add pairing and session state REST endpoints"
```

---

### Task 3: Coin Gating & Automatic Change Dispensing on Session Teardown

**Files:**

- Modify: `src/services/coin-bridge.ts`
- Modify: `src/modules/wireless-session/wireless-session.service.ts`
- Modify: `src/modules/hopper/hopper.service.ts`
- Test: `tests/services/session-coin-safety.spec.ts`

**Interfaces:**

- Consumes: `withBalanceLock`, `hopperService.dispenseCoins()`
- Produces:
  - `handleIncomingCoin(amount: number, eventId: string): { accepted: boolean; newBalance: number }`
  - `teardownSessionAndRefund(sessionId: string): Promise<{ refunded: number; success: boolean }>`

- [ ] **Step 1: Write tests for coin deposit gating and auto-refund**

Create `tests/services/session-coin-safety.spec.ts`:

```typescript
import { WirelessSessionService } from '../../src/modules/wireless-session/wireless-session.service';

describe('Coin Gating & Auto Change Dispensing', () => {
  let service: WirelessSessionService;

  beforeEach(() => {
    service = new WirelessSessionService({
      io: { emit: jest.fn(), to: jest.fn().mockReturnThis() } as any,
      sessionStore: {} as any,
      resolvePublicBaseUrl: () => new URL('http://192.168.4.2:3000'),
      convertToPdfPreview: jest.fn(),
    });
  });

  it('rejects coin credit when kiosk is IDLE', () => {
    const result = service.handleIncomingCoin(5, 'evt_1001');
    expect(result.accepted).toBe(false);
    expect(result.newBalance).toBe(0);
  });

  it('accepts and credits coin deposit when kiosk is ACTIVE', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }
    const result = service.handleIncomingCoin(5, 'evt_1002');
    expect(result.accepted).toBe(true);
    expect(result.newBalance).toBe(5);
  });

  it('prevents duplicate deposits with identical coin event IDs', () => {
    const req = service.requestPairing('192.168.4.5');
    if ('pin' in req) {
      service.verifyPairingPin(req.pin);
    }
    service.handleIncomingCoin(5, 'evt_1003');
    const dupResult = service.handleIncomingCoin(5, 'evt_1003');
    expect(dupResult.accepted).toBe(false);
    expect(dupResult.newBalance).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/services/session-coin-safety.spec.ts`
Expected: FAIL

- [ ] **Step 3: Implement coin gating, deposit idempotency check, and auto-dispense hook**

- Update `handleIncomingCoin` to check `this.kioskState === 'ACTIVE'`.
- Store processed `coinEventIds` set in memory/SQLite.
- Integrate `endActiveSession` with `hopperService.dispenseCoins()` when `balance > 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/services/session-coin-safety.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit changes**

```bash
git add src/services/coin-bridge.ts src/modules/wireless-session/wireless-session.service.ts src/modules/hopper/hopper.service.ts tests/services/session-coin-safety.spec.ts
git commit -m "feat(hardware): enforce session coin gating and auto change dispense"
```

---

### Task 4: Kiosk Touchscreen Frontend Redesign (IDLE vs ACTIVE UI & Touch Numpad)

**Files:**

- Modify: `src/public/index.html`
- Modify: `src/public/app.ts`
- Modify: `src/public/styles.css`
- Modify: `src/public/globals.css`

**Interfaces:**

- Consumes: `/api/pairing/verify`, Socket.IO events (`kiosk:state_changed`, `balance:updated`, `session:ended`)
- Produces: Touch-interactive UI switching dynamically between `#idleContainer` and `#activeContainer`.

- [ ] **Step 1: Update `src/public/index.html` structure**

Add:

- `#idleContainer`: Single WiFi QR card, 6-digit PIN input slots (`.pin-slot`), on-screen touch numpad (`.touch-numpad` with `0-9`, `Clear`, `Enter`), and instructional header.
- `#activeContainer`: Session countdown badge, `[Finish / Exit]` button, unlocked Action Cards (Print, Copy, Scan), and deposited balance footer.

- [ ] **Step 2: Update `src/public/styles.css`**

Add styling for:

- `.pin-input-container`, `.pin-slot.active`, `.pin-slot.filled`.
- `.touch-numpad`, `.numpad-btn`, `.numpad-btn--action`, `.numpad-btn--clear`.
- `.shake-animation` for invalid PIN entry feedback.
- `.active-session-header`, `.countdown-pill`.

- [ ] **Step 3: Implement PIN entry and state handling in `src/public/app.ts`**

- Manage active PIN buffer (`enteredPin = ''`).
- Handle clicks on on-screen numpad buttons and physical keyboard keydown events.
- On 6 digits or Enter click, invoke `fetch('/api/pairing/verify', { method: 'POST', body: JSON.stringify({ pin }) })`.
- On success: transition UI to `#activeContainer`.
- On error: trigger shake animation, reset PIN slots, and display error toast.
- Listen for Socket.IO `session:ended` / `kiosk:reset` to transition back to `#idleContainer`.

- [ ] **Step 4: Build browser bundle and verify type-safety**

Run: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
Run: `pnpm run build`
Expected: Zero type errors, bundle files successfully generated.

- [ ] **Step 5: Commit changes**

```bash
git add src/public/index.html src/public/app.ts src/public/styles.css src/public/globals.css
git commit -m "feat(frontend): implement kiosk idle pairing UI with touch numpad and active session transitions"
```

---

### Task 5: Direct Phone Customer Portal (`/portal`) & Scan Download Flow

**Files:**

- Modify: `src/public/upload/portal.html`
- Modify: `src/public/upload/portal.ts`
- Modify: `src/modules/scanner/scanner.controller.ts`

**Interfaces:**

- Consumes: `GET /portal?token=...`, Socket.IO room `session_${token}`
- Produces: Mobile document upload dropzone, live print configuration, and scan download endpoint (`GET /session/download?token=...`).

- [ ] **Step 1: Update customer portal mobile client (`src/public/upload/portal.ts`)**

- Extract `token` from URL query parameter (`?token=...`).
- Authenticate Socket.IO connection with `{ auth: { token } }`.
- Handle incoming `session:mode_changed`:
  - When `mode === 'PRINT'`: Display file picker & upload dropzone.
  - When `mode === 'SCAN'`: Display "Scanning in progress on kiosk...".
  - When `mode === 'COPY'`: Display "Copying in progress on kiosk...".
- Handle `session:scan_ready`: Display direct download button (`/session/download?token=...`).
- Handle `session:ended`: Display session summary / receipt and thank you screen.

- [ ] **Step 2: Protect and implement `/session/download` in `src/modules/scanner/scanner.controller.ts`**

- Validate `x-session-token` against active session.
- Stream merged scanned PDF/JPEG with `Content-Disposition: attachment; filename="PrintBit_Scan_<timestamp>.pdf"`.

- [ ] **Step 3: Build browser bundle and verify type-safety**

Run: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
Run: `pnpm run build`
Expected: Build success.

- [ ] **Step 4: Commit changes**

```bash
git add src/public/upload/portal.html src/public/upload/portal.ts src/modules/scanner/scanner.controller.ts
git commit -m "feat(portal): implement mobile customer portal with real-time mode sync and scan download"
```

---

### Task 6: ESP32 Captive Portal Firmware Update

**Files:**

- Modify: `esp32-captive-portal.ino`

**Interfaces:**

- Consumes: ESP32 WiFi SoftAP, DNS server (captive portal 302 redirect), HTTPClient
- Produces: Captive portal displaying pairing PIN fetched from `http://192.168.4.2:3000/api/pairing/request` and auto-redirecting to `http://192.168.4.2:3000/portal?token=...` on `ACTIVE` status.

- [ ] **Step 1: Update Captive Portal HTTP Handler in `esp32-captive-portal.ino`**

- When a client connects and requests DNS / HTTP portal:
  - ESP32 queries Kiosk Backend `GET http://192.168.4.2:3000/api/pairing/request?ip=<clientIp>`.
  - ESP32 serves lightweight embedded HTML displaying:
    - PrintBit Logo & WiFi connected badge.
    - Large PIN display: `Your Pairing PIN: 483921`.
    - Instructions: _"Enter this 6-digit PIN on the kiosk touchscreen to start."_
    - Polling JavaScript fetching `http://192.168.4.2:3000/api/pairing/status/<pairingId>` every 1500ms.
    - On `ACTIVE` status: Automatic `window.location.href = data.portalUrl` + visible _"Tap to Open Customer Portal"_ button.

- [ ] **Step 2: Commit firmware changes**

```bash
git add esp32-captive-portal.ino
git commit -m "feat(esp32): update captive portal firmware for 6-digit PIN pairing and auto-redirect"
```

---

### Task 7: End-to-End Integration Verification & Documentation Sync

**Files:**

- Modify: `agent_docs/documentation-sync.md`
- Modify: `agent_docs/hardware-integration.md`
- Modify: `agent_docs/print-dispatch.md`

- [ ] **Step 1: Run full automated test suite**

Run: `pnpm test`
Expected: All test suites pass.

- [ ] **Step 2: Run complete TypeScript typecheck**

Run: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
Expected: 0 errors.

- [ ] **Step 3: Run production build**

Run: `pnpm run build`
Expected: Both client and server bundles build successfully.

- [ ] **Step 4: Sync documentation files**

Update `agent_docs/documentation-sync.md`, `agent_docs/hardware-integration.md`, and `agent_docs/print-dispatch.md` reflecting the new single QR + PIN pairing architecture.

- [ ] **Step 5: Final commit**

```bash
git add agent_docs/
git commit -m "docs: sync agent documentation for QR session architecture"
```
