# Print Color/Grayscale Page-Count Design

Date: 2026-04-25
Author: GioMjds (with Copilot)

## Overview
Add per-print-job counts for colored vs grayscale pages and surface them in the admin UI. These counts will support ink monitoring and reporting per transaction.

## Goals
- Compute colorPages and bwPages per print-job (per-transaction).
- Use existing document-analysis per-page metadata (isColor) as the primary detection source.
- Respect print-mode (e.g. requested grayscale conversion) at dispatch time.
- Persist counts with the print job/transaction and include them in admin endpoints and UI.

## Detection approach (chosen)
- Use the existing document-analysis output created at upload time. That module already emits per-page isColor flags and pageCount.
- At dispatch, compute counts by summing isColor flags and adjusting for explicit print-mode (if dispatch options request grayscale, treat pages as bw).
- Fallback: if per-page metadata missing, fall back to pageCount with colorPages=0.

## Data flow
1. Upload → document-analysis → per-page metadata stored in session/document record.
2. User confirms print/checkout → dispatch pipeline reads per-page metadata.
3. Dispatch step computes colorPages and bwPages (considering requested print-mode) and attaches them to dispatchResult/print job.
4. Persist counts in the print job / transaction record and write to admin logs (print_dispatch_summary).
5. Admin APIs return counts; UI displays in transaction list/detail and dashboard.

## Schema & persistence
- Add fields to print job / transaction storage (nullable integers):
  - color_pages INTEGER NULL
  - bw_pages INTEGER NULL
- Preferred location: extend print-job schema (src/modules/print-queue/print-job.schema.ts) and persist alongside existing dispatch metadata. Also include counts in print_dispatch_summary log entries.
- Migration: Add columns as nullable; backfill not required for existing historical rows.

## API & service changes
- Compute counts during dispatch in src/services/print-dispatcher.ts or src/services/print-spooler.ts (where dispatchResult is assembled).
- Ensure modules that record dispatch metadata (modules/admin/admin.service.ts and admin.controller.ts) include color_pages and bw_pages in responses.
- Add TypeScript types where applicable (e.g., extend PrintDispatchResult type and print-job schema interfaces).

## UI changes
- Update admin transactions list and transaction detail to show "Color pages" and "BW pages" columns (files: src/public/admin/transactions/app.ts, src/public/admin/dashboard/app.ts).
- Small UX: show counts in summary row and detail modal; tooltip explaining detection source and caveats.

## Logging & observability
- Include counts in existing print_dispatch_summary admin log entries so historical audits capture page composition.
- Emit a metric/event for dispatch_count.{colored,bw} to support future aggregation.

## Error handling & fallbacks
- If per-page metadata missing or invalid, set color_pages=null and bw_pages=null and surface "unknown" in UI.
- If print-mode requests grayscale, counts reflect post-conversion result (i.e., all pages counted as BW).

## Testing
- Unit tests: document-analysis (per-page isColor detection), dispatch counting logic (respecting print-mode), admin.service response shape.
- Integration: end-to-end test with sample PDFs: all-BW, mixed color/BW, converted-grayscale dispatch.
- Manual verification: print a known 3-page mixed PDF and confirm admin shows expected counts.

## Files to change (non-exhaustive)
- src/services/document-analysis.ts (verify/ensure per-page isColor output)
- src/services/session.ts (verify session stores per-page metadata)
- src/services/print-dispatcher.ts or src/services/print-spooler.ts (compute counts at dispatch)
- src/modules/print-queue/print-job.schema.ts (extend schema)
- src/modules/admin/admin.service.ts and admin.controller.ts (include counts in API)
- src/public/admin/transactions/app.ts and src/public/admin/dashboard/app.ts (UI)
- tests/** (new unit/integration tests)

## Acceptance criteria
- New print jobs persisted include color_pages and bw_pages for recent dispatches.
- Admin transactions list and detail show accurate color and BW page counts for sample PDFs.
- Tests added and passing locally (type-check and unit tests).

## Rollout notes
- No DB blocking migration required; columns are nullable.
- Start by exposing counts only for new dispatches; consider later backfill if needed.

---
Next step: implement per-file changes and the migration plan. After this spec is reviewed, an implementation plan will be created.
