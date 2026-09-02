import { getMaintenanceGuidance } from '../../src/public/confirm/recovery-guidance';

describe('maintenance guidance', () => {
  test('turns a technical printer failure into a plain-language staff instruction', () => {
    expect(
      getMaintenanceGuidance('PAPER_JAM_PRINT', 'Spooler HRESULT 0x0000001'),
    ).toEqual({
      title: 'Printing needs staff assistance',
      message: 'Your document may not have printed completely. Please keep this screen open and ask a staff member for help.',
      hint: 'Show the transaction ID and receipt below to the kiosk staff.',
    });
  });

  test('keeps a customer-safe error message when no technical recovery template applies', () => {
    expect(
      getMaintenanceGuidance('UNKNOWN', 'The printer needs attention before continuing.'),
    ).toEqual({
      title: 'Printing needs staff assistance',
      message: 'The printer needs attention before continuing.',
      hint: 'Show the transaction ID and receipt below to the kiosk staff.',
    });
  });
});
