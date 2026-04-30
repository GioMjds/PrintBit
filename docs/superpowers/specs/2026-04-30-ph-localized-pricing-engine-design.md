# PH-Localized Print Pricing Engine Design (Issue #125)

## 1. Problem Statement

PrintBit currently prices print jobs using a binary color model (B/W or colored surcharge) with whole-peso billing. This does not fully match local Philippine shop expectations for paper terminology and does not capture mixed-content fairness (e.g., mostly B/W pages with only light color on some pages).

Issue #125 introduces a localized, coverage-aware pricing engine that:

1. Preserves local market familiarity (Short/Long bond framing, transparent pre-payment breakdown).
2. Differentiates PrintBit from traditional shops via per-page color coverage pricing.
3. Keeps operator control through admin-configurable pricing rules.
4. Preserves kiosk reliability and financial safety through phased rollout.

## 2. Scope and Boundaries

### In Scope

1. Coverage-aware per-page pricing for print flow.
2. Dedicated async analysis queue and worker (BullMQ + Redis) for pricing analysis jobs.
3. SQLite-backed pricing engine config and analysis cache.
4. API extensions for pricing config and analysis job control.
5. Pricing-surface UI localization for PH terms (Short Bond/Long Bond, Black & White/Colored).
6. Transparent per-page breakdown at pre-payment confirmation.
7. Phased rollout mode (`legacy -> shadow -> live`).

### Out of Scope (for this issue)

1. Ink volume estimation and ink saver mode.
2. Time-of-day/demand dynamic pricing.
3. Full print dispatch queue migration (existing print queue module remains independent).
4. Non-pricing UI terminology overhaul outside pricing surfaces.

## 3. Baselines and Key Constraints

1. **Currency precision constraint:** `whole_peso_total_only`  
   - Per-page pricing may be computed as decimal.
   - Only final payable amount is rounded once, at total-level, to whole peso.
2. **Config storage:** SQLite runtime settings (no LowDB reintroduction).
3. **UI localization scope:** pricing surfaces only for this issue.
4. **Queue strategy:** dedicated analysis queue/worker (separate from print dispatch queue workstream).
5. **Blank page default:** charge zero by default, still admin-configurable.
6. **Rollout:** feature-flag/phased rollout required.

## 4. Product Direction and Differentiator

### Local Baseline

Traditional PH print shops commonly price by:

1. Paper size (short/long bond)
2. B/W vs colored
3. Page count

### PrintBit Differentiator

PrintBit adds measured per-page coverage pricing:

`price_per_page = base_bw + (coverage * color_multiplier)` (bounded by thresholds and full-color cap),
making mixed-document pricing more defensible and transparent.

## 5. Target Architecture

## 5.1 High-Level Flow

1. Upload file into wireless session.
2. Persist uploaded document metadata.
3. Enqueue pricing analysis job (async).
4. Normalize to PDF (when needed).
5. Render/analyze per-page color coverage.
6. Store results in:
   - session document analysis snapshot
   - hash-based analysis cache table
7. Quote endpoint computes per-page and total pricing using active engine config.
8. Confirm-payment uses server quote result as billing source (in `live` mode).

## 5.2 Component Responsibilities

1. **CoverageAnalysisService**
   - Input: normalized PDF + analysis options (gray tolerance, sampling).
   - Output: per-page coverage (`0.0..1.0`) and derived classification metadata.
   - No pricing decisions.
2. **PricingEngineService (pure)**
   - Input: paper profile + page coverage list + copies + pricing config.
   - Output: per-page prices, subtotal, discounts, final payable.
   - Deterministic and side-effect free.
3. **PricingConfigService**
   - Read/write validated pricing config from SQLite runtime settings.
4. **Analysis Queue Worker**
   - Executes expensive analysis and writes results/cache.
5. **AnalysisCacheRepository**
   - File-hash keyed dedupe and reuse of previous analysis outputs.

## 6. Data Design

## 6.1 Runtime Settings Extension

Add `settings.pricingEngine`:

```json
{
  "enabledMode": "legacy",
  "paperProfiles": {
    "shortBond": { "baseBwPrice": 3, "baseColorPrice": 18 },
    "longBond": { "baseBwPrice": 4, "baseColorPrice": 20 }
  },
  "thresholds": {
    "bwMax": 0.05,
    "fullColorMin": 0.60
  },
  "colorMultiplier": 15,
  "blankPagePolicy": "charge_zero",
  "bulkDiscountTiers": [
    { "minPages": 10, "maxPages": 50, "discountPerPage": 0.5 },
    { "minPages": 51, "discountPerPage": 0.75 }
  ],
  "rounding": "whole_peso_total_only"
}
```

## 6.2 Analysis Output Shape

Per page:

```json
{
  "index": 1,
  "coverage": 0.32,
  "classification": "partial",
  "isBlank": false,
  "fallbackReasonFlags": []
}
```

Document aggregate includes:

1. coverage summary stats
2. analysis confidence
3. normalization metadata
4. analyzed timestamp

## 6.3 SQLite Cache Tables

Add cache storage for dedupe:

1. `pricing_analysis_cache`
   - `file_hash` (PK)
   - `content_type`
   - `page_count`
   - `analysis_json`
   - `config_fingerprint`
   - `created_at`
   - `updated_at`
