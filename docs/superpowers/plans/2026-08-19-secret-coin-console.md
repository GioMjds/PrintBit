# Secret Coin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a hidden, PIN-gated admin page at `/secret/coin-console` that lets admins insert test coins (₱1, ₱5, ₱10, ₱20) via buttons, replacing the current curl/Postman workflow against `POST /api/balance/add-test-coin`. The page also shows a per-denomination `localStorage` counter and a "Reset coins" button that clears only that counter.

**Architecture:** Three new static files under `src/public/secret/coin-console/` — `index.html`, `app.ts`, `styles.css` — served by the existing static middleware. No backend changes. Reuses `initAuth`, `apiFetch`, `setMessage`, `peso` from `src/public/shared.ts` (the same helpers every admin page uses).

**Tech Stack:** Static HTML + TypeScript (built by existing pipeline), Express static serving, `localStorage`, existing `POST /api/admin/auth` and `POST /api/balance/add-test-coin` endpoints.

**Spec:** `docs/superpowers/specs/2026-08-19-secret-coin-console-design.md`

## Global Constraints

- **No backend changes.** `POST /api/balance/add-test-coin` and `POST /api/admin/auth` remain untouched.
- **No new files outside `src/public/secret/coin-console/`.**
- **No nav changes.** The page is not linked from any existing admin page or sidebar.
- **`localStorage` key:** `printbit.secretCoinConsole.counters` — single key, JSON-encoded `{ one, five, ten, twenty }`.
- **Reuse:** `initAuth`, `apiFetch`, `setMessage`, `peso` from `src/public/shared.ts`. Import path from this page: `../shared` (note: this is a re-export of `src/public/shared.ts`; the import path used by every other admin page is `../shared`).
- **Build:** Repo uses `pnpm`. Type-check via `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`. Bundle via `pnpm run build` (rebuilds admin panels via the shared pipeline).
- **Encoding:** All peso signs (`₱`) must be encoded as UTF-8 in source files. Avoid `�` byte sequences — they're a sign of mis-encoded content from earlier drafts.
- **TypeScript:** Strict mode (project default). No `any` unless wrapping an existing unsafe surface.

---

## File Map

**Create:**

- `src/public/secret/coin-console/index.html`
- `src/public/secret/coin-console/app.ts`
- `src/public/secret/coin-console/styles.css`

**Modify:**

- None

**Skip:**

- `API_DOCUMENTATION.md` — no new endpoints.
- `README.md` — no new env vars.
- `ARCHITECTURE.md` — no service/layer change.
- `OPERATIONS.md` — matches the existing convention of keeping the test-coin path undocumented.

---

### Task 1: Scaffold the page (HTML + CSS shell)

**Files:**

- Create: `src/public/secret/coin-console/index.html`
- Create: `src/public/secret/coin-console/styles.css`

**Goal:** A reachable page at `/secret/coin-console` that renders the PIN gate. Coin UI hidden until the page is wired in Task 2. This task makes the page discoverable and unblocks end-to-end reachability tests.

**Interfaces (consumed by Task 2):**

- Element IDs in `index.html` that Task 2's `app.ts` will look up (listed below).
- CSS classes used in `index.html` that `styles.css` defines (listed below).

**Step-by-step:**

- [ ] **Step 1.1: Create `src/public/secret/coin-console/index.html`**

