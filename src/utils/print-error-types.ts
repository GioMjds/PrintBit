export type PrintErrorLayer =
  | 'paper'
  | 'ink'
  | 'connectivity'
  | 'input'
  | 'application'
  | 'infrastructure';

export type PrintErrorSeverity = 'WARNING' | 'RECOVERABLE' | 'FATAL';

export type PrintErrorSystemAction =
  | 'ABORT_AND_REFUND'
  | 'ABORT_NO_REFUND'
  | 'PAUSE_AND_NOTIFY'
  | 'RETRY'
  | 'RESET_SESSION';

export type PrintErrorDetectionConfidence = 'high' | 'medium' | 'low';

export type PrintErrorResolutionStatus =
  | 'open'
  | 'acknowledged'
  | 'resolved'
  | 'dismissed';

export type PrintErrorCode =
  | 'PAPER_INSUFFICIENT_PRE_DISPATCH'
  | 'PAPER_TRAY_EMPTY'
  | 'PAPER_JAM_PRINT'
  | 'PAPER_JAM_SCAN_ADF'
  | 'PAPER_DOUBLE_FEED'
  | 'PAPER_MISALIGNED'
  | 'PAPER_SIZE_UNSUPPORTED'
  | 'PAPER_TYPE_MISMATCH'
  | 'MANUAL_FEED_REQUIRED'
  | 'INK_EMPTY'
  | 'INK_LOW'
  | 'PRINTHEAD_CLOGGED'
  | 'COLOR_OUTPUT_MISMATCH'
  | 'PRINTER_POWERED_OFF'
  | 'USB_DISCONNECTED'
  | 'NETWORK_PRINTER_UNREACHABLE'
  | 'WINDOWS_PRINTER_OFFLINE'
  | 'PRINTER_PAUSED'
  | 'POWER_LOSS_DETECTED'
  | 'HARDWARE_OVERTEMP_OR_VOLTAGE'
  | 'PRINTER_DOOR_OPEN'
  | 'SCANNER_NO_DOCUMENT'
  | 'SCANNER_DISCONNECTED'
  | 'SCANNER_ADF_JAM'
  | 'SCANNER_GLASS_DIRTY'
  | 'SCAN_PARTIAL_OUTPUT'
  | 'SPOOLER_SERVICE_STOPPED'
  | 'SPOOLER_QUEUE_STUCK'
  | 'SPOOLER_QUERY_FAILED'
  | 'SPOOLER_JOB_FAILED'
  | 'PRINTER_DRIVER_CORRUPT'
  | 'WRONG_PRINTER_SELECTED'
  | 'ACCESS_DENIED'
  | 'FORMAT_NOT_SUPPORTED'
  | 'PAPER_SIZE_MISMATCH'
  | 'DUPLEX_UNSUPPORTED'
  | 'COLOR_MODE_MISMATCH'
  | 'PAGE_SCALING_RISK'
  | 'PRINT_PROCESSING_TIMEOUT'
  | 'PRINTER_MEMORY_OVERFLOW'
  | 'FIRMWARE_FAULT'
  | 'CONCURRENT_JOB_COLLISION'
  | 'USB_PORT_REASSIGNED'
  | 'GHOST_PRINTER_DETECTED'
  | 'DIAGNOSTICS_BRIDGE_FAILED'
  | 'UNKNOWN_PRINTER_FAULT';

export interface PrintError {
  code: PrintErrorCode;
  layer: PrintErrorLayer;
  severity: PrintErrorSeverity;
  userMessage: string;
  adminMessage: string;
  refundEligible: boolean;
  systemAction: PrintErrorSystemAction;
  detectionConfidence: PrintErrorDetectionConfidence;
  source: string;
  raw: Record<string, unknown> | null;
  transactionId: string | null;
  sessionId: string | null;
  jobId: string | null;
  printerName: string | null;
  resolutionStatus: PrintErrorResolutionStatus;
  timestamp: string;
}

export interface PrintErrorRecord extends PrintError {
  id: string;
  resolutionNote: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
}

export type PublicPrintError = Omit<PrintErrorRecord, 'raw'> & {
  raw?: Record<string, unknown> | null;
};