2. Required indexes:
   - `idx_pricing_analysis_cache_updated_at` on `updated_at`
   - `idx_pricing_analysis_cache_config_fingerprint` on `config_fingerprint`

## 7. Pricing Logic

Given coverage `c`:

1. If blank-page policy triggers blank: apply policy default (`charge_zero`).
2. Else if `c <= bwMax`: page = `baseBwPrice`.
3. Else if `c >= fullColorMin`: page = `baseColorPrice`.
4. Else partial:
   - `raw = baseBwPrice + (c * colorMultiplier)`
   - `page = min(raw, baseColorPrice)`

Job total:

1. `subtotalExact = sum(pagePrices * copies)`
2. `discountExact = tierDiscount(totalBillablePages)`
3. `finalExact = max(0, subtotalExact - discountExact)`
4. `finalPayablePeso = ceil(finalExact)`

## 8. API Contracts

## 8.1 Extended `POST /api/print/quote`

Return:

1. per-page breakdown (`coverage`, `classification`, `rawPrice`)
2. subtotal/discount/final exact
3. final payable whole-peso amount
4. pricing mode metadata (`legacy|shadow|live`)

In pending-analysis cases, return a retriable non-success response with explicit code.

## 8.2 New `GET /api/pricing-config`

Returns active pricing engine config relevant to kiosk pricing UI and diagnostics.

## 8.3 New `POST /api/analyze-job`

Supports explicit analysis trigger/retry/status retrieval for operational and admin-driven flows, while automatic enqueue on upload remains primary.

Request:

```json
{
  "sessionId": "uuid",
  "documentId": "doc_uuid",
  "forceReanalyze": false
}
```

Response:

```json
{
  "ok": true,
  "jobId": "pricing-analysis:uuid",
  "status": "queued"
}
```

## 9. UX and Localization (Pricing Surfaces)

Apply PH-localized pricing terms to pricing surfaces only:

1. `Short Bond Paper` / `Long Bond Paper`
2. `Black & White` / `Colored`

Rules:

1. Orientation is not displayed as a pricing factor.
2. Confirm screen shows a clear per-page breakdown table before payment confirmation.
3. Internal enums (`A4`, `Legal`, `Letter`) remain for compatibility; labels map to localized terms in pricing-facing UI.
4. Mapping rule:
   - `A4` and `Letter` -> `shortBond`
   - `Legal` -> `longBond`

## 10. Error Handling and Edge Cases

1. **Scanned PDFs:** classify via measured thresholds, never force B/W assumption.
2. **Near grayscale:** handled by configurable tolerance during analysis.
3. **Blank pages:** configurable policy, default charge zero.
4. **Queue/Redis unavailable:**
   - if valid cached/session analysis exists, use it.
   - otherwise return explicit unavailable/pending error; do not silently fallback to unrelated pricing behavior.
5. **Analysis failures:** emit clear status/error codes for UI retry behavior.

## 11. Infrastructure

1. BullMQ queue dedicated to pricing analysis.
2. Redis as queue broker.
3. Dedicated worker process for normalization + coverage analysis.
4. SQLite cache and config persistence.
5. Existing print dispatch workerization remains separate workstream.

## 12. Rollout Plan

1. **Legacy mode**
   - Billing uses current logic.
2. **Shadow mode**
   - New engine computes in parallel; billing still legacy.
   - Delta logs and confidence checks captured for operator validation.
3. **Live mode**
   - New engine becomes billing source.
   - Legacy retained as fallback mode switch.

## 13. Requirements Checklist Mapping

Issue #125 required items are covered by:

1. Config-driven pure `PricingEngineService` with per-page output.
2. Coverage thresholds and proportional partial-color pricing.
3. Post-sum bulk discount tiers.
4. Config stored in SQLite runtime settings (project-standard equivalent to requested admin-managed config intent).
5. Normalization pipeline to PDF before analysis.
6. Dedicated async queue + worker.
7. Hash-based cache.
8. Transparent pre-payment per-page pricing breakdown.
9. PH-localized pricing terminology on pricing surfaces.
10. `GET /api/pricing-config` and `POST /api/analyze-job` API support.

## 14. Testing Strategy

1. **Unit tests (PricingEngineService)**
   - threshold boundaries (`bwMax`, `fullColorMin`)
   - partial-price clamping
   - blank-page policies
   - bulk tier selection
   - single final rounding behavior
2. **Integration tests**
   - upload -> async analysis -> quote
   - pending analysis response behavior
   - cache hit reuse path
   - config changes affecting new quotes
3. **Regression checks**
   - confirm-payment amount alignment with quote in `live` mode
   - legacy behavior preserved in `legacy` mode

## 15. Risks and Mitigations

1. **Performance under large files**
   - Mitigation: async worker + cache + bounded retries.
2. **User trust risk from decimal vs payable rounding**
   - Mitigation: explicit UI labels for subtotal/discount/final payable rounding.
3. **Operational complexity**
   - Mitigation: phased mode switch with shadow validation before live.
4. **Config misconfiguration**
   - Mitigation: strict server-side validation and safe defaults.

## 16. Implementation Readiness

This design is scoped for phased implementation in the existing architecture, aligned with issue #125 requirements, current SQLite-centric persistence, and current kiosk financial constraints.
