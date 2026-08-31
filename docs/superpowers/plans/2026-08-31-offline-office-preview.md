# Offline Office Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render DOCX previews locally without blocking customers on PDF conversion, while retaining local PDF analysis for pricing and printing.

**Architecture:** Add a source mode to the authorised preview route, render DOCX with a bundled browser renderer, and leave the existing pricing-analysis queue responsible for PDF conversion. The conversion service coalesces duplicate requests and prefers installed LibreOffice before the Word fallback.

**Tech Stack:** TypeScript, Express, Jest, esbuild, docx-preview, LibreOffice.

**Spec:** `docs/superpowers/specs/2026-08-31-offline-office-preview-design.md`

## Global Constraints

- No Docker, cloud service, or Internet dependency.
- DOCX browser preview is advisory; PDF analysis is mandatory for a quote and print.
- DOC uses only the local conversion path.
- Do not touch unrelated dirty files.

---

### Task 1: Local conversion coordination

**Files:**
- Modify: `src/services/preview.ts`
- Test: `tests/services/preview.spec.ts`

**Interfaces:**
- Produces: `PreviewService.convertToPdfPreview(sourcePath): Promise<string>` with one shared conversion per cached PDF.

- [ ] Write failing tests proving concurrent requests for the same source share one conversion and that LibreOffice is preferred when available.
- [ ] Run `pnpm test tests/services/preview.spec.ts` and observe the missing coordination failure.
- [ ] Implement a private in-flight conversion map and make LibreOffice the first converter, with Word retained as DOC/DOCX fallback.
- [ ] Run `pnpm test tests/services/preview.spec.ts` and confirm it passes.

### Task 2: Authenticated DOCX source and browser preview

**Files:**
- Modify: `src/modules/wireless-session/wireless-session.service.ts`
- Modify: `src/public/config/app.ts`
- Modify: `package.json`, `pnpm-lock.yaml`
- Test: `tests/modules/wireless-session/wireless-session.service.spec.ts`
- Test: `tests/public/config-docx-preview.spec.ts`

**Interfaces:**
- Consumes: `GET /api/wireless/sessions/:sessionId/preview?filename=<name>&source=1`.
- Produces: direct DOCX bytes only after existing session authorisation.

- [ ] Write failing route and preview-routing tests for source DOCX and local rendering.
- [ ] Run the focused tests and observe failure because source mode and renderer do not exist.
- [ ] Add `docx-preview`, source mode, and a DOCX renderer that writes only into the sandboxed preview iframe.
- [ ] Run focused tests and confirm they pass.

### Task 3: Non-blocking Office preparation

**Files:**
- Modify: `src/public/config/app.ts`
- Test: `tests/public/config-office-preparation.spec.ts`

**Interfaces:**
- Consumes: an Office filename and the existing `PrintPreview` instance.
- Produces: responsive configuration controls while conversion and quote analysis continue.

- [ ] Write failing tests proving DOCX starts local rendering and DOC starts PDF preparation without awaiting conversion.
- [ ] Run the focused test and observe failure.
- [ ] Start Office preview, colour analysis, and quote refresh without holding the page preparation overlay; keep Continue controlled by the verified quote.
- [ ] Run focused tests, then `pnpm run build`.
