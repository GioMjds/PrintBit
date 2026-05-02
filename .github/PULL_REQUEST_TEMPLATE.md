# Your Pull Request Title

## Summary

<!-- What changed? Keep it concise and scoped. -->

## Why

<!-- Why is this change needed? Bug fix, reliability, performance, UX, etc. -->

## Scope

<!-- What areas are affected? -->

- [ ] Backend (`src/`)
- [ ] Frontend (`src/public/`)
- [ ] Printing pipeline
- [ ] Database / migrations
- [ ] Hardware interaction (printer / scanner / serial / hotspot)
- [ ] Config / environment

## Changes

<!-- High-level list of changes -->

-

## How to Test

<!-- Provide exact steps to verify locally -->

1.
2.
3.

## Validation Checklist

- [ ] `pnpm exec tsc --noEmit --ignoreDeprecations 6.0` passes
- [ ] App builds (`pnpm run build`) if relevant
- [ ] Manually tested affected flow (UI/API)
- [ ] No regression in:
  - [ ] Upload flow
  - [ ] Print flow
  - [ ] Admin features

## Printing / Hardware Impact

<!-- Required if touching anything related -->

- [ ] No changes to printer integration
- [ ] Safe changes only (no breaking behavior)
- [ ] Graceful fallback verified when hardware unavailable

Notes:

<!-- e.g. tested with no paper, offline printer, etc. -->

## API / Validation Impact

<!-- Required if touching endpoints -->

- [ ] Inputs validated explicitly
- [ ] Errors are actionable and consistent
- [ ] Status codes follow existing patterns

## Database Changes

- [ ] No DB changes
- [ ] Migration required

Details:

<!-- If migration: describe impact and rollback approach -->

## Risks / Edge Cases

<!-- Be explicit. This is critical for kiosk reliability -->

-

## Screenshots / Logs (if applicable)

<!-- UI changes, error logs, printer logs, etc. -->

## Follow-ups

<!-- Non-blocking improvements or deferred work -->

-