Write the following file verbatim. The element IDs and classes are the contract Task 2 depends on:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"
    />
    <title>Coin Console — PrintBit</title>
    <link rel="stylesheet" href="/globals.css" />
    <link rel="stylesheet" href="/admin/shared.css" />
    <link rel="stylesheet" href="/secret/coin-console/styles.css" />
  </head>
  <body class="coin-console-body">
    <main id="coinConsoleMain" class="coin-console-main hidden">
      <header class="coin-console-header">
        <h1 class="coin-console-title">Coin Console</h1>
        <p class="coin-console-subtitle">
          Test coin insertion. Click a denomination to credit the live balance.
        </p>
      </header>

      <section class="coin-console-buttons" aria-label="Test coin buttons">
        <button type="button" class="coin-button" data-coin-value="1">
          ₱1
        </button>
        <button type="button" class="coin-button" data-coin-value="5">
          ₱5
        </button>
        <button type="button" class="coin-button" data-coin-value="10">
          ₱10
        </button>
        <button type="button" class="coin-button" data-coin-value="20">
          ₱20
        </button>
      </section>

      <section class="coin-console-counters" aria-label="Session counters">
        <h2 class="coin-console-section-title">Inserted this session</h2>
        <ul id="counterList" class="counter-list">
          <li class="counter-row" data-counter="one">
            <span class="counter-label">₱1</span>
            <span class="counter-count" data-counter-count="one">× 0</span>
          </li>
          <li class="counter-row" data-counter="five">
            <span class="counter-label">₱5</span>
            <span class="counter-count" data-counter-count="five">× 0</span>
          </li>
          <li class="counter-row" data-counter="ten">
            <span class="counter-label">₱10</span>
            <span class="counter-count" data-counter-count="ten">× 0</span>
          </li>
          <li class="counter-row" data-counter="twenty">
            <span class="counter-label">₱20</span>
            <span class="counter-count" data-counter-count="twenty">× 0</span>
          </li>
        </ul>
      </section>

      <section class="coin-console-balance" aria-label="Live balance">
        <span class="balance-label">Live balance:</span>
        <span id="liveBalance" class="balance-value">—</span>
      </section>

      <section class="coin-console-actions">
        <button id="resetCoinsBtn" type="button" class="reset-button">
          Reset coins
        </button>
      </section>

      <div id="messageBanner" class="message-banner hidden" role="status"></div>
    </main>

    <!-- PIN gate: same shape as other admin pages. Hidden by default; app.ts
         shows it until auth succeeds. -->
    <div id="adminAuthView" class="auth-gate">
      <div class="auth-card">
        <div class="auth-card__brand" aria-hidden="true">
          <div class="auth-card__logomark">
            <svg viewBox="0 0 40 40" fill="none">
              <rect
                x="6"
                y="5"
                width="28"
                height="17"
                rx="3.5"
                fill="var(--indigo)"
                opacity=".3"
              />
              <rect
                x="3"
                y="14"
                width="34"
                height="19"
                rx="5"
                fill="var(--indigo)"
                opacity=".85"
              />
              <rect x="6" y="20" width="28" height="14" rx="3" fill="#0b0a1a" />
              <rect
                x="10"
                y="25"
                width="16"
                height="2.5"
                rx="1.25"
                fill="var(--lavender)"
                opacity=".55"
              />
              <rect
                x="10"
                y="30"
                width="11"
                height="2.5"
                rx="1.25"
                fill="var(--lavender)"
                opacity=".3"
              />
              <circle cx="30" cy="30" r="3" fill="var(--peach)" opacity=".9" />
            </svg>
          </div>
          <div class="auth-card__text">
            <div class="auth-card__wordmark">PrintBit</div>
            <div class="auth-card__tag">Coin Console</div>
          </div>
        </div>
        <h1 class="auth-card__heading">Secure Access</h1>
        <p class="auth-card__desc">
          Enter the administrator PIN to unlock the test coin console.
        </p>
        <form
          id="adminAuthForm"
          class="auth-form"
          autocomplete="off"
          novalidate
        >
          <div class="pin-field">
            <label for="adminPinInput" class="pin-field__label"
              >Administrator PIN</label
            >
            <input
              id="adminPinInput"
              name="pin"
              type="password"
              inputmode="numeric"
              autocomplete="off"
              class="pin-field__input"
              required
            />
          </div>
          <button type="submit" class="auth-form__submit">Unlock</button>
        </form>
        <div
          id="adminAuthError"
          class="auth-form__error hidden"
          role="alert"
        ></div>
      </div>
    </div>

    <script type="module" src="/secret/coin-console/app.js"></script>
  </body>
