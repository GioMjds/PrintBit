import { getMaintenanceGuidance } from '../../src/public/confirm/recovery-guidance';
import { isMaintenancePrintFailure } from '../../src/public/confirm/maintenance-receipt';

describe('recovery guidance parser', () => {
  test('parses and cleans complex Epson driver popup errors (paper out & incorrect loading)', () => {
    const rawDriverError =
      'Print job finished with state: failed. Post-clear hardware error code 99: Epson Popup: Approximate Ink Levels | Paper out or incorrect loading | 1. Load the paper in the rear paper feed. | 2. Check if the paper size setting on the driver matches the paper you loaded. | 3. See the LCD screen on the product and follow the instructions. | If the error is not fixed, remove any jammed paper. | Alternatively, you can cancel the print job by clicking [Cancel] when displayed. | Consumables Status | Black | Yellow | Magenta | Cyan | 003 | 003 | 003 | 003 | The Approximate Ink Levels might be different from the actual ink levels.';

    // Should be recognized as a maintenance failure
    expect(isMaintenancePrintFailure(undefined, rawDriverError)).toBe(true);

    const guidance = getMaintenanceGuidance('99', rawDriverError);

    expect(guidance.title).toBe('Paper Out or Incorrect Loading');
    expect(guidance.badge).toBe('Paper Issue');
    expect(guidance.message).toContain('paper tray is empty or the paper was not loaded properly');
    expect(guidance.actionSteps.length).toBeGreaterThanOrEqual(2);
    expect(guidance.actionSteps[0]).toContain('Keep this screen open');
    // Raw message should be saved as technical details for staff
    expect(guidance.technicalDetails).toBe(rawDriverError);
  });

  test('parses paper jam errors cleanly', () => {
    const guidance = getMaintenanceGuidance(
      'PAPER_JAM_PRINT',
      'Paper jam detected in the rear tray feed path.',
    );

    expect(guidance.title).toBe('Paper Jam Detected');
    expect(guidance.badge).toBe('Paper Jam');
    expect(guidance.message).toContain('paper got stuck inside the printer');
    expect(guidance.actionSteps).toContain('Keep this screen open and notify kiosk staff.');
  });

  test('parses door / cover open errors cleanly', () => {
    const guidance = getMaintenanceGuidance(
      'PRINTER_DOOR_OPEN',
      'The printer cover is open.',
    );

    expect(guidance.title).toBe('Printer Cover Open');
    expect(guidance.badge).toBe('Cover Open');
    expect(guidance.actionSteps[0]).toContain('firmly close the printer cover');
  });

  test('parses generic hardware error codes', () => {
    const guidance = getMaintenanceGuidance(
      'WORKER_HARDWARE_ERROR',
      'Post-clear hardware error code 99: Unexpected worker timeout',
    );

    expect(guidance.title).toBe('Printer Hardware Issue');
    expect(guidance.badge).toBe('Staff Assistance');
    expect(guidance.message).toContain('hardware issue');
  });
});
