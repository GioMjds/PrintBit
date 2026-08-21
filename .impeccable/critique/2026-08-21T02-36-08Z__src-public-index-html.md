---
target: src/public/index.html
total_score: 31
max_score: 36
na_heuristics: 7
p0_count: 1
p1_count: 1
timestamp: 2026-08-21T02-36-08Z
slug: src-public-index-html
---
Method: ⚠️ DEGRADED: single-context (inline execution to handle multi-command request `audit shape critique` efficiently)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Good feedback on modals, lacks main print status |
| 2 | Match System / Real World | 4 | "Print", "Copy", "Scan" are instantly recognizable |
| 3 | User Control and Freedom | 3 | Good modal dismissals, lacks top-level back/cancel |
| 4 | Consistency and Standards | 4 | Cards and modals perfectly match the design system |
| 5 | Error Prevention | 3 | PIN modal has error handling, action targets are large |
| 6 | Recognition Rather Than Recall | 4 | Everything visible; icons paired with text |
| 7 | Flexibility and Efficiency | n/a | Kiosk interface; power user shortcuts do not apply |
| 8 | Aesthetic and Minimalist Design | 4 | Deep space blue with glowing accents perfectly executed |
| 9 | Error Recovery | 2 | Not many error states present in HTML |
| 10 | Help and Documentation | 4 | Guide modals available for each main action |
| **Total** | | **31/36** | **Good** |

### Design Specificity Verdict

**LLM assessment**: Highly specific and grounded. The "Midnight Interface" matches a coin-operated kiosk environment perfectly. The use of large tactile surfaces, glowing neon accents, and dark mode ensures readability and physical touchability in varied lighting.

**Deterministic scan**: No detector issues found (clean run, fallback mode).

### Overall Impression
The interface looks beautiful and adheres closely to the DESIGN.md "Midnight Interface" guidelines. It is sleek, legible, and functional. However, there is a critical accessibility/HTML-structure flaw: nested interactive elements within the main action cards.

### What's Working
- **Design System Adherence**: The components perfectly reflect the glass, depth, and glow characteristics established in the design system.
- **Kiosk Appropriateness**: The oversized touch targets, distinct color coding (pink, peach), and 3-column layout are perfectly tailored for a physical kiosk.

### Priority Issues

- **[P0] Nested Interactive Elements**
  - **Location**: `src/public/index.html` lines 61, 143, 216
  - **Why it matters**: A `<span>` acting as a help button is placed inside `<button class="action-card">`. Buttons cannot contain other interactive elements. This completely breaks screen readers and creates click-event conflicts.
  - **Fix**: Change the action cards to semantic containers (`<div>` or `<section>`), and ensure the primary action and the help action are separate `<button>` elements.
  - **Suggested command**: `$impeccable harden`

- **[P1] Accessibility Blockers on Viewport & Help Icons**
  - **Location**: `src/public/index.html` lines 5, 62
  - **Why it matters**: `user-scalable=no` prevents low-vision users from zooming. The help icons (`<span class="action-card__help">`) lack `role="button"` and `tabindex="0"`, making them unreachable via keyboard.
  - **Fix**: Remove scaling restrictions from the meta viewport. Convert the help spans to actual `<button type="button">`.
  - **Suggested command**: `$impeccable adapt`

- **[P2] Missing Error States**
  - **Location**: Global
  - **Why it matters**: Outside of the admin PIN modal, there's no visible error handling (e.g., "Out of paper", "Scanner error").
  - **Fix**: Add a unified error or system status modal/banner for hardware failures.
  - **Suggested command**: `$impeccable onboard`

### Persona Red Flags

**Sam (Accessibility-Dependent User)**:
- Cannot access the help guides because the `?` icons are `<span>` elements without focusability, trapped inside a larger `<button>`. Screen readers will treat the entire card as a single opaque button and miss the help feature entirely.

**Jordan (Confused First-Timer)**:
- Will have an easy time finding the primary actions, but if hardware fails (e.g., out of paper), they will be stranded since there are no visible system error states built into the main view.

### Minor Observations
- The tabular time rule is noted in the design system. Ensure `font-variant-numeric: tabular-nums` is applied in the CSS to `#clockTime`.
- The Wi-Fi modal uses a small QR code canvas (220x220). Ensure it's scannable from a typical physical distance for a kiosk.

### Questions to Consider
- What happens if the kiosk goes offline? Should the Wi-Fi pill indicate "Offline" instead of "Scan QR"?
- How do users know the price of printing or scanning before starting the flow?
