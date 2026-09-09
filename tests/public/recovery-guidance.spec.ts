import { getMaintenanceGuidance } from '../../src/public/confirm/recovery-guidance';

describe('maintenance guidance', () => {
  test('turns a technical printer failure into a plain-language staff instruction', () => {
    const guidance = getMaintenanceGuidance(
      'PAPER_JAM_PRINT',
      'Spooler HRESULT 0x0000001',
    );
    expect(guidance.title).toBe('Paper Jam Detected');
    expect(guidance.badge).toBe('Paper Jam');
    expect(guidance.message).toBe(
      'A sheet of paper got stuck inside the printer during printing.',
    );
    expect(guidance.hint).toBe(
      'Show your transaction ID and receipt to staff for assistance or a refund.',
    );
  });

  test('keeps a customer-safe error message when no technical recovery template applies', () => {
    const guidance = getMaintenanceGuidance(
      'UNKNOWN',
      'The printer needs attention before continuing.',
    );
    expect(guidance.title).toBe('Printing Needs Staff Assistance');
    expect(guidance.badge).toBe('Staff Assistance');
    expect(guidance.message).toBe(
      'The printer needs attention before continuing.',
    );
    expect(guidance.hint).toBe(
      'Show the transaction ID and receipt below to the kiosk staff.',
    );
  });
});
