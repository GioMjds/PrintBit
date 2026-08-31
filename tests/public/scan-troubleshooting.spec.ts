import { getScanTroubleshootingGuide } from '@/public/scan/troubleshooting';

describe('scan troubleshooting guidance', () => {
  it('uses short, plain-language checks for a scanner connection problem', () => {
    expect(getScanTroubleshootingGuide('Scanner connection issue')).toEqual({
      title: 'Scanner needs attention',
      summary: 'Make sure the scanner is switched on, then try again.',
      checks: [
        'Check that the scanner has power.',
        'Wait a moment for it to wake up.',
        'If it still does not work, ask a staff member for help.',
      ],
    });
  });
});
