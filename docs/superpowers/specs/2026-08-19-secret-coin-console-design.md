# Secret Coin Console — Design Spec

Date: 2026-08-19
Topic: In-admin secret page for inserting test coins (₱1, ₱5, ₱10, ₱20) without using the API directly

## Goal

Provide admins with a hidden, PIN-gated web page where they can simulate physical coin
insertions (₱1, ₱5, ₱10, ₱20) by clicking buttons, replacing the current workflow of
hitting `POST /api/balance/add-test-coin` via curl/Postman. The page also shows a
per-denomination session counter and a reset button that clears that counter.

## Scope

In scope:

- One new HTML page at `/secret/coin-console`, hidden from admin nav and sidebars.
- Four coin buttons that POST to the existing `/api/balance/add-test-coin` endpoint.
- A session counter in `localStorage` tracking insertions per denomination.
- A "Reset coins" button that clears only the session counter (no backend effect).
- PIN gate matching every other admin page (no new auth mechanism).
- Reuses `shared.ts` helpers (`initAuth`, `apiFetch`, `setMessage`, `peso`).

Out of scope:

- Backend changes. `POST /api/balance/add-test-coin` is unchanged.
- New admin auth mechanism. Reuses `POST /api/admin/auth` like every other admin page.
- Removing or weakening existing coin-event idempotency checks.
- Logging or telemetry changes (no source tagging, no admin log entries beyond what
  the existing endpoint already emits).
- Linking the page from anywhere (no dashboard link, no sidebar, no nav helper).

## Architecture

Three new files, no backend changes:

```folder
src/public/secret/coin-console/
├── index.html      ← markup, PIN gate, four coin buttons, reset button, counter panel
├── app.ts          ← PIN auth via shared.ts, click handlers, localStorage counter
└── styles.css      ← local styles; <link>s to /globals.css and /admin/shared.css
```

Express already serves `src/public/` statically, so `GET /secret/coin-console`
resolves to the new `index.html` with no new route registration.

### Why `/secret/...` and not `/admin/secret/...`

- Keeps the page out of any `/admin/*` nav scan that future code might add.
- Visually distinct in the address bar (clearly not the admin dashboard).
- Still PIN-gated via the same `initAuth` flow as every other admin page.

## Components

### Auth gate (in `index.html` + `app.ts`)

- Render the PIN card markup identical to every other admin page (same `auth-gate` /
  `auth-card` / `auth-form` classes from `admin/shared.css`).
- On submit, `initAuth()` calls `POST /api/admin/auth` and toggles the gate.
- Until the gate clears, the coin buttons and reset button are not rendered (or are
  hidden via CSS class), so the PIN card is the only visible UI.

### Coin buttons (in `index.html` + `app.ts`)

Four buttons, each with `data-coin-value="1|5|10|20"`. Click handler:

1. Read `data-coin-value`.
2. `await apiFetch('/api/balance/add-test-coin', { method: 'POST', body: JSON.stringify({ value }) })`.
3. On success: read current counters from `localStorage`, increment the matching
   denomination, write back, re-render the counter panel.
4. On failure: route to error handling (see below), counter **not** incremented.

### Counter state (in `app.ts`)

Single `localStorage` key: `printbit.secretCoinConsole.counters`.

```ts
type Counters = { one: number; five: number; ten: number; twenty: number };
```

Helpers:

- `readCounters(): Counters` — parses the key; on missing key, malformed JSON, or
  non-numeric values, returns `{ one: 0, five: 0, ten: 0, twenty: 0 }`. A corrupted
  key never blocks the page.
- `writeCounters(c: Counters): void` — sole writer; writes the JSON string.
- `incrementCounter(denomination: 'one' | 'five' | 'ten' | 'twenty'): void` —
  reads, increments one field, writes.

Counter persistence is `localStorage` (per browser). It survives F5 reload, tab
close, and browser restart. It is cleared by the "Reset coins" button.

### Reset button (in `index.html` + `app.ts`)

- Calls `writeCounters({ one: 0, five: 0, ten: 0, twenty: 0 })`.
- Re-renders the counter panel.
- **No** backend call. **No** confirm dialog. The button only touches local UI state.

### Counter panel (in `index.html` + `app.ts`)

Small list rendered from `readCounters()` on page load and after every successful
coin click or reset:

```text
Inserted this session:
  ₱1   × 3
  ₱5   × 2
  ₱10  × 1
  ₱20  × 0
```

`peso()` from `shared.ts` is used for the currency label formatting (matches other
admin pages).

