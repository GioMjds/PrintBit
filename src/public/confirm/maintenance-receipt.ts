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

export function isMaintenancePrintFailure(_code: string): boolean {
  return false;
}

export function buildMaintenanceReceiptView(
  _input: MaintenanceReceiptViewInput,
): MaintenanceReceiptView {
  return {
    transactionId: 'Pending verification',
    receipt: null,
  };
}
