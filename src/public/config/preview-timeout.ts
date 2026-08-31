const STANDARD_PREVIEW_TIMEOUT_MS = 20_000;
const WORD_DOCUMENT_PREVIEW_TIMEOUT_MS = 75_000;

export function getPreviewRequestTimeoutMs(filename?: string): number {
  const extension = filename?.split('.').pop()?.toLowerCase();
  return extension === 'doc' || extension === 'docx'
    ? WORD_DOCUMENT_PREVIEW_TIMEOUT_MS
    : STANDARD_PREVIEW_TIMEOUT_MS;
}
