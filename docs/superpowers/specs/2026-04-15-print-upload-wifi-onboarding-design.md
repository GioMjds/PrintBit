# PrintBit Print Upload Wi-Fi Onboarding Design

## Problem
End-users can upload successfully only when their phone is on the same network as the kiosk, but many users do not reliably reach that state. We need a clear, local-network-first workflow that guides users into PrintBit Wi-Fi and then into `/upload/{token}` with minimal friction.

## Constraints
- Kiosk is local-network only (no public URL/tunnel).
- Primary desired flow: users join PrintBit Wi-Fi first, then upload via QR.
- Existing wireless session/token upload backend should remain in use.

## Chosen Approach
Use a **guided Wi-Fi join + upload QR** flow on the print page, with captive-portal fallback support.

## End-User Workflow
1. User taps **Print** on kiosk.
2. Kiosk UI shows:
   - Step 1: Join **PrintBit Wi-Fi** (SSID/password + Wi-Fi QR)
   - Step 2: Scan upload QR
3. Phone joins PrintBit AP.
4. Phone opens `/upload/{token}` (QR or `http://192.168.4.1` captive bridge path).
5. User uploads files; kiosk file list updates in real time.
6. If session expires, user taps **New session** on kiosk and re-scans.

## System Design
### Print Page (`src/public/print`)
- Primary onboarding surface.
- Shows upload QR and explicit network-first instruction text.
- Adds/uses Wi-Fi QR content for quick AP join.
- Keeps session refresh and session expiry recovery behavior.

### Upload Page (`src/public/upload`)
- Remains upload endpoint UI for tokenized sessions.
- Keeps captive-webview detection and “Open in browser / Copy link” recovery banner.
- Keeps existing upload progress and socket feedback.

### ESP32 Captive Portal (`esp32-captive-portal.ino` + `/portal`)
- Recovery bridge when users open AP captive page.
- `/portal` should continue redirecting to active upload session if present.
- If no active session exists, show waiting/retry guidance.

### Backend Session/Portal Modules
- Continue using `/api/wireless/sessions` and token-based upload routes.
- No new protocol or storage model required for this design.

## Data Flow
1. `/print` requests new wireless session.
2. Backend returns `sessionId`, `token`, `uploadUrl`.
3. Print page renders upload QR and guidance.
4. Upload page resolves token via `/api/wireless/sessions/by-token/:token`.
5. File upload goes through `/api/wireless/sessions/:sessionId/upload?token=...`.
6. Socket events (`UploadCompleted`, analysis events) update upload + print UIs.

## Failure Handling
- **Wrong network / cannot reach upload:** direct user to join PrintBit Wi-Fi first.
- **Captive mini-browser limitations:** show “Open in browser” and copy link action.
- **Expired session:** show explicit refresh path (“New session” + rescan).
- **Session owned by another phone:** explicit conflict message and restart guidance.

## Validation Targets
- First-time user reaches upload page in <= 3 actions: tap Print -> join Wi-Fi -> scan upload QR.
- Upload success remains equivalent to current same-network test behavior.
- Recovery messages are explicit and actionable for each known failure mode.

## Out of Scope
- Internet/mobile-data upload while kiosk is local-only.
- New non-network transfer channels (USB/Bluetooth/NFC).
- Pricing/payment flow changes.
