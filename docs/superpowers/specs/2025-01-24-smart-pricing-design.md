# Design Spec: Smart Pricing (Decile Coverage Model)

**Date**: 2025-01-24
**Status**: Draft
**Topic**: Usage-based pricing for PrintBit Kiosks

## 1. Background & Motivation

Currently, PrintBit uses a binary (BW vs. Color) or simple linear pricing model. This often overcharges users for documents with minimal color (e.g., a small red logo) and undercharges for high-ink full-page photos. "Smart Pricing" aims to bridge this gap by introducing 10 granular price tiers based on ink coverage, making the service fairer and more competitive.

## 2. Proposed Solution

### A. The Decile Tier Model

Pricing will be divided into 10 tiers (0% to 100% coverage, in 10% increments).

- **Tier 0 (0%)**: Blank Page (₱0 or per policy).
- **Tier 1 (1-10%)**: Economy Color (Base BW + 10% of Color Surcharge).
- **Tier 2 (11-20%)**: Light Color.
- ...
- **Tier 10 (91-100%)**: Full Premium Color.

### B. Backend Analysis (The "Smart" part)

- **Immediate Analysis**:
  - **Print**: Triggered immediately upon file upload.
  - **Copy**: Triggered immediately after the preview scan of the glass.
- **Worker Threads**: Analysis is offloaded to a separate Node.js worker thread to ensure the kiosk UI remains responsive during heavy PDF processing.
- **Caching**: Results are cached by file hash in the SQLite database to avoid re-computing common documents.

### C. UI / UX Integration

- **Live Page Meter**: A visual gauge in the `/config` preview showing:
  - Current page color coverage percentage.
  - Current price tier icon/label.
- **Smart Suggestions**: A notification area that alerts users to potential savings.
  - Example: "Page 4 is 12% color. If you change it to Grayscale, you save ₱5."

## 3. System Flow

### Print Flow

1. User uploads `file.pdf`.
2. Server receives file, calculates hash, and checks cache.
3. If not cached, a **Worker Thread** starts `analyzeDocument()`.
4. User clicks "Proceed to Config".
5. `/config` page fetches the analysis.
6. User navigates pages; the **Live Page Meter** updates.
7. User adjusts settings (e.g., grayscale certain pages).
8. Final Quote reflects the decile-based breakdown.

### Copy Flow

1. User places document on glass and taps "Check Document".
2. Scanner performs a low-res preview scan.
3. **Analysis Engine** processes the preview image immediately.
4. UI displays the "Smart Price" based on the detected coverage.
5. User confirms and proceeds to payment.

## 4. Technical Requirements

- **Backend**: Update `pricing-engine.ts` to support decile tiers.
- **Backend**: Implement `worker-thread` pool for `document-analysis.ts`.
- **Frontend**: New `PageMeter` component in `src/public/config/app.ts`.
- **Database**: Add `analysis_cache` table to store results.

## 5. Scaling & Performance

- **Image Downsampling**: Analyze images at a max resolution of 1024px to speed up calculation without losing tier accuracy.
- **Parallelism**: Allow up to 2 concurrent analysis jobs (limited by CPU cores on kiosk hardware).

## 6. Verification Plan

- **Unit Tests**: Verify that a 5% coverage page consistently falls into Tier 1.
- **Integration Tests**: Ensure large 50-page PDFs don't block the UI during upload.
- **UI Test**: Confirm the Live Page Meter updates correctly when flipping pages.
