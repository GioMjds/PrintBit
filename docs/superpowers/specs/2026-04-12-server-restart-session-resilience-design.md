# Server Restart and Session Resilience Design (2026-04-12)

## Problem summary

The kiosk shows repeated unplanned server restarts (`unexpected_restart_detected`) and `/print` wireless sessions are lost when the process bounces.  
Troubleshooting indicates this is primarily operational watchdog/startup churn plus process-memory session storage.

## Goals

1. Prevent random server restart churn during normal kiosk operation.
2. Preserve active wireless print sessions across process restarts.
3. Keep existing security constraints (token ownership, session expiry) intact.

## Non-goals

1. Redesigning the full print/payment pipeline.
2. Relaxing session authorization or expiry checks.
3. Reworking unrelated admin/reporting modules.

## Chosen approach

Use a combined fix:

1. **Stabilize startup/watchdog orchestration** so one watchdog loop governs recovery and restart logic remains conservative.
2. **Persist wireless session state in SQLite** so a restart does not invalidate active session flows.

## Root-cause findings used by this design

1. Runtime logs show repeated `unexpected_restart_detected` events over short intervals.
2. Recovery lifecycle data shows many boots without matching clean shutdown markers.
3. Current `SessionStore` keeps sessions in memory maps; any process restart drops all active sessions.
4. Deployment currently runs startup/watchdog from scheduled tasks, but latest watchdog hardening was not applied via task re-registration.

## Detailed design

### A) Startup/watchdog stabilization

**Scope**

1. `scripts\install-startup.ps1`
2. `scripts\install-watchdog.ps1`
3. `scripts\watchdog.ps1`

**Design**

1. Ensure deployment rollout explicitly re-registers startup/watchdog tasks after script updates so single-instance settings are active on target kiosks.
2. Keep watchdog restart behavior conservative:
   - avoid restart when server process is confirmed alive;
   - restart only after verified unreachable conditions and threshold checks.
3. Improve restart observability by recording explicit recovery action reasons in watchdog state/report paths.

### B) Persistent wireless sessions

**Scope**

1. `src\core\database\sqlite-storage.ts`
2. `src\services\session.ts`
3. `src\modules\wireless-session\wireless-session.service.ts` (integration-only adjustments)

**Data model**

Add SQLite-backed storage for wireless sessions and uploaded document metadata with:

1. session identity/token/owner fields,
2. creation and last-activity timestamps,
3. status plus normalized document list metadata,
4. optional expiry metadata used by current TTL logic.

**Behavior**

1. Keep current route contracts unchanged.
2. Replace process-memory-only session lifecycle operations with persistence-backed operations:
   - create,
   - touch/keepalive,
   - upload metadata attach,
   - remove/cancel,
   - lookup by id/token.
3. On server boot, load active sessions and prune expired/invalid rows.
4. Continue enforcing token ownership and expiry before serving session state.

### C) Frontend compatibility

`src\public\print\app.ts` behavior remains mostly unchanged.  
Session restore flow continues to call `/api/wireless/sessions/:sessionId`; the backend now returns persisted state after process restart.

## Error handling and safety rules

1. Persisted-row parsing failures are surfaced in logs and invalid rows are pruned (no silent unsafe fallback).
2. Multi-file session updates should remain atomic per operation to avoid document/session drift.
3. TTL enforcement remains strict; persistence improves continuity but does not bypass expiry.

## Verification strategy

1. Type/build checks:
   - `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`
   - `pnpm run build`
2. Restart continuity scenario:
   - create wireless session and upload document,
   - trigger controlled server restart,
   - verify same session can be restored and used.
3. Watchdog stability scenario:
   - verify only one watchdog loop is active,
   - verify restart bursts are eliminated in admin logs.
4. TTL scenario:
   - verify idle session expiry still works as intended.

## Rollout plan

1. Deploy script/backend changes.
2. Re-register startup/watchdog tasks on kiosk hosts (mandatory step).
3. Validate restart/session continuity in a controlled kiosk cycle.
4. Monitor admin logs for restart anomaly frequency and session-expired regressions.

## Risks and mitigations

1. **Risk:** stale persisted sessions accumulate.  
   **Mitigation:** startup + periodic pruning for expired sessions.
2. **Risk:** schema mismatch during upgrade.  
   **Mitigation:** additive migration with backward-safe reads and explicit normalization.
3. **Risk:** watchdog remains too aggressive in edge conditions.  
   **Mitigation:** threshold tuning + explicit restart reason telemetry.
