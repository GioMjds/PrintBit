export type PrintErrorSeverity = 'WARNING' | 'RECOVERABLE' | 'FATAL';

export interface PublicPrintError {
  code: string;
  severity: PrintErrorSeverity;
  userMessage: string;
  adminMessage?: string;
  refundEligible?: boolean;
  refundDisposition?: string | null;
  transactionId?: string | null;
  sessionId?: string | null;
  jobId?: string | null;
  printerName?: string | null;
}

export interface PrintErrorPayload {
  printError?: PublicPrintError | null;
  refundId?: string | null;
  refundDisposition?: string | null;
  restoredBalanceAmount?: number | null;
  chargedAmount?: number | null;
  pagesPrinted?: number | null;
  totalPages?: number | null;
  transactionId?: string | null;
  spoolerCorrelationKey?: string | null;
}

const PRINT_ERROR_TITLE_KEYS: Record<PrintErrorSeverity, string> = {
  WARNING: 'print.error.title.warning',
  RECOVERABLE: 'print.error.title.recoverable',
  FATAL: 'print.error.title.fatal',
};

const PRINT_ERROR_MESSAGE_KEYS: Record<string, string> = {
  PAPER_INSUFFICIENT_PRE_DISPATCH: 'print.error.PAPER_INSUFFICIENT_PRE_DISPATCH',
  PAPER_TRAY_EMPTY: 'print.error.PAPER_TRAY_EMPTY',
  PAPER_JAM_PRINT: 'print.error.PAPER_JAM_PRINT',
  PAPER_JAM_SCAN_ADF: 'print.error.PAPER_JAM_SCAN_ADF',
  SCANNER_NO_DOCUMENT: 'print.error.SCANNER_NO_DOCUMENT',
  SCANNER_ADF_JAM: 'print.error.SCANNER_ADF_JAM',
  INK_EMPTY: 'print.error.INK_EMPTY',
  PRINTER_POWERED_OFF: 'print.error.PRINTER_POWERED_OFF',
  USB_DISCONNECTED: 'print.error.USB_DISCONNECTED',
  NETWORK_PRINTER_UNREACHABLE: 'print.error.NETWORK_PRINTER_UNREACHABLE',
  WINDOWS_PRINTER_OFFLINE: 'print.error.WINDOWS_PRINTER_OFFLINE',
  SOCKET_DISCONNECTED: 'print.error.socket_disconnected',
};

const PRINT_ERROR_HINT_KEYS: Record<string, string> = {
  SCANNER_NO_DOCUMENT: 'print.error.hint.SCANNER_NO_DOCUMENT',
  SCANNER_ADF_JAM: 'print.error.hint.SCANNER_ADF_JAM',
  PAPER_JAM_SCAN_ADF: 'print.error.hint.SCANNER_ADF_JAM',
  SOCKET_DISCONNECTED: 'print.error.hint.socket_disconnected',
};

export function extractPrintError(payload: unknown): PublicPrintError | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = (payload as { printError?: unknown }).printError;
  if (!candidate || typeof candidate !== 'object') return null;
  const record = candidate as Partial<PublicPrintError>;
  if (typeof record.code !== 'string') return null;
  if (typeof record.userMessage !== 'string') return null;
  if (
    record.severity !== 'WARNING' &&
    record.severity !== 'RECOVERABLE' &&
    record.severity !== 'FATAL'
  ) {
    return null;
  }
  return record as PublicPrintError;
}

export function getPrintErrorTitleKey(severity: PrintErrorSeverity): string {
  return PRINT_ERROR_TITLE_KEYS[severity];
}

export function getPrintErrorMessageKey(error: PublicPrintError): string {
  return PRINT_ERROR_MESSAGE_KEYS[error.code] ?? error.userMessage;
}

export function getPrintErrorHintKey(error: PublicPrintError): string | null {
  if (error.severity === 'WARNING') {
    return 'print.error.hint.warning_ack';
  }
  return (
    PRINT_ERROR_HINT_KEYS[error.code] ?? 'print.error.hint.contact_staff'
  );
}
