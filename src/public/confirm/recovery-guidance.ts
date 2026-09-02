export interface MaintenanceGuidance {
  title: string;
  message: string;
  hint: string;
}

const TECHNICAL_FAILURE_CODES = new Set([
  'PAPER_INSUFFICIENT_PRE_DISPATCH',
  'PAPER_INSUFFICIENT_MID_JOB',
  'PAPER_TRAY_EMPTY',
  'PAPER_JAM_PRINT',
  'PRINTER_DOOR_OPEN',
  'PRINTER_HARDWARE_ERROR',
  'WORKER_HARDWARE_ERROR',
]);

export function getMaintenanceGuidance(
  code: string,
  message: string,
): MaintenanceGuidance {
  return {
    title: 'Printing needs staff assistance',
    message: TECHNICAL_FAILURE_CODES.has(code)
      ? 'Your document may not have printed completely. Please keep this screen open and ask a staff member for help.'
      : message,
    hint: 'Show the transaction ID and receipt below to the kiosk staff.',
  };
}
