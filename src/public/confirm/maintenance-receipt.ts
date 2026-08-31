export interface MaintenanceReceiptViewInput {
  transactionId?: string | null;
  receiptUrl?: string | null;
  receiptExpiresAt?: string | null;
}

export interface MaintenanceReceiptView {
  transactionId: string;
  receipt: {
    url: string;
    expiresAt: string | null;
  } | null;
}

const MAINTENANCE_PRINT_FAILURE_CODES = new Set([
  'PAPER_INSUFFICIENT_PRE_DISPATCH',
  'PAPER_INSUFFICIENT_MID_JOB',
  'PAPER_TRAY_EMPTY',
  'PAPER_JAM_PRINT',
  'PRINTER_DOOR_OPEN',
  'PRINTER_HARDWARE_ERROR',
  'WORKER_HARDWARE_ERROR',
]);

function normalizeOptionalValue(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function isMaintenancePrintFailure(code: string): boolean {
  return MAINTENANCE_PRINT_FAILURE_CODES.has(code);
}

export function buildMaintenanceReceiptView(
  input: MaintenanceReceiptViewInput,
): MaintenanceReceiptView {
  const receiptUrl = normalizeOptionalValue(input.receiptUrl);

  return {
    transactionId:
      normalizeOptionalValue(input.transactionId) ?? 'Pending verification',
    receipt: receiptUrl
      ? {
          url: receiptUrl,
          expiresAt: normalizeOptionalValue(input.receiptExpiresAt),
        }
      : null,
  };
}
