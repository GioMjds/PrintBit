type ReceiptPayload = {
  transactionId: string;
  mode: string | null;
  chargedAmount: number | null;
  status: string | null;
  settledAt: string | null;
  printedAt: string | null;
  refundStatus: string | null;
  generatedAt: string;
};

const receiptGrid = document.getElementById(
  'receiptGrid',
) as HTMLElement | null;
const receiptMessage = document.getElementById(
  'receiptMessage',
) as HTMLElement | null;

const fields = {
  transactionId: document.getElementById(
    'rTransactionId',
  ) as HTMLElement | null,
  mode: document.getElementById('rMode') as HTMLElement | null,
  amount: document.getElementById('rAmount') as HTMLElement | null,
  status: document.getElementById('rStatus') as HTMLElement | null,
  settledAt: document.getElementById('rSettledAt') as HTMLElement | null,
  printedAt: document.getElementById('rPrintedAt') as HTMLElement | null,
  refundStatus: document.getElementById('rRefundStatus') as HTMLElement | null,
  generatedAt: document.getElementById('rGeneratedAt') as HTMLElement | null,
};

function setField(el: HTMLElement | null, value: string): void {
  if (el) el.textContent = value;
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function loadReceipt(): Promise<void> {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const receiptIndex = parts.indexOf('receipt');
  const transactionId =
    receiptIndex >= 0 && parts.length > receiptIndex + 1
      ? decodeURIComponent(parts[receiptIndex + 1])
      : '';

  if (!transactionId) {
    if (receiptMessage) receiptMessage.textContent = 'Invalid receipt URL.';
    return;
  }

  try {
    const res = await fetch(
      `/api/transactions/${encodeURIComponent(transactionId)}/receipt`,
    );
    if (!res.ok) {
      if (receiptMessage) {
        receiptMessage.textContent =
          res.status === 404
            ? 'Receipt not found for this transaction ID.'
            : 'Failed to load receipt details.';
      }
      return;
    }

    const payload = (await res.json()) as ReceiptPayload;
    setField(fields.transactionId, payload.transactionId);
    setField(fields.mode, payload.mode ?? '—');
    setField(
      fields.amount,
      typeof payload.chargedAmount === 'number'
        ? `₱${payload.chargedAmount.toFixed(2)}`
        : '—',
    );
    setField(fields.status, payload.status ?? '—');
    setField(fields.settledAt, fmtDate(payload.settledAt));
    setField(fields.printedAt, fmtDate(payload.printedAt));
    setField(fields.refundStatus, payload.refundStatus ?? 'none');
    setField(fields.generatedAt, fmtDate(payload.generatedAt));

    if (receiptGrid) receiptGrid.removeAttribute('hidden');
    if (receiptMessage) receiptMessage.textContent = '';
  } catch {
    if (receiptMessage) {
      receiptMessage.textContent = 'Network error while loading receipt.';
    }
  }
}

void loadReceipt();
