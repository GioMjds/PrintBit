import { getPreviewRequestTimeoutMs } from '../../src/public/config/preview-timeout';

describe('getPreviewRequestTimeoutMs', () => {
  test.each(['proposal.doc', 'proposal.docx', 'PROPOSAL.DOCX'])(
    'allows a Word document conversion to run before timing out: %s',
    (filename) => {
      expect(getPreviewRequestTimeoutMs(filename)).toBe(75_000);
    },
  );

  test('keeps the standard preview timeout for an already-renderable PDF', () => {
    expect(getPreviewRequestTimeoutMs('proposal.pdf')).toBe(20_000);
  });
});
