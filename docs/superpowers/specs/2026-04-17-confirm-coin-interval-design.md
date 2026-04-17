# Confirm Page Coin Insert Interval Design

## Problem
Rapid back-to-back coin insertion on the Confirm page can lead to missed user expectations about registration timing. We need to enforce a short wait between accepted coins so users are guided to insert coins one-by-one.

## Scope
- In scope: `src/public/confirm/app.ts` behavior while user is on Confirm page.
- Out of scope: serial parser timing changes, global coin acceptance policy, backend API changes.

## Requirements
1. Enforce a minimum **500ms** interval after every accepted coin.
2. If another coin is inserted too early, the slot should reject it (via temporary slot lock).
3. Show a static instruction message while interval lock is active: "Please insert coins one-by-one."
4. Restart interval timer after each accepted coin.
5. Apply only on Confirm page.
6. Preserve existing lock behavior when balance reaches required amount.

## Current Behavior Summary
- Confirm page receives real-time `balance` and `coinAccepted` events via Socket.IO.
- Slot lock today is mainly tied to "balance >= required amount" and explicit client lock/unlock emits.
- No dedicated short interval lock exists between accepted coins.

## Selected Approach (Approved)
Frontend-only interval lock controller on Confirm page:
- On every `coinAccepted`, start/restart a 500ms interval lock window.
- During the window, emit `lockCoinSlot` and present one-by-one guidance.
- When timer elapses, emit `unlockCoinSlot` only if user is still below required balance and normal gate conditions allow coin insertion.
- If balance is already sufficient, keep existing "ready/locked" behavior untouched.

This approach reuses existing socket events and lock ownership semantics, minimizing risk and change surface.

## Detailed Design

### 1) New Confirm-page interval state
Add local state in `src/public/confirm/app.ts`:
- `const COIN_INSERT_INTERVAL_MS = 500;`
- `let coinInsertIntervalTimer: number | null = null;`
- `let coinInsertIntervalActive = false;`

Add helpers:
- `clearCoinInsertIntervalTimer()`
- `startCoinInsertIntervalLock()`
- `finishCoinInsertIntervalLock()`
- `shouldUnlockAfterInterval()` (encapsulates guard checks)

### 2) Event integration
- In `socket.on('coinAccepted', ...)`:
  - keep existing "last accepted coin" toast update.
  - invoke `startCoinInsertIntervalLock()` after accepting payload.
- `startCoinInsertIntervalLock()`:
  - clear prior timer (restart semantics).
  - set `coinInsertIntervalActive = true`.
  - emit `lockCoinSlot` (temporary interval lock).
  - set status guidance text to one-by-one instruction.
  - schedule timer for 500ms to call `finishCoinInsertIntervalLock()`.
- `finishCoinInsertIntervalLock()`:
  - clear active flag/timer.
  - if still below required amount and printer path allows insert flow, emit `unlockCoinSlot`.
  - call `applyConfirmGate()` to restore normal status messaging.

### 3) Coexistence with existing lock logic
- Do not remove or alter existing threshold-based lock (`syncCoinSlotLockState`).
- Interval lock is additive and short-lived.
- If threshold lock should remain active (balance already sufficient), interval completion must not unlock.

### 4) Error/ownership handling
Add listeners for:
- `coinSlotLockDenied`
- `coinSlotUnlockDenied`

Behavior:
- Keep UI in safe state (no forced unlock assumptions).
- Show concise toast warning that lock ownership prevented the action.
- Let existing `coinSlotLocked` / `coinSlotUnlocked` broadcasts remain source of truth for visual lock state.

### 5) Messaging updates
- Static interval guidance while active: "Please insert coins one-by-one."
- Keep existing coin toast and printer/balance gating messages otherwise.
- No countdown UI introduced.

## Edge Cases
- Multiple rapid accepted events: timer restarts each time; lock window extends consistently.
- Coin reaches required amount during interval: threshold lock takes precedence; no unlock emit on interval end.
- Printer becomes unavailable during interval: existing printer gate messaging remains authoritative after interval finishes.
- Navigation/timeout cleanup: existing unlock-on-exit behavior remains; interval timer is cleared during cleanup paths.

## Validation Plan
1. Insert coins rapidly on Confirm page and verify early extra coin is rejected while interval lock is active.
2. Insert coins with >=500ms spacing and verify normal acceptance.
3. Verify reaching required balance still results in stable locked-ready state.
4. Verify lock denied/unlock denied cases show safe warning and do not desync UI.
5. Run:
   - `pnpm run build`
   - `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`

## Risks and Mitigations
- Risk: race between interval unlock and threshold lock.
  - Mitigation: centralize unlock guard checks and re-run `applyConfirmGate()` after interval completion.
- Risk: lock ownership conflicts from other sockets.
  - Mitigation: handle denied events explicitly and rely on server lock broadcasts for final state.
