# Homepage UI/UX Redesign Specification

## 1. Overview

The current PrintBit kiosk homepage uses a grid of equal-sized action cards (Print, Copy, Scan) and scatters utilities (Wi-Fi, Language, Feedback) across modals and floating buttons. This redesign moves the interface to a split-pane layout to improve discoverability, reduce clicks, and enhance the overall user experience.

## 2. Architecture & Layout

The interface is divided into two primary zones:

- **Left Sidebar** (Fixed, ~30% viewport width)
- **Main Area** (Dynamic, ~70% viewport width)
- **Top Header** (Fixed across the top of the Main Area)

### 2.1 Left Sidebar

The sidebar serves as the persistent navigation and connectivity hub.

- **Top:** PrintBit Branding / Logo.
- **Middle (Primary Navigation):** Vertical tabs for **Print**, **Copy**, and **Scan**.
  - Tabs will feature distinct icons and typography.
  - The active tab will have a prominent visual indicator (e.g., active background color, right-pointing arrow) connecting it to the Main Area.
- **Bottom:** A permanently displayed ESP32 Wi-Fi QR code.
  - Includes a short text label: "Connect to Kiosk Wi-Fi".
  - Replaces the current `wifi-pill-btn` and modal.

### 2.2 Top Header

The header sits above the Main Area and houses global utilities.

- **Left:** Clock displaying current Time and Date.
- **Right:**
  - **Language Toggle:** EN/FIL toggle button.
  - **Help Menu:** A single dropdown or grouped icon button containing "Report Issue" and "Leave Feedback". This replaces the two floating action buttons (FABs) currently on the bottom right.

### 2.3 Dynamic Main Area

The main content area updates instantly based on the active sidebar selection, removing the need for page reloads or full-screen action modals.

- **Default State:** "Print" is selected by default when the kiosk is idle.
- **Content:** The space will be utilized to show the immediate next steps or step-by-step guides for the selected action (e.g., Print options, Copy instructions, Scan guides).
- **Animations:** Smooth fade/slide transitions when switching between Print, Copy, and Scan views.

## 3. Interaction Flow

1. User approaches the kiosk; the "Print" tab is pre-selected, and print instructions are visible in the Main Area.
2. If the user needs to scan a document, they tap "Scan" in the sidebar. The Main Area instantly updates to show scanning instructions.
3. If the user needs to connect to Wi-Fi to upload a file, the QR code is readily available in the bottom left corner without requiring any clicks.
4. If the user encounters an issue, they tap the Help menu in the top right and select "Report Issue," triggering the relevant QR modal over the interface.

## 4. Technical Constraints

- The UI will be built by updating `src/public/index.html` and `src/public/styles.css`.
- The existing underlying JavaScript logic for modals (Help, Feedback) will be re-wired to the new Top Header triggers.
- Ensure the layout is responsive to the kiosk's exact resolution (prevent scrolling).