</html>
```

Note: the `<script>` tag references `app.js` (not `app.ts`) because the build pipeline emits `app.js` next to `app.ts`. This matches the pattern in `src/public/admin/dashboard/index.html` and the other admin pages — verify by reading `src/public/admin/dashboard/index.html` if uncertain.

- [ ] **Step 1.2: Create `src/public/secret/coin-console/styles.css`**

```css
/* Coin Console — local layout. Reuses /globals.css and /admin/shared.css. */

.coin-console-body {
  margin: 0;
  min-height: 100vh;
  background: var(--bg, #0b0a1a);
  color: var(--text, #f5f5fa);
  font-family: var(
    --font-sans,
    system-ui,
    -apple-system,
    'Segoe UI',
    sans-serif
  );
}

.coin-console-main {
  max-width: 720px;
  margin: 0 auto;
  padding: 32px 24px 64px;
}

.coin-console-main.hidden {
  display: none;
}

.coin-console-header {
  margin-bottom: 24px;
}

.coin-console-title {
  margin: 0 0 8px;
  font-size: 1.6rem;
  font-weight: 600;
  letter-spacing: 0.01em;
}

.coin-console-subtitle {
  margin: 0;
  opacity: 0.7;
  font-size: 0.95rem;
}

.coin-console-buttons {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 32px;
}

.coin-button {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  padding: 24px 12px;
  border-radius: 12px;
  font-size: 1.5rem;
  font-weight: 600;
  cursor: pointer;
  transition:
    background 120ms ease,
    transform 120ms ease;
}

.coin-button:hover {
  background: rgba(255, 255, 255, 0.08);
}

.coin-button:active {
  transform: scale(0.98);
}

.coin-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.coin-console-section-title {
  margin: 0 0 12px;
  font-size: 0.85rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  opacity: 0.6;
}

.coin-console-counters {
  margin-bottom: 24px;
}

.counter-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.counter-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 8px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.02);
}

.counter-label {
  font-size: 0.95rem;
  opacity: 0.7;
  margin-bottom: 4px;
}

