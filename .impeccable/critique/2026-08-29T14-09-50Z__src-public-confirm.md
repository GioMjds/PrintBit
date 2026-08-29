---
target: src/public/confirm
total_score: 37
max_score: 40
na_heuristics: 
p0_count: 2
p1_count: 2
timestamp: 2026-08-29T14-09-50Z
slug: src-public-confirm
---
#### Design Health Score

| # | Heuristic | Score | Key Issue |
|---|---|:---:|---|
| 1 | Visibility of System Status | 4 | Real-time SVG circular meter, animated counter, status badge (`waiting`/`ready`/`error`), coin toasts, and print progress bar. |
| 2 | Match System / Real World | 4 | Physical kiosk coin slot simulator with DotLottie animation, Philippine peso (`₱`), and paper conventions (*A4*, *Short/Long Bond*). |
| 3 | User Control and Freedom | 3 | Topbar back navigation and error recovery controls (`Pause`, `Resume`, `Cancel Remaining`); lacks a pre-confirm "Cancel & Return Coins" button. |
| 4 | Consistency and Standards | 4 | Strict adherence to "The Midnight Interface" design tokens, typography scale, and green confirmation affordances. |
| 5 | Error Prevention | 4 | Triple-gated confirmation button (balance + printer ready + quote), physical paper tray verification, and automatic coin slot lock. |
| 6 | Recognition Rather Than Recall | 4 | Bento grid keeps page range, billable B&W/color breakdown, color mode overrides, and copies visible throughout. |
| 7 | Flexibility and Efficiency | 3 | High tactile touchscreen targets (48px–64px); 3-click modal sequence can feel slow for trivial 1-page prints. |
| 8 | Aesthetic and Minimalist Design | 4 | Clean dark frosted glass aesthetic with high-contrast neon accents, guidance flow from Left (Pay) → Center (Verify) → Right (Confirm). |
| 9 | Help Users Recognize, Diagnose, & Recover from Errors | 4 | Error modal categorizes severity (`fatal`/`recoverable`), plain language diagnostics, and actionable spooler buttons. |
| 10 | Help and Documentation | 3 | Clear inline tips for coin insertion speed and tray alerts; missing persistent quick-help / pricing rate card trigger. |
| **Total** | | **37/40** | **Excellent (92.5%)** |

#### Design Specificity Verdict

**LLM Assessment**: Highly specific and non-interchangeable. The layout, interaction model, and hardware bridges (coin slot DotLottie animation, physical slot lock signaling, Windows Spooler error containment, hopper deficit refund references, and 2-step paper tray gating) are authored specifically for an unattended document kiosk.

**Deterministic Scan**: 14 color advisory notices (9 false positives from intentional semantic green/amber/red alert tokens, 5 true positives from raw hex/Tailwind values in metric pills), 7 bounce-easing notices (overshooting cubic-bezier values), and 3 undersized micro-label notices (< 11px).

#### Overall Impression
A production-grade, tactile dark-mode kiosk interface that balances hardware control with visual clarity. The Bento job summary and animated coin slot make the transaction tangible and reassuring, with minor refinement needed in touch target standards, contrast ratios, and motion easing.

#### What's Working
1. **Hardware-Synchronized Visual & Tactile Feedback**: Tight coupling between physical coin drops, DotLottie slot animation, circular stroke-dash meters, and dynamic slot lock state.
2. **Transparent Billing & Bento IA**: Crystal-clear separation of billable B&W vs. color pages, detected vs. selected overrides, and live calculated change.
3. **Multi-Tier Fault Resilience**: Non-destructive printer error handling with in-flight progress tracking and staff claim reference generation.

#### Priority Issues
- **[P0] Touch Target Regression in Modal Buttons**: `.modal-btn` declared `min-height: 42px`, overriding the 44px minimum touch target standard for touchscreen kiosks (`styles.css:1645`).
- **[P0] Missing Keyframe Declarations**: `@keyframes row-in` and `@keyframes badge-slide-up` referenced in CSS rules without corresponding `@keyframes` declarations (`styles.css:899, 1967`).
- **[P1] Lack of Pre-Confirm Coin Return / Refund Trigger**: No software button to cancel and eject inserted coins before tapping confirm, risking stranded funds if the user realizes a mistake.
- **[P1] Accessibility Contrast & Sub-Floor Typography**: Micro-labels under 11px (`.metric-pill__label`, `.modal-bento-badge`, `.scan-qr-expiry`) and low-opacity helper text failing WCAG AA 4.5:1 contrast under kiosk lighting.
- **[P2] Overshooting Motion Curves**: Rubbery `cubic-bezier(0.34, 1.56, 0.64, 1)` easing curves that trigger bounce-easing warnings; standardizing to clean deceleration curves will feel more solid.

#### Persona Red Flags
- **Alex (Impatient Power User)**: Forced 3-step modal sequence (Confirm → Check Paper Tray → Print Now) creates friction for quick single-sheet prints.
- **Jordan (Confused First-Timer)**: Potential confusion if coins are inserted too rapidly and debouncing delays balance display, without an obvious "Help / Coin Return" button.
- **Sam (Accessibility & Low-Vision Kiosk User)**: Sub-12px micro-labels and muted opacity text are difficult to read under overhead glare; missing `aria-valuemax` on the balance meter.

#### Minor Observations
- Missing `prefers-reduced-motion` media queries for continuous pulse and drift animations.
- Repetitive price display across middle footer and right column banner.
- Button box-shadow pulse loops cause non-composite paint cycles.

#### Questions to Consider
- Should single-page standard prints offer a streamlined 1-tap confirmation when printer sensors confirm tray readiness?
- Should the middle column footer display a unit rate breakdown (e.g. `₱3.00/page`) rather than repeating the total price from the right column?
- What would a dedicated "Cancel & Eject Coins" hardware integration look like in the payment column?
