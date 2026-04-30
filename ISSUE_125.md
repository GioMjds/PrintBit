# Implementation Plan — Issue #125 PH-Localized Pricing Engine

## Problem

Implement a PH-localized, coverage-aware print pricing engine in PrintBit that preserves kiosk financial constraints (whole-peso settlement), adds transparent per-page pricing, and rolls out safely through `legacy -> shadow -> live` modes.

## Agreed Design Baselines

1. Pricing precision: `whole_peso_total_only` (single final rounding at total).
2. Config storage: SQLite runtime settings (`db.data.settings` extension).
3. Queue strategy: dedicated BullMQ analysis queue/worker.
4. UI localization scope: pricing surfaces only.
5. Blank-page default: `charge_zero`.
6. Rollout strategy: feature-flag phased rollout.

## Progress Snapshot

1. Phase 1 is complete (`pricing-phase-1-schema-config` done).
2. Phase 2 is complete (`pricing-phase-2-analysis-queue` done).
3. Phase 3 is complete (`pricing-phase-3-engine-quote` done).
4. Phase 4 is in progress (`pricing-phase-4-payment-admin-api` in_progress).
   - ✓ GET /api/pricing-config endpoint implemented
   - ⧖ Legacy/shadow/live mode switching in endpoints
   - ⧖ Admin settings page for pricing engine controls
   - ⧖ Confirm-payment integration with pricing mode support
5. Phase 5-7 pending (UI localization, docs sync, validation gates)

## Phased Implementation Plan

### Phase 1 — Config + Schema Foundations

1. Extend pricing settings schema/types for `settings.pricingEngine`.
2. Add normalization/validation for new pricing config fields.
3. Add SQLite cache table(s) for file-hash keyed analysis reuse.
4. Add rollout mode wiring (`legacy|shadow|live`) with safe default `legacy`.

### Phase 2 — Analysis Pipeline Hardening (Async)

1. Implement dedicated pricing analysis queue and worker.
2. Add normalized PDF analysis path that computes per-page coverage (not only boolean color).
3. Persist analysis snapshots into session documents and into hash cache.
4. Add explicit analysis job API contract (`POST /api/analyze-job` + status semantics).

### Phase 3 — Pricing Engine + Quote Contract

1. Implement pure `PricingEngineService` with:
   - threshold classification (bw/partial/full/blank)
   - partial-color proportional pricing
   - blank-page policy
   - bulk tier discounting
   - single final total rounding.
2. Extend `/api/print/quote` response with per-page breakdown and pricing totals.
3. Integrate pricing mode behavior:
   - `legacy`: existing billing source
   - `shadow`: compute + log deltas, no billing change
   - `live`: new pricing engine as billing source.

### Phase 4 — Payment + Admin Integration

1. Ensure confirm-payment uses quote-consistent amounts in `live` mode.
2. Add `GET /api/pricing-config`.
3. Extend admin settings API and admin settings page for pricing engine controls.
4. Add strict validation/error messages for all new config fields.

### Phase 5 — Pricing-Surface UX Localization

1. Update pricing-facing UI labels:
   - `Short Bond Paper` / `Long Bond Paper`
   - `Black & White` / `Colored`.
2. Keep internal enum compatibility and map:
   - `A4`, `Letter` -> `shortBond`
   - `Legal` -> `longBond`.
3. Hide orientation as a pricing factor in quote/summary displays.
4. Add transparent per-page pricing table on confirmation screen.

### Phase 6 — Verification + Docs Sync

1. Validate TypeScript (`pnpm exec tsc --noEmit --ignoreDeprecations 6.0`).
2. Rebuild client bundle when public TS changes (`pnpm run build`).
3. Update required docs for behavior/API/config changes:
   - `README.md`
   - `ARCHITECTURE.md`
   - `API_DOCUMENTATION.md`
   - `OPERATIONS.md`.

## Notes

1. No direct reintroduction of LowDB for pricing config.
2. No silent fallback to unrelated pricing behavior when analysis is unavailable.
3. Print dispatch queue work remains decoupled from pricing analysis queue in this issue.
