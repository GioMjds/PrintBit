# Homepage UI/UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Kiosk homepage (`index.html`) into a split-pane layout (Sidebar + Main Area) to improve discoverability and reduce clicks.

**Architecture:** The HTML structure will be updated to a CSS Grid/Flexbox layout with a fixed left sidebar and a dynamic main content area. `app.ts` will manage state for switching between the main views (Print/Copy/Scan) without page reloads, and the Wi-Fi QR code will be permanently rendered in the sidebar instead of a modal.

**Tech Stack:** HTML5, CSS3, TypeScript (bundled via existing build step).

**Spec:** `docs/superpowers/specs/2026-08-21-homepage-redesign-design.md`

## Global Constraints

- Do not modify backend routes or socket logic.
- Ensure the layout is responsive to the kiosk's exact resolution (prevent scrolling).
- Existing modals (Report Issue, Feedback) should be preserved but triggered from the new Help menu.

---

### Task 1: HTML Structure Overhaul

**Files:**

- Modify: `src/public/index.html`

**Interfaces:**

- Produces: New DOM structure (`.sidebar`, `.topbar`, `.main-content`, `#print-view`, `#copy-view`, `#scan-view`, `#wifi-sidebar-qr`)

- [ ] **Step 1: Restructure the main shell**
      Update `index.html` to split `.kiosk-shell` into two main areas: a `<aside class="sidebar">` and a `<div class="content-pane">`.

- [ ] **Step 2: Build the Sidebar**
      Inside `.sidebar`, add:
- A branding logo header.
- A navigation list with buttons for Print, Copy, and Scan (`id="navPrint"`, `id="navCopy"`, `id="navScan"`).
- A bottom section for the Wi-Fi QR code (`<canvas id="sidebarWifiQrCanvas"></canvas>`), replacing the old `wifiOverlay` modal.

- [ ] **Step 3: Build the Header (Topbar)**
      Move the `.topbar` inside the `.content-pane`. Update its right side to contain:
- An EN/FIL language toggle button (`id="langToggleBtn"`).
- A Help dropdown or grouped button container for "Report Issue" (`id="openReportBtn"`) and "Feedback" (`id="openFeedbackBtn"`).

- [ ] **Step 4: Build the Main Content Area**
      Below `.topbar`, add `<main class="main-content">`. Inside it, create three container divs:
- `<div id="print-view" class="view-pane active">`
- `<div id="copy-view" class="view-pane" style="display: none;">`
- `<div id="scan-view" class="view-pane" style="display: none;">`
  Move the existing instructional content or action buttons (like `openPrintBtn` card internals) into these respective views.

- [ ] **Step 5: Commit**

```bash
git add src/public/index.html
git commit -m "feat: restructure homepage HTML for split-pane layout"
```

### Task 2: CSS Layout & Styling

**Files:**

- Modify: `src/public/styles.css`

**Interfaces:**

- Consumes: DOM structure from Task 1.

- [ ] **Step 1: Layout Grid/Flexbox**
      Update `.kiosk-shell` in `styles.css` to display as flex or grid, splitting 30% width for `.sidebar` and 70% for `.content-pane`.

- [ ] **Step 2: Style the Sidebar**
      Add CSS for `.sidebar`:
- Background color matching the kiosk theme.
- Flex column layout to push the Wi-Fi QR code to the bottom.
- Style the navigation buttons, including an `.active` state (e.g., brand color background and a right-pointing indicator).

- [ ] **Step 3: Style the Header & Views**
      Update `.topbar` styles to fit the new constrained width.
      Add styles for `.view-pane` to handle fade transitions when switching views.

- [ ] **Step 4: Commit**

```bash
git add src/public/styles.css
git commit -m "style: apply split-pane layout and sidebar styling"
```

### Task 3: JavaScript Logic & Interaction

**Files:**

- Modify: `src/public/app.ts`

**Interfaces:**

- Consumes: DOM elements from Task 1.

- [ ] **Step 1: Wire up Navigation Tab Switching**
      In `app.ts`, add event listeners to `navPrint`, `navCopy`, and `navScan`.
      When clicked, hide all `.view-pane` elements and show the corresponding one. Update the `.active` class on the navigation buttons.

- [ ] **Step 2: Update Wi-Fi QR Targeting**
      Update the `renderHomeWifiQr()` function in `app.ts` to target `sidebarWifiQrCanvas` instead of `homeWifiQrCanvas`. Remove the event listeners that open/close the old Wi-Fi modal.

- [ ] **Step 3: Compile and Test**
      Run the build script to compile `app.ts` into `bundle.js` and start the server to verify the homepage renders correctly and the tabs switch properly.

```bash
pnpm run build
pnpm start
```

- [ ] **Step 4: Commit**

```bash
git add src/public/app.ts
git commit -m "feat: implement sidebar navigation and persistent Wi-Fi QR logic"
```
