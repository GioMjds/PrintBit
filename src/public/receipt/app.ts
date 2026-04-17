type ReceiptPayload = {
  transactionId: string;
  mode: 'print' | 'copy' | string | null;
  chargedAmount: number | null;
  status: string | null;
  settledAt: string | null;
  terminalAt: string | null;
  generatedAt: string;
};

type ReceiptLookup =
  | { kind: 'token'; value: string }
  | { kind: 'transaction'; value: string };

const receiptGrid = document.getElementById('receiptGrid') as HTMLElement | null;
const receiptMessage = document.getElementById(
  'receiptMessage',
) as HTMLElement | null;

const fields = {
  transactionId: document.getElementById('rTransactionId') as HTMLElement | null,
  mode: document.getElementById('rMode') as HTMLElement | null,
  amount: document.getElementById('rAmount') as HTMLElement | null,
  status: document.getElementById('rStatus') as HTMLElement | null,
  settledAt: document.getElementById('rSettledAt') as HTMLElement | null,
  terminalAt: document.getElementById('rTerminalAt') as HTMLElement | null,
  generatedAt: document.getElementById('rGeneratedAt') as HTMLElement | null,
};

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 120_000;
const TERMINAL_STATUSES = new Set([
  'printed',
  'failed',
  'refunded',
  'refunded_pending_review',
]);

function setField(el: HTMLElement | null, value: string): void {
  if (el) el.textContent = value;
}

function setMessage(
  message: string,
  tone: 'default' | 'pending' | 'error' = 'default',
): void {
  if (!receiptMessage) return;
  receiptMessage.textContent = message;
  receiptMessage.classList.remove(
    'receipt-message--pending',
    'receipt-message--error',
  );
  if (tone === 'pending') receiptMessage.classList.add('receipt-message--pending');
  if (tone === 'error') receiptMessage.classList.add('receipt-message--error');
}

function fmtDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function fmtMode(value: string | null): string {
  if (!value) return '—';
  return value.toUpperCase();
}

function fmtStatus(value: string | null): string {
  if (!value) return '—';
  if (value === 'settled_pending_terminal') return 'pending terminal confirmation';
  if (value === 'refunded_pending_review') return 'refund pending review';
  return value.replace(/_/g, ' ');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLookupFromPath(): ReceiptLookup | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const receiptIndex = parts.indexOf('receipt');
  if (receiptIndex < 0) return null;

  const nextPart = parts[receiptIndex + 1];
  if (!nextPart) return null;

  if (nextPart === 't') {
    const tokenPart = parts[receiptIndex + 2];
    const token = tokenPart ? decodeURIComponent(tokenPart) : '';
    if (!token) return null;
    return { kind: 'token', value: token };
  }

  const transactionId = decodeURIComponent(nextPart);
  if (!transactionId) return null;
  return { kind: 'transaction', value: transactionId };
}

function resolveEndpoint(lookup: ReceiptLookup): string {
  if (lookup.kind === 'token') {
    return `/api/receipts/by-token/${encodeURIComponent(lookup.value)}`;
  }
  return `/api/transactions/${encodeURIComponent(lookup.value)}/receipt`;
}

function resolveTokenErrorMessage(status: number, code: string | null): string {
  if (status === 410 || code === 'RECEIPT_TOKEN_EXPIRED') {
    return 'This E-Receipt link has expired.';
  }
  if (status === 403 || code === 'RECEIPT_TOKEN_REVOKED') {
    return 'This E-Receipt link has been revoked.';
  }
  if (status === 404 || code === 'RECEIPT_TOKEN_NOT_FOUND') {
    return 'This E-Receipt link is invalid.';
  }
  return 'Failed to load receipt details.';
}

async function fetchReceiptPayload(
  lookup: ReceiptLookup,
): Promise<{ ok: true; payload: ReceiptPayload } | { ok: false; message: string }> {
  try {
    const res = await fetch(resolveEndpoint(lookup));
    if (!res.ok) {
      let code: string | null = null;
      try {
        const errorPayload = (await res.json()) as { code?: string };
        code =
          typeof errorPayload.code === 'string' ? errorPayload.code.trim() : null;
      } catch {
        code = null;
      }
      if (lookup.kind === 'token') {
        return { ok: false, message: resolveTokenErrorMessage(res.status, code) };
      }
      return {
        ok: false,
        message:
          res.status === 404
            ? 'Receipt not found for this transaction ID.'
            : 'Failed to load receipt details.',
      };
    }

    const payload = (await res.json()) as ReceiptPayload & {
      printedAt?: string | null;
    };
    if (payload.terminalAt == null && typeof payload.printedAt === 'string') {
      payload.terminalAt = payload.printedAt;
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, message: 'Network error while loading receipt.' };
  }
}

function renderReceipt(payload: ReceiptPayload): void {
  setField(fields.transactionId, payload.transactionId);
  setField(fields.mode, fmtMode(payload.mode));
  setField(
    fields.amount,
    typeof payload.chargedAmount === 'number'
      ? `₱${payload.chargedAmount.toFixed(2)}`
      : '—',
  );
  setField(fields.status, fmtStatus(payload.status));
  setField(fields.settledAt, fmtDate(payload.settledAt));
  setField(fields.terminalAt, fmtDate(payload.terminalAt));
  setField(fields.generatedAt, fmtDate(payload.generatedAt));
  receiptGrid?.removeAttribute('hidden');
}

async function loadReceipt(): Promise<void> {
  const lookup = parseLookupFromPath();
  if (!lookup) {
    setMessage('Invalid receipt URL.', 'error');
    return;
  }

  const pollingDeadline = Date.now() + POLL_TIMEOUT_MS;

  while (true) {
    const result = await fetchReceiptPayload(lookup);
    if (!result.ok) {
      setMessage(result.message, 'error');
      return;
    }

    renderReceipt(result.payload);
    const isPrintPending =
      result.payload.mode === 'print' &&
      result.payload.status === 'settled_pending_terminal';

    if (!isPrintPending) {
      if (
        result.payload.mode === 'print' &&
        result.payload.status &&
        TERMINAL_STATUSES.has(result.payload.status)
      ) {
        setMessage(`Print status: ${fmtStatus(result.payload.status)}.`);
      } else {
        setMessage('');
      }
      return;
    }

    const remainingMs = pollingDeadline - Date.now();
    if (remainingMs <= 0) {
      setMessage(
        'Payment settled. Print confirmation is still pending. Please refresh in a moment.',
        'pending',
      );
      return;
    }

    setMessage(
      `Payment settled. Waiting for printer confirmation… Refreshing automatically (${Math.ceil(
        remainingMs / 1000,
      )}s left).`,
      'pending',
    );
    await wait(Math.min(POLL_INTERVAL_MS, remainingMs));
  }
}

void loadReceipt();
