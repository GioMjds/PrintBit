import {
  buildDocxSourcePreviewUrl,
  shouldPreparePreviewInBackground,
} from '../../src/public/config/office-preview';

describe('offline Office previews', () => {
  it('uses the authenticated original DOCX route for browser rendering', () => {
    expect(
      buildDocxSourcePreviewUrl('session id', 'proposal final.docx', 'token+1'),
    ).toBe(
      '/api/wireless/sessions/session%20id/preview?filename=proposal+final.docx&source=1&token=token%2B1',
    );
  });

  it.each(['proposal.docx', 'proposal.DOC', 'proposal.pptx'])(
    'prepares %s without blocking the configuration controls',
    (filename) => {
      expect(shouldPreparePreviewInBackground(filename)).toBe(true);
    },
  );

  it.each(['proposal.pdf', 'photo.png', undefined])(
    'keeps %s on the normal preview path',
    (filename) => {
      expect(shouldPreparePreviewInBackground(filename)).toBe(false);
    },
  );
});
