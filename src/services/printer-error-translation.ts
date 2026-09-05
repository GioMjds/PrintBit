export interface TranslatedPrinterError {
  code: string;
  severity: 'warning' | 'recoverable' | 'fatal';
  userMessage: string;
  canRetry: boolean;
  canDismiss: boolean;
}

/**
 * Converts the worker's printer telemetry into an actionable kiosk error.
 * Epson's monitor can supply only the WMI DetectedErrorState number, so it
 * must be considered alongside the human-readable message.
 */
export function translateHardwarePrinterError(input: {
  message?: string | null;
  errorCode?: string | null;
}): TranslatedPrinterError {
  const lower = `${input.message ?? ''} ${input.errorCode ?? ''}`.toLowerCase();
  const matchesCode = (code: number) =>
    input.errorCode?.trim() === String(code) ||
    lower.includes(`code ${code}`) ||
    lower.includes(`detectederrorstate ${code}`);

  if (
    matchesCode(4) ||
    lower.includes('no paper') ||
    lower.includes('low paper') ||
    lower.includes('paper_out') ||
    lower.includes('paper out')
  ) {
    return {
      code: 'PAPER_TRAY_EMPTY',
      severity: 'recoverable',
      userMessage: 'Printer Out of Paper. Please load paper and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (matchesCode(8) || lower.includes('jammed') || lower.includes('paper_jam') || lower.includes('paper jam')) {
    return {
      code: 'PAPER_JAM_PRINT',
      severity: 'recoverable',
      userMessage: 'Paper jam detected. Clear the jam and click Resume to continue.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (matchesCode(7) || lower.includes('door open') || lower.includes('door_open') || lower.includes('cover open')) {
    return {
      code: 'PRINTER_DOOR_OPEN',
      severity: 'recoverable',
      userMessage: 'Printer door or cover is open. Please close the cover and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (lower.includes('paper_problem') || lower.includes('paper problem')) {
    return {
      code: 'PAPER_INSUFFICIENT_PRE_DISPATCH',
      severity: 'recoverable',
      userMessage: 'Paper feed problem detected. Please check the paper tray and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (matchesCode(11) || lower.includes('output_bin_full') || lower.includes('output bin full')) {
    return {
      code: 'OUTPUT_BIN_FULL',
      severity: 'recoverable',
      userMessage: 'The printer output tray is full. Please remove printed pages and click Resume.',
      canRetry: true,
      canDismiss: false,
    };
  }
  if (matchesCode(5) || matchesCode(6) || lower.includes('no toner') || lower.includes('low toner') || lower.includes('no_toner')) {
    return {
      code: 'PRINTER_OUT_OF_TONER',
      severity: 'fatal',
      userMessage: 'The printer is out of toner. Please ask staff to replace the cartridge.',
      canRetry: false,
      canDismiss: false,
    };
  }
  if (matchesCode(9) || lower.includes('offline') || lower.includes('not available') || lower.includes('stopped printing') || lower.includes('not found')) {
    return {
      code: 'PRINTER_OFFLINE',
      severity: 'fatal',
      userMessage: 'The printer is offline or not found. Please check printer power and USB connection.',
      canRetry: false,
      canDismiss: false,
    };
  }
  return {
    code: 'PRINTER_HARDWARE_ERROR',
    severity: 'fatal',
    userMessage: 'The printer reported a hardware error. Please ask staff for help.',
    canRetry: false,
    canDismiss: false,
  };
}