.counter-count {
  font-size: 1.1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.coin-console-balance {
  margin: 24px 0;
  padding: 12px 16px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.balance-label {
  opacity: 0.7;
  font-size: 0.95rem;
}

.balance-value {
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.coin-console-actions {
  margin: 24px 0 16px;
}

.reset-button {
  appearance: none;
  border: 1px solid rgba(255, 102, 102, 0.4);
  background: rgba(255, 102, 102, 0.08);
  color: inherit;
  padding: 10px 18px;
  border-radius: 8px;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 120ms ease;
}

.reset-button:hover {
  background: rgba(255, 102, 102, 0.16);
}

.message-banner {
  margin-top: 16px;
  padding: 12px 16px;
  border-radius: 8px;
  font-size: 0.95rem;
  border: 1px solid transparent;
}

.message-banner.hidden {
  display: none;
}

.message-banner--error {
  background: rgba(255, 102, 102, 0.12);
  border-color: rgba(255, 102, 102, 0.4);
}

.message-banner--warn {
  background: rgba(255, 193, 7, 0.12);
  border-color: rgba(255, 193, 7, 0.4);
}

.message-banner--info {
  background: rgba(120, 168, 255, 0.12);
  border-color: rgba(120, 168, 255, 0.4);
}

@media (max-width: 480px) {
  .coin-console-buttons {
    grid-template-columns: repeat(2, 1fr);
  }

  .counter-list {
    grid-template-columns: repeat(2, 1fr);
  }
}
```

- [ ] **Step 1.3: Verify the page is reachable**

Run: `pnpm run build`
Expected: exits 0. Note any warnings about the new files (warnings are fine; errors are not).

Then start the dev server (use whatever command the project uses — `pnpm run dev` or `node dist/server.js`; check `package.json`'s `scripts` block). Once it's running:

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/secret/coin-console
```

Expected: `200`. If `404`, the static path is wrong — check `src/app.module.ts` (or wherever static files are mounted) for the path the server expects `src/public/` to be served from. Fix the `<script>` and `<link>` paths in `index.html` accordingly.

Open `http://localhost:3000/secret/coin-console` in a browser. Expected: PIN card visible. Coin console body hidden.

- [ ] **Step 1.4: Commit**

```bash
git add src/public/secret/coin-console/index.html src/public/secret/coin-console/styles.css
git commit -m "feat(admin): scaffold secret coin console page"
```

---

### Task 2: Wire up auth, coin clicks, and counter (app.ts)

**Files:**

- Create: `src/public/secret/coin-console/app.ts`

**Goal:** Bring the page to life. After PIN auth, the four coin buttons call `POST /api/balance/add-test-coin` and increment the matching `localStorage` counter. "Reset coins" clears the counter. Errors surface via the message banner.

**Interfaces (consumed by browser at runtime):**

- `#adminAuthForm`, `#adminPinInput`, `#adminAuthError`, `#adminAuthView` — PIN gate elements (already in `index.html`).
- `#coinConsoleMain` — coin console root, hidden until auth succeeds.
- `.coin-button[data-coin-value]` — four buttons (1, 5, 10, 20).
- `#counterList` and `[data-counter-count]` — counter rows.
- `#liveBalance` — live balance display.
- `#resetCoinsBtn` — reset button.
- `#messageBanner` — error message banner.

**Inputs (from `src/public/shared.ts`):**

- `initAuth(opts: { onSuccess: () => void; formId?: string; errorId?: string; viewId?: string; mainId?: string })` — already used by every admin page. Returns `boolean` (success) or triggers re-auth flow. Confirm the exact signature by reading `src/public/shared.ts` before writing — adjust the call below if `initAuth`'s signature differs from this plan.
- `apiFetch(path: string, init?: RequestInit): Promise<Response>` — wrapper that drives re-auth on 401.
- `setMessage(message: string, level: 'error' | 'warn' | 'info' | 'success', opts?: { bannerId?: string }): void` — for the message banner. Confirm exact signature in `shared.ts`.
- `peso(amount: number): string` — currency formatter.

**Step-by-step:**

- [ ] **Step 2.1: Read `src/public/shared.ts` to confirm the exact signatures**

Read `src/public/shared.ts` and locate the exports of `initAuth`, `apiFetch`, `setMessage`, `peso`. Confirm:

- `initAuth` accepts an `onSuccess` callback and toggles a `#adminAuthView` element.
- `setMessage` accepts a level string and writes into a banner element.
- `apiFetch` returns a `Response` (or parsed JSON — note which).

If any signature differs from what this plan assumes, adjust the code in Step 2.2 to match. **Do not** change `shared.ts` — only the new `app.ts` file.

Also re-read `src/public/admin/dashboard/app.ts` for an example of how the admin pages call `initAuth` and `setMessage`. Mirror that pattern.

- [ ] **Step 2.2: Create `src/public/secret/coin-console/app.ts`**

Write the following file. The shape, error handling, and counter logic mirror the spec exactly.

```ts
import { initAuth, apiFetch, setMessage, peso } from '../shared';

type Denomination = 'one' | 'five' | 'ten' | 'twenty';
type Counters = Record<Denomination, number>;

const COUNTERS_KEY = 'printbit.secretCoinConsole.counters';

const COIN_VALUE_TO_DENOM: Record<number, Denomination> = {
  1: 'one',
  5: 'five',
  10: 'ten',
  20: 'twenty',
};

const ZERO_COUNTERS: Counters = { one: 0, five: 0, ten: 0, twenty: 0 };

const mainEl = document.getElementById('coinConsoleMain') as HTMLElement | null;
const authViewEl = document.getElementById(
  'adminAuthView',
) as HTMLElement | null;
const counterListEl = document.getElementById(
  'counterList',
) as HTMLElement | null;
const liveBalanceEl = document.getElementById(
  'liveBalance',
) as HTMLElement | null;
const resetBtn = document.getElementById(
  'resetCoinsBtn',
) as HTMLButtonElement | null;
const coinButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('.coin-button[data-coin-value]'),
);

function readCounters(): Counters {
  try {
    const raw = window.localStorage.getItem(COUNTERS_KEY);
    if (raw === null) return { ...ZERO_COUNTERS };
    const parsed = JSON.parse(raw) as Partial<Counters> | null;
    if (!parsed || typeof parsed !== 'object') return { ...ZERO_COUNTERS };
    return {
      one:
        typeof parsed.one === 'number' && Number.isFinite(parsed.one)
          ? parsed.one
          : 0,
      five:
        typeof parsed.five === 'number' && Number.isFinite(parsed.five)
          ? parsed.five
          : 0,
      ten:
        typeof parsed.ten === 'number' && Number.isFinite(parsed.ten)
          ? parsed.ten
          : 0,
      twenty:
        typeof parsed.twenty === 'number' && Number.isFinite(parsed.twenty)
          ? parsed.twenty
          : 0,
    };
  } catch {
    return { ...ZERO_COUNTERS };
  }
}

function writeCounters(c: Counters): void {
  window.localStorage.setItem(COUNTERS_KEY, JSON.stringify(c));
}

function incrementCounter(denom: Denomination): void {
  const current = readCounters();
  current[denom] += 1;
  writeCounters(current);
}

function resetCounters(): void {
  writeCounters({ ...ZERO_COUNTERS });
}

function renderCounters(): void {
  const counters = readCounters();
  for (const denom of Object.keys(
    COIN_VALUE_TO_DENOM,
  ) as unknown as Denomination[]) {
    const cell = document.querySelector<HTMLElement>(
      `[data-counter-count="${denom}"]`,
    );
    if (cell) cell.textContent = `× ${counters[denom]}`;
  }
}

async function refreshLiveBalance(): Promise<void> {
  if (!liveBalanceEl) return;
  try {
    const res = await apiFetch('/api/balance');
    if (!res.ok) {
      liveBalanceEl.textContent = '—';
      return;
    }
    const data = (await res.json()) as { balance?: number };
    const balance = typeof data.balance === 'number' ? data.balance : 0;
    liveBalanceEl.textContent = peso(balance);
  } catch {
    liveBalanceEl.textContent = '—';
  }
}

async function handleCoinClick(btn: HTMLButtonElement): Promise<void> {
  const value = Number.parseInt(btn.dataset.coinValue ?? '', 10);
  if (!Number.isFinite(value) || !(value in COIN_VALUE_TO_DENOM)) {
    setMessage('Invalid coin value. Accepted: 1, 5, 10, 20.', 'error', {
      bannerId: 'messageBanner',
    });
    return;
  }

  const denom = COIN_VALUE_TO_DENOM[value];

  // Disable all buttons during the request to prevent double-fire.
  for (const b of coinButtons) b.disabled = true;

  try {
    const res = await apiFetch('/api/balance/add-test-coin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    });

    if (res.ok) {
      incrementCounter(denom);
      renderCounters();
      await refreshLiveBalance();
      return;
    }

    if (res.status === 400) {
      setMessage('Invalid coin value. Accepted: 1, 5, 10, 20.', 'error', {
        bannerId: 'messageBanner',
      });
      return;
    }

    if (res.status === 409) {
      let reason = 'safety gate';
      try {
        const body = (await res.json()) as {
          reason?: string;
          details?: string;
        };
        if (body?.reason) reason = body.reason;
        else if (body?.details) reason = body.details;
      } catch {
        /* ignore body parse errors */
      }
      setMessage(
        `Coin rejected by safety gate: ${reason}. Retry may succeed.`,
        'warn',
        { bannerId: 'messageBanner' },
      );
      return;
    }

    if (res.status >= 500) {
      setMessage('Failed to process test coin. See server logs.', 'error', {
        bannerId: 'messageBanner',
      });
      return;
    }

    // Any other status — treat as a transient error.
    setMessage(`Coin failed (HTTP ${res.status}). See server logs.`, 'error', {
      bannerId: 'messageBanner',
    });
  } catch {
    setMessage('Failed to process test coin. See server logs.', 'error', {
      bannerId: 'messageBanner',
    });
  } finally {
    for (const b of coinButtons) b.disabled = false;
  }
}

function bindCoinButtons(): void {
  for (const btn of coinButtons) {
    btn.addEventListener('click', () => {
      void handleCoinClick(btn);
    });
  }
}

function bindResetButton(): void {
  if (!resetBtn) return;
  resetBtn.addEventListener('click', () => {
    resetCounters();
    renderCounters();
    setMessage('Counters reset.', 'info', { bannerId: 'messageBanner' });
  });
}

function showMain(): void {
  if (mainEl) mainEl.classList.remove('hidden');
  if (authViewEl) authViewEl.classList.add('hidden');
  renderCounters();
  void refreshLiveBalance();
}

function bootstrap(): void {
  // initAuth handles the PIN form and triggers re-auth on 401 responses.
  // Signatures vary across versions — match the call below to whatever
  // src/public/shared.ts actually exports.
  initAuth({
    onSuccess: () => {
      showMain();
      bindCoinButtons();
      bindResetButton();
    },
    // Optional fields the API supports; defaults will pick the right ids.
    formId: 'adminAuthForm',
    errorId: 'adminAuthError',
    viewId: 'adminAuthView',
    mainId: 'coinConsoleMain',
  });
}

bootstrap();
```

**Important:** adjust the `initAuth` call to match the real signature exported by `src/public/shared.ts`. If `initAuth` takes different option names, rename them. If it takes the form/error ids as positional args, restructure. The intent is: `initAuth` makes the PIN card work, and after a successful PIN we call `showMain()` + `bindCoinButtons()` + `bindResetButton()`. The exact wiring is whatever `shared.ts` exposes.

- [ ] **Step 2.3: Type-check**

Run: `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
Expected: exits 0. If TypeScript complains about `app.ts`, fix the inline code (do not edit `shared.ts` — adapt the call site).

- [ ] **Step 2.4: Build**

Run: `pnpm run build`
Expected: exits 0. The build pipeline should emit `src/public/secret/coin-console/app.js` next to `app.ts`. Verify:

```bash
ls src/public/secret/coin-console/
```

Expected output includes at minimum: `index.html`, `app.ts`, `app.js`, `styles.css`.

- [ ] **Step 2.5: Manual reachability + auth check**

Start the dev server. Visit `http://localhost:3000/secret/coin-console` in a browser.

1. PIN card visible, coin console hidden.
2. Submit wrong PIN → inline error in PIN card, page stays locked.
3. Submit correct PIN → coin console appears, four buttons + reset button visible, counter panel shows `× 0` for all four denominations, live balance shows a peso value.

- [ ] **Step 2.6: Manual happy path**

Click each coin button once (₱1, ₱5, ₱10, ₱20). Expected after each click:

- Counter for that denomination shows `× 1`.
- Live balance increases by the coin value.
- No error message.

Then click ₱5 a second time. Expected: counter for ₱5 shows `× 2`, live balance increases by 5 again.

- [ ] **Step 2.7: Manual persistence check**

Press F5 in the browser. Expected: counter values persist, live balance unchanged.

Close the browser tab, reopen `http://localhost:3000/secret/coin-console`, enter PIN. Expected: counters still show the inserted values.

- [ ] **Step 2.8: Manual reset check**

Click "Reset coins". Expected: all four counters go to `× 0`, live balance unchanged, message banner shows "Counters reset."

- [ ] **Step 2.9: Manual error path (negative)**

Stop the server. Click a coin button. Expected: error message "Failed to process test coin. See server logs.", counter **not** incremented.

Restart the server. (No way to test 409 from the UI cleanly without a hot coin slot — skip that case; the 409 handler is exercised by the code path and the unit-style contract is clear.)

- [ ] **Step 2.10: Manual isolation check**

```bash
grep -r "secret/coin-console" src/ --exclude-dir=node_modules
```

Expected output: only the lines inside `src/public/secret/coin-console/` itself. No references in any other admin page, sidebar, or nav helper.

```bash
grep -r "coin-console" src/public/ --exclude-dir=node_modules
```

Same expected output. Confirms the secret path is not linked anywhere.

- [ ] **Step 2.11: Commit**

```bash
git add src/public/secret/coin-console/app.ts
git commit -m "feat(admin): wire coin console to add-test-coin endpoint"
```

---

### Task 3: Final verification

**Files:** None — read-only verification.

**Goal:** Run the full manual checklist from the spec's Testing & Verification section and confirm nothing regressed.

**Step-by-step:**

- [ ] **Step 3.1: Build clean**

```bash
pnpm exec tsc --noEmit --ignoreDeprecations 6.0
pnpm run build
```

Both must exit 0.

- [ ] **Step 3.2: Confirm no backend changed**

```bash
git diff HEAD~1 -- src/modules src/services src/app.module.ts src/server.ts
```

Expected: empty (only the new files in `src/public/secret/coin-console/` plus the spec doc changes should be in the recent commits).

- [ ] **Step 3.3: Confirm existing endpoints still work**

```bash
curl -s -X POST http://localhost:3000/api/balance/add-test-coin \
  -H "Content-Type: application/json" \
  -d '{"value":5}'
```

Expected: `{"ok":true,...}` (or whatever the existing endpoint returns). The endpoint is unchanged.

- [ ] **Step 3.4: Confirm dashboard reset still works**

Open `http://localhost:3000/admin/dashboard`, enter PIN, click "Reset balance". Expected: balance zeroes out via `POST /api/admin/balance/reset`. Unchanged.

- [ ] **Step 3.5: Confirm spec ↔ implementation parity**

Re-read `docs/superpowers/specs/2026-08-19-secret-coin-console-design.md` and verify each requirement has a corresponding piece of code:

| Spec requirement                                                | Where it lives                                                                   |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `/secret/coin-console` route                                    | `src/public/secret/coin-console/index.html` (served by static middleware)        |
| PIN gate                                                        | `initAuth({ onSuccess: showMain })` in `app.ts`                                  |
| Four coin buttons                                               | `index.html` markup + `bindCoinButtons()` in `app.ts`                            |
| `POST /api/balance/add-test-coin`                               | `handleCoinClick()` in `app.ts`                                                  |
| `localStorage` counter at `printbit.secretCoinConsole.counters` | `COUNTERS_KEY` constant in `app.ts`                                              |
| Counter not incremented on error                                | All `setMessage` paths in `handleCoinClick()` are before `incrementCounter()`    |
| "Reset coins" clears only counter                               | `bindResetButton()` in `app.ts` — no backend call                                |
| 400 / 409 / 500 / 401 distinct messages                         | All four branches in `handleCoinClick()` plus `apiFetch`'s built-in 401 handling |
| Counter survives F5 / tab close / browser restart               | `localStorage` (not `sessionStorage`)                                            |
| No nav pollution                                                | `grep` check in Task 2.10                                                        |

All checks pass → implementation matches spec.

- [ ] **Step 3.6: Commit verification log (optional)**

If any of the above checks surfaced a fix, commit it. If everything passed, no commit needed.

```bash
git status
```

Expected: clean tree.
