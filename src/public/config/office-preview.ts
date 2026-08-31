import { renderAsync } from 'docx-preview';

const BACKGROUND_OFFICE_EXTENSIONS = new Set(['doc', 'docx', 'ppt', 'pptx']);

function getExtension(filename?: string | null): string {
  const match = /\.([^.]+)$/.exec(filename?.trim() ?? '');
  return match?.[1]?.toLowerCase() ?? '';
}

export function shouldPreparePreviewInBackground(
  filename?: string | null,
): boolean {
  return BACKGROUND_OFFICE_EXTENSIONS.has(getExtension(filename));
}

export function isDocxPreview(filename?: string | null): boolean {
  return getExtension(filename) === 'docx';
}

export function buildDocxSourcePreviewUrl(
  sessionId: string,
  filename: string,
  token?: string | null,
): string {
  const params = new URLSearchParams({ filename, source: '1' });
  if (token) params.set('token', token);
  return `/api/wireless/sessions/${encodeURIComponent(sessionId)}/preview?${params.toString()}`;
}

export async function renderDocxPreview(source: ArrayBuffer): Promise<string> {
  const previewDocument = document.implementation.createHTMLDocument(
    'Document preview',
  );
  await renderAsync(source, previewDocument.body, previewDocument.head, {
    breakPages: true,
    ignoreLastRenderedPageBreak: false,
    inWrapper: true,
    renderFooters: true,
    renderHeaders: true,
  });

  return `<!doctype html>${previewDocument.documentElement.outerHTML}`;
}
