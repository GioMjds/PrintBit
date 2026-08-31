# Offline Office Preview Design

## Goal

Let customers see uploaded DOCX content promptly without an Internet connection or Docker, while keeping the locally converted PDF as the source of truth for pricing and printing.

## Decision

- Render DOCX in the configuration browser with `docx-preview` from the original, authenticated upload.
- Continue using the existing local pricing-analysis queue to create and analyze the PDF in the background.
- Use LibreOffice before Microsoft Word for conversion because LibreOffice is installed and supports unattended headless conversion; retain Word as a fallback.
- Share one in-flight conversion per cached PDF so preview, colour analysis, and pricing analysis do not launch competing converter processes.
- For legacy DOC, show a non-blocking preparation state while the queued local conversion completes. Do not attempt a browser renderer for DOC.

## Data Flow

1. The upload endpoint persists the original file and immediately enqueues the existing pricing-analysis job.
2. The configuration screen requests the original DOCX through the already authorised session-preview route with an explicit source-mode query parameter.
3. `docx-preview` renders the original into the sandboxed configuration preview. It is visual guidance only.
4. The pricing-analysis worker converts the original to a cached PDF, determines page and colour data, and makes the quote available.
5. The configuration screen lets the customer adjust options while a quote is pending, but keeps Continue disabled until the verified quote is available.
6. DOC keeps its PDF preview path but runs it asynchronously, so the configuration controls do not remain blocked while conversion is pending.

## Constraints

- Fully offline: no cloud conversion, Docker, or customer-document upload outside the kiosk.
- DOCX HTML is rendered inside the existing script-disabled sandboxed iframe.
- Only DOCX receives a browser preview; DOC keeps conversion-based preview for fidelity and safety.
- A completed quote based on PDF analysis remains required before confirmation or printing.

## Failure Handling

- A DOCX browser-rendering failure falls back to the existing converted-PDF preview.
- Conversion failures retain the existing user-facing converter error and prevent confirmation because no quote is issued.
- A missing or expired session remains protected by the existing route guard.

## Verification

- Unit-test converter selection and in-flight deduplication.
- Unit-test DOCX source-mode route behaviour and browser preview type routing.
- Build the client bundle and run focused service/public tests.
- Manually verify DOCX previews before PDF conversion completes, and DOC remains interactive while its preview prepares.
