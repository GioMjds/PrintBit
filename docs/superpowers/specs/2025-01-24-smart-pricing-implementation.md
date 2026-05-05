# Implementation Plan: Smart Pricing (Decile Coverage Model)

## 1. Background & Motivation

Transitioning PrintBit to a fairer, usage-based pricing model to gain a competitive edge. The core change involves shifting from simple linear pricing to a 10-tier decile model with proactive user feedback.

## 2. Scope & Impact

- **Impacted Files**:
  - `src/services/pricing-engine.ts` (Logic)
  - `src/services/document-analysis.ts` (Performance/Workers)
  - `src/public/config/app.ts` (UI)
  - `src/public/copy/app.ts` (Integration)
  - `src/core/database/db.ts` (Schema)
- **Scope**: Covers both Print and Copy flows. Includes backend performance optimization.

## 3. Proposed Solution

Implement a decile-based pricing system using Worker Threads for analysis and a "Live Page Meter" for real-time user feedback.

## 4. Alternatives Considered

- **Pure Linear**: Rejected for being too unpredictable for users.
- **Cloud Analysis**: Rejected to ensure kiosk functionality in offline/local environments.

## 5. Phased Implementation Plan

### Phase 1: Backend Refactoring & Workers

1. **Database Schema**: Add `analysis_cache` table to SQLite schema in `src/core/database/sqlite-storage.ts`.
2. **Queue Integration**: Leverage the existing **BullMQ** and **Redis** infrastructure. Update `src/services/pricing-analysis-queue.ts` if needed to handle more granular smart pricing data.
3. **Worker Optimization**: Implement Node.js **Worker Threads** _inside_ the BullMQ workers to handle heavy PDF/Image processing without blocking the main event loop.
4. **Pricing Logic**: Update `pricing-engine.ts` to implement the `getDecileTier(coverage)` function and calculate costs based on decile surcharges.

### Phase 2: Analysis Engine Enhancement

1. **Decile Calculation**: Update `document-analysis.ts` to ensure coverage is accurately normalized for all file types.
2. **Copy Flow Integration**: Ensure `src/public/copy/app.ts` triggers the analysis immediately after the preview scan.

### Phase 3: Frontend UI (Config Page)

1. **PageMeter Component**: Build the CSS/HTML for the "Live Page Meter" in `src/public/config/styles.css`.
2. **Live Feedback**: Update `src/public/config/app.ts` to fetch analysis data and update the meter as the user flips pages.
3. **Smart Suggestions**: Implement the logic to detect "near-tier" boundaries and display the "Savings Hint" toast.

### Phase 4: Admin Settings & Polish

1. **Schema Update**: Update `PricingEngineSettings` in `src/modules/admin/admin.schema.ts` to include an array or record for the 10 decile tier multipliers/prices.
2. **Admin UI Update**: Add a new section in `@src/public/admin/settings/` to allow administrators to configure the cost for each of the 10 tiers.
3. **Smart Suggestion Config**: Allow configuring the "near-tier" proximity threshold (e.g., 2% from the next tier) via the admin panel.
4. **Quote Breakdown**: Update the final quote display to show the count of pages per tier.

## 6. Verification

1. **Automated Tests**:
   - Unit tests for `getDecileTier` logic.
   - Integration tests for Worker Thread communication.
2. **Manual Testing**:
   - Upload a document with 5% color -> Verify "Economy" price.
   - Upload a document with 95% color -> Verify "Full" price.
   - Scan a color document in `/copy` -> Verify smart price appears in preview.

## 7. Migration & Rollback

- **Migration**: Existing "Color Surcharge" will be used as the base for the 100% tier (Tier 10), with other tiers scaled proportionally (10%, 20%, etc.) by default.
- **Rollback**: A toggle in `settings.json` can revert to `legacy` pricing mode, bypassing the decile logic.
