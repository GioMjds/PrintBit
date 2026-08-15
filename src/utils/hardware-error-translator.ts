export interface TranslatedHardwarePrinterError {
  code: string;
  severity: 'warning' | 'recoverable' | 'fatal';
  userMessage: string;
  canRetry: boolean;
  canDismiss: boolean;
}

export function translateHardwarePrinterError(
  message: string | null,
): TranslatedHardwarePrinterError {
  const lower = (message ?? '').toLowerCase();
  if (
    lower.includes('no paper') ||
    lower.includes('low paper') ||
    lower.includes('out of paper') ||
    lower.includes('paper out') ||
    lower.includes('w-01') ||
    lower.includes('unhealthy') ||
    !message
  ) {
    return {
      code: 'PAPER_TRAY_EMPTY',
      severity: 'recoverable',
      userMessage: 'Printer Out of Paper. Please load paper and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (
    (lower.includes('printing') || lower.includes('spooling')) &&
    !lower.includes('error') &&
    !lower.includes('paper') &&
    !lower.includes('jam') &&
    !lower.includes('toner')
  ) {
    return {
      code: 'PRINTING_IN_PROGRESS',
      severity: 'warning',
      userMessage: 'Printer is currently printing...',
      canRetry: false,
      canDismiss: true,
    };
  }
  if (lower.includes('jammed') || lower.includes('jam')) {
    return {
      code: 'PAPER_JAM_PRINT',
      severity: 'recoverable',
      userMessage:
        'Paper jam detected. Clear the jam and click Resume to continue.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (
    lower.includes('no toner') ||
    lower.includes('low toner') ||
    lower.includes('no ink') ||
    lower.includes('ink out')
  ) {
    return {
      code: 'PRINTER_OUT_OF_TONER',
      severity: 'fatal',
      userMessage:
        'The printer is out of toner/ink. Please ask staff to replace the cartridge.',
      canRetry: false,
      canDismiss: false,
    };
  }
  return {
    code: 'PRINTER_HARDWARE_ERROR',
    severity: 'recoverable',
    userMessage:
      'Printer hardware error detected. Please check the printer status.',
    canRetry: true,
    canDismiss: false,
  };
}
