---
applyTo: 'src/public/**'
---

# PrintBit — Frontend conventions (`src/public/`)

## Architecture

1. All browser UI is **static HTML + vanilla TypeScript** - no React, no Vue, no framework.
2. TypeScript files under `src/public/` are compiled by `pnpm run build` into browser bundles.
3. Do not add framework dependencies to the frontend unless the user explicitly asks for that change in the current chat.

## Socket.IO usage (browser side)

1. Connect to the kiosk server via `io()` (no explicit URL needed; same-origin).
2. Always handle disconnection and reconnection states visibly for the kiosk user.
3. If the connection cannot be re-established within 30 seconds, show a clear error state with a visible retry action.
4. Event names must match exactly what the server emits in `src/services/`.

## UI/UX constraints

1. Touch interaction: this is a **touch kiosk**; tap targets must be large (>=48px), with no hover-only interactions.
2. Localization: UI supports English and Tagalog via i18next; do not hardcode user-facing strings; use translation keys.
3. Input model: do not add mouse-centric controls (right-click menus, drag-and-drop) as primary interactions.

## Coin/payment UI

1. Coin balance display must update in real time via Socket.IO events.
2. The confirm screen coin slot lock (padlock animation) is driven by `lockCoinSlot` / `unlockCoinSlot` socket events - do not remove.
3. Payment states (insufficient / met / overpaid) must remain visually distinct.

## File placement

1. Each page has its own folder: `src/public/<page>/index.html`, `<page>.ts`, `<page>.css`.
2. Shared utilities go in `src/public/shared/` or `src/public/utils/`.
3. Do not co-locate page-specific logic in shared files.

## Build validation

1. After any change to `src/public/**/*.ts`, run `pnpm run build` and confirm it exits cleanly.
2. Type errors in browser TS are caught by `pnpm exec tsc --noEmit --ignoreDeprecations 6.0`.
