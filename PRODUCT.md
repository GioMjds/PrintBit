# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Students, faculty, and staff in Philippine campus environments who need quick, self-service document printing, copying, or scanning on the go.

## Product Purpose

A Windows-based, coin-operated self-service kiosk that enables users to print, copy, and scan documents autonomously. Success means users can reliably upload files via their phones, configure jobs on the kiosk, pay with coins accurately, and receive their physical documents and E-Receipts without staff intervention.

## Positioning

A hyper-localized, offline-capable kiosk system that bridges mobile file management (phone-to-kiosk QR hotspot flow) with physical hardware (coin acceptor/hopper via serial, Windows print dispatch, scanners) and PH-specific pricing rules (whole-peso settlement, coverage-aware pricing).

## Operating Context

- Physical campus spaces (hallways, libraries, student centers).
- Interaction spans a mobile device (for upload/receipts via captive portal) and a kiosk touchscreen (for configuration and payment).
- Relies on physical hardware integration: Windows 11 PC, coin acceptor and hopper (115200 baud serial), a supported scanner (NAPS2), and a printer.

## Capabilities and Constraints

- **Capabilities:** Print (PDF, Office, Images), Copy (scan-to-print with preview), Scan (to mobile via QR), E-Receipt generation, and an Admin dashboard.
- **Constraints:** Windows-only runtime. Print dispatch relies on external executables (PDFtoPrinter, GhostScript, LibreOffice). Requires strict hardware coin-flow safety and idempotency. No React/SPA; strictly static HTML/CSS + TS bundles for the frontend.

## Evidence on Hand

- Full Node.js/Express backend and static frontend implementation.
- `printbit.sqlite` state machine.
- Configurable pricing engine for PH context.

## Product Principles

1. **Hardware Reliability First:** Coin payment safety, idempotency, and offline hardware stability take precedence over software features.
2. **Frictionless Mobile Handoff:** The phone-to-kiosk upload flow must be seamless, utilizing the captive portal to bridge the physical-digital gap instantly.
3. **Hyper-localized Settlement:** Pricing and change dispense must strictly adhere to the PH coin ecosystem (whole-peso amounts, threshold-based page classification).