### Live balance display (optional, in `index.html` + `app.ts`)

A small line under the counter showing the current `/api/balance` value, fetched
once on page load and once after each successful coin click. Uses `apiFetch` and
the existing `peso()` helper. This is convenience only — its absence does not
break the page.

## Error Handling

Three failure paths, three distinct messages, all surfaced via `setMessage`:

| Trigger                                                                    | Message (via `setMessage`)                                                                                         | Counter incremented? |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------- |
| HTTP `400` from `add-test-coin` (defensive — buttons only send 1/5/10/20)  | `'Invalid coin value. Accepted: 1, 5, 10, 20.'` (level: error)                                                     | No                   |
| HTTP `409` `CoinCreditRejectedError` (slot/printer safety gate, retryable) | `'Coin rejected by safety gate: <reason>. Retry may succeed.'` (level: warn)                                       | No                   |
| HTTP `500` or network failure                                              | `'Failed to process test coin. See server logs.'` (level: error)                                                   | No                   |
| HTTP `401` from `apiFetch` (admin session expired)                         | Handled by `apiFetch` itself — triggers re-auth, page re-shows the PIN gate. Counter in localStorage is preserved. | n/a                  |

The counter is **display only**. The server-side balance is the source of truth.
If the counter ever drifts (e.g., response lost mid-flight), the admin uses
"Reset coins" to clear it.

## Data Flow

```diagram
[admin visits /secret/coin-console]
        │
        ▼
[PIN gate renders, initAuth() called]
        │
   ┌────┴────┐
   │ wrong   │ correct PIN
   │ PIN     │
   ▼         ▼
[red error] [gate hides, coin UI renders, readCounters() → renders counter panel]
                │
                ▼
        [admin clicks ₱5 button]
                │
                ▼
        [apiFetch POST /api/balance/add-test-coin { value: 5 }]
                │
       ┌────────┴────────┐
       │                 │
   success            failure
       │                 │
       ▼                 ▼
[incrementCounter('five')] [setMessage(...) — counter untouched]
[readCounters() → re-render]
[optional: re-fetch /api/balance → re-render live balance]
```

## Testing & Verification

No automated tests. Repo has no test runner for `src/public/`. All verification
is manual.

### Build

- `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` passes.
- `pnpm run build` succeeds (rebuilds admin bundles via the shared pipeline).

### Reachability

1. Visit `http://<kiosk>/secret/coin-console` unauthenticated → PIN card visible.
2. Submit wrong PIN → inline error, page stays locked.
3. Submit correct PIN → coin buttons + reset button visible.

### Functional

1. Click ₱1 → counter "₱1 × 1", live balance +1.
2. Click ₱5 → counter "₱5 × 1", balance +5.
3. Click ₱10 → counter "₱10 × 1", balance +10.
4. Click ₱20 → counter "₱20 × 1", balance +20.
5. Click ₱5 again → counter "₱5 × 2", balance +10 (cumulative).
6. F5 reload → counter values persist, live balance unchanged.
7. Close and reopen browser → counter still persists (localStorage).
8. "Reset coins" → all four counters go to 0, live balance unchanged.

### Negative

1. Stop server mid-click → fetch fails → error message, counter not incremented.
2. Block coin credits via safety gate → 409 → warn message, counter not
   incremented.
3. Manually corrupt `localStorage` key (e.g., set it to `"not-json"`) → page
   still loads with zeroed counters.

### Isolation

1. Open `/admin/dashboard` in another tab — no link, no nav reference to
   `/secret/coin-console` anywhere.
2. `grep -r "secret/coin-console" src/` returns only the new files themselves.

### Regression

1. `POST /api/balance/add-test-coin` still works via curl/Postman (no change to
   the endpoint).
2. Admin dashboard "Reset balance" button still calls `/api/admin/balance/reset`
   (untouched).
3. ESP32 `/coin` route still requires `x-coin-api-key` + `x-coin-source: esp32`
   headers (untouched, no new public endpoint).

## Documentation Updates

Per `agent_docs/documentation_sync.md`:

- **Not** updating `API_DOCUMENTATION.md` (no new route, no new env var).
- **Not** updating `README.md` (no env var changes).
- **Not** updating `ARCHITECTURE.md` (no service/layer change).

The page is intentionally undocumented in user-facing docs because it is a
hidden testing surface. A short note in `OPERATIONS.md` is **not** added — this
matches the existing convention that `/api/balance/add-test-coin` is also
undocumented for non-admin users.
