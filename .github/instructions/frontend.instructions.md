---
applyTo: 'src/public/**'
---

# PrintBit — Frontend conventions (`src/public/`)

## Architecture

- All browser UI is **static HTML + vanilla TypeScript** — no React, no Vue, no framework.
- TypeScript files under `src/public/` are compiled by `pnpm run build` into browser bundles.
- Do not add framework dependencies to the frontend without explicit user request.

## Socket.IO usage (browser side)

- Connect to the kiosk server via `io()` (no explicit URL needed; same-origin).
- Always handle disconnection and reconnection states visibly for the kiosk user.
- Event names must match exactly what the server emits in `src/services/`.

## UI/UX constraints

- This is a **touch kiosk** — tap targets must be large (≥48px), no hover-only interactions.
- Language: UI supports English and Tagalog via i18next — do not hardcode user-facing strings; use translation keys.
- Do not add mouse-centric controls (right-click menus, drag-and-drop) as primary interactions.

## Coin/payment UI

- Coin balance display must update in real time via Socket.IO events.
- The confirm screen coin slot lock (padlock animation) is driven by `lockCoinSlot` / `unlockCoinSlot` socket events — do not remove.
- Payment states (insufficient / met / overpaid) must remain visually distinct.

## File placement

- Each page has its own folder: `src/public/<page>/index.html`, `<page>.ts`, `<page>.css`.
- Shared utilities go in `src/public/shared/` or `src/public/utils/`.
- Do not co-locate page-specific logic in shared files.

## Build validation

- After any change to `src/public/**/*.ts`, run `pnpm run build` and confirm it exits cleanly.
- Type errors in browser TS are caught by `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`.
