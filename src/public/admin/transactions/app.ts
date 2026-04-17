import {
  LogsResponse,
  SummaryResponse,
  apiFetch,
  setMessage,
  initAuth,
} from '../shared';

const logsBody = document.getElementById('logsBody') as HTMLElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const exportLogsBtn = document.getElementById(
  'exportLogsBtn',
) as HTMLButtonElement;
const clearLogsBtn = document.getElementById('clearLogsBtn') as HTMLButtonElement;
const prevPageBtn = document.getElementById('prevPageBtn') as HTMLButtonElement;
const nextPageBtn = document.getElementById('nextPageBtn') as HTMLButtonElement;
const pageInfo = document.getElementById('pageInfo') as HTMLElement;
const applyFiltersBtn = document.getElementById(
  'applyFiltersBtn',
) as HTMLButtonElement;
const clearFiltersBtn = document.getElementById(
  'clearFiltersBtn',
) as HTMLButtonElement;

const transactionIdInput = document.getElementById(
  'transactionIdInput',
) as HTMLInputElement;
const modeFilter = document.getElementById('modeFilter') as HTMLSelectElement;
const statusFilter = document.getElementById('statusFilter') as HTMLSelectElement;
const eventTypeInput = document.getElementById('eventTypeInput') as HTMLInputElement;
const dateFromInput = document.getElementById('dateFromInput') as HTMLInputElement;
const dateToInput = document.getElementById('dateToInput') as HTMLInputElement;

const openAlertBadge = document.getElementById(
  'openAlertBadge',
) as HTMLElement | null;
const openAlertBadgeMob = document.getElementById(
  'openAlertBadgeMob',
) as HTMLElement | null;

const PAGE_SIZE = 20;
let refreshTimer: number | null = null;
let currentPage = 1;
let totalLogs = 0;
let allLogs: LogsResponse['logs'] = [];

type AdminReceiptPayload = {
  transactionId: string;
  mode: string | null;
  chargedAmount: number | null;
  status: string | null;
  settledAt: string | null;
  terminalAt: string | null;
  generatedAt: string;
};

type FilterState = {
  transactionId: string;
  mode: '' | 'print' | 'copy' | 'scan';
  status: '' | 'created' | 'processing' | 'completed' | 'failed' | 'refund';
  eventType: string;
  dateFrom: string;
  dateTo: string;
};

const filterState: FilterState = {
  transactionId: '',
  mode: '',
  status: '',
  eventType: '',
  dateFrom: '',
  dateTo: '',
};

function setOpenAlertBadge(openCount: number): void {
  const value = openCount > 0 ? String(openCount) : '';
  if (openAlertBadge) openAlertBadge.textContent = value;
  if (openAlertBadgeMob) openAlertBadgeMob.textContent = value;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inferMode(log: LogsResponse['logs'][number]): string {
  const mode = log.meta?.mode;
  if (mode === 'print' || mode === 'copy' || mode === 'scan') {
    return mode;
  }
  const type = log.type.toLowerCase();
  if (type.startsWith('print_')) return 'print';
  if (type.startsWith('copy_')) return 'copy';
  if (type.startsWith('scan_')) return 'scan';
  return '—';
}

function getTransactionContextId(log: LogsResponse['logs'][number]): string | null {
  const transactionId = log.meta?.transactionId;
  if (typeof transactionId !== 'string') return null;
  const trimmed = transactionId.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getTransactionId(log: LogsResponse['logs'][number]): string {
  return getTransactionContextId(log) ?? '—';
}

function formatReceiptDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatReceiptMode(value: string | null): string {
  if (!value) return '—';
  return value.toUpperCase();
}

function formatReceiptStatus(value: string | null): string {
  if (!value) return '—';
  if (value === 'settled_pending_terminal') return 'pending terminal confirmation';
  if (value === 'refunded_pending_review') return 'refund pending review';
  return value.replace(/_/g, ' ');
}

function writeReceiptWindow(windowRef: Window, html: string): void {
  windowRef.document.open();
  windowRef.document.write(html);
  windowRef.document.close();
}

function loadingReceiptHtml(transactionId: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Opening E-Receipt…</title>
  <style>
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #0b0a1a; color: #f8f8ff; display: grid; place-items: center; min-height: 100vh; }
    p { opacity: 0.9; }
  </style>
</head>
<body>
  <p>Opening E-Receipt for <strong>${escapeHtml(transactionId)}</strong>…</p>
</body>
</html>`;
}

function receiptWindowHtml(payload: AdminReceiptPayload): string {
  const amount =
    typeof payload.chargedAmount === 'number'
      ? `₱${payload.chargedAmount.toFixed(2)}`
      : '—';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>E-Receipt · ${escapeHtml(payload.transactionId)}</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: "Plus Jakarta Sans", "Segoe UI", Arial, sans-serif; background: #0b0a1a; color: #f8f8ff; }
    .wrap { max-width: 560px; margin: 28px auto; padding: 0 14px; }
    .card { border: 1px solid rgba(167, 170, 225, 0.25); border-radius: 14px; background: rgba(16, 14, 36, 0.9); box-shadow: 0 8px 24px rgba(0,0,0,0.34); overflow: hidden; }
    .head { padding: 16px; border-bottom: 1px solid rgba(167, 170, 225, 0.18); }
    h1 { margin: 0 0 4px; font-size: 18px; }
    .sub { margin: 0; opacity: 0.72; font-size: 13px; }
    .grid { display: grid; grid-template-columns: minmax(120px, 32%) minmax(0, 1fr); }
    .k, .v { padding: 11px 14px; font-size: 14px; }
    .k { color: #b9badd; border-top: 1px solid rgba(167, 170, 225, 0.11); }
    .v { border-top: 1px solid rgba(167, 170, 225, 0.11); font-family: "Courier New", monospace; }
  </style>
</head>
<body>
  <div class="wrap">
    <section class="card">
      <header class="head">
        <h1>E-Receipt</h1>
        <p class="sub">Transaction ${escapeHtml(payload.transactionId)}</p>
      </header>
      <div class="grid">
        <div class="k">Transaction ID</div><div class="v">${escapeHtml(payload.transactionId)}</div>
        <div class="k">Mode</div><div class="v">${escapeHtml(formatReceiptMode(payload.mode))}</div>
        <div class="k">Charged</div><div class="v">${amount}</div>
        <div class="k">Status</div><div class="v">${escapeHtml(formatReceiptStatus(payload.status))}</div>
        <div class="k">Settled At</div><div class="v">${escapeHtml(formatReceiptDate(payload.settledAt))}</div>
        <div class="k">Terminal At</div><div class="v">${escapeHtml(formatReceiptDate(payload.terminalAt))}</div>
        <div class="k">Generated At</div><div class="v">${escapeHtml(formatReceiptDate(payload.generatedAt))}</div>
      </div>
    </section>
  </div>
</body>
</html>`;
}

async function resolveApiErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    if (typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error;
    }
  } catch {
    // Ignore parse errors and keep fallback message
  }
  return fallback;
}

async function openReceiptForTransaction(
  transactionId: string,
  receiptWindow: Window,
): Promise<void> {
  const response = await apiFetch(
    `/api/admin/transactions/${encodeURIComponent(transactionId)}/receipt`,
  );
  if (!response.ok) {
    const fallback =
      response.status === 404
        ? `No E-Receipt found for transaction ${transactionId}.`
        : response.status === 410
          ? `E-Receipt for transaction ${transactionId} has expired.`
          : 'Failed to load E-Receipt.';
    const message = await resolveApiErrorMessage(response, fallback);
    receiptWindow.close();
    throw new Error(message);
  }

  const payload = (await response.json()) as AdminReceiptPayload;
  writeReceiptWindow(receiptWindow, receiptWindowHtml(payload));
}

function totalPages(): number {
  return Math.max(1, Math.ceil(totalLogs / PAGE_SIZE));
}

function updatePaginationControls(): void {
  const pages = totalPages();
  pageInfo.textContent = `Page ${currentPage} of ${pages}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= pages;
}

function renderPage(): void {
  const start = (currentPage - 1) * PAGE_SIZE;
  const slice = allLogs.slice(start, start + PAGE_SIZE);
  applyLogs(slice);
  updatePaginationControls();
}

function applyLogs(logs: LogsResponse['logs']): void {
  logsBody.innerHTML = '';

  if (logs.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td colspan="6" style="text-align:center;color:var(--ink-muted);padding:24px">No transaction log entries.</td>`;
    logsBody.appendChild(tr);
    return;
  }

  for (const log of logs) {
    const transactionContextId = getTransactionContextId(log);
    const actionMarkup = transactionContextId
      ? `<button class="tx-receipt-btn" data-action="open-receipt" data-transaction-id="${escapeHtml(transactionContextId)}">Open E-Receipt</button>`
      : '<span class="tx-receipt-unavailable">—</span>';
    const tr = document.createElement('tr');
    tr.dataset.logId = log.id;
    tr.innerHTML = `
      <td class="logs-td logs-td--ts">${new Date(log.timestamp).toLocaleString()}</td>
      <td class="logs-td logs-td--id">${escapeHtml(getTransactionId(log))}</td>
      <td class="logs-td logs-td--mode">${escapeHtml(inferMode(log))}</td>
      <td class="logs-td logs-td--type">${escapeHtml(log.type)}</td>
      <td class="logs-td">${escapeHtml(log.message)}</td>
      <td class="logs-td logs-td--actions">${actionMarkup}</td>
    `;
    logsBody.appendChild(tr);
  }
}

function toIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildFilterParams(includeLimit: boolean): URLSearchParams {
  const params = new URLSearchParams();
  if (includeLimit) params.set('limit', '1000');

  if (filterState.transactionId) {
    params.set('transactionId', filterState.transactionId);
  }
  if (filterState.mode) {
    params.set('mode', filterState.mode);
  }
  if (filterState.status) {
    params.set('status', filterState.status);
  }
  if (filterState.eventType) {
    params.set('eventType', filterState.eventType);
  }

  const isoFrom = toIso(filterState.dateFrom);
  if (isoFrom) params.set('dateFrom', isoFrom);
  const isoTo = toIso(filterState.dateTo);
  if (isoTo) params.set('dateTo', isoTo);

  return params;
}

function applyFilterStateFromInputs(): void {
  filterState.transactionId = transactionIdInput.value.trim();
  filterState.mode = modeFilter.value as FilterState['mode'];
  filterState.status = statusFilter.value as FilterState['status'];
  filterState.eventType = eventTypeInput.value.trim();
  filterState.dateFrom = dateFromInput.value;
  filterState.dateTo = dateToInput.value;
}

function resetFilterState(): void {
  filterState.transactionId = '';
  filterState.mode = '';
  filterState.status = '';
  filterState.eventType = '';
  filterState.dateFrom = '';
  filterState.dateTo = '';

  transactionIdInput.value = '';
  modeFilter.value = '';
  statusFilter.value = '';
  eventTypeInput.value = '';
  dateFromInput.value = '';
  dateToInput.value = '';
}

async function loadData(): Promise<void> {
  const params = buildFilterParams(true);
  const res = await apiFetch(`/api/admin/logs/transactions?${params.toString()}`);
  if (!res.ok) {
    let errorText = 'Failed to load transaction logs.';
    try {
      const body = (await res.json()) as { error?: string };
      if (typeof body.error === 'string' && body.error.trim()) {
        errorText = body.error;
      }
    } catch {
      // Ignore parse errors and keep fallback message
    }
    throw new Error(errorText);
  }
  const data = (await res.json()) as LogsResponse;
  allLogs = data.logs;
  totalLogs = allLogs.length;
  if (currentPage > totalPages()) currentPage = totalPages();
  renderPage();
  await loadSummary();
}

async function loadSummary(): Promise<void> {
  const res = await apiFetch('/api/admin/summary');
  if (!res.ok) return;
  const summary = (await res.json()) as SummaryResponse;
  setOpenAlertBadge(summary.anomalyStats.openCount);
}

async function clearAllTransactionLogs(): Promise<void> {
  if (!confirm('Delete ALL transaction log entries? This cannot be undone.')) {
    return;
  }
  setMessage('Clearing transaction logs…');
  const res = await apiFetch('/api/admin/logs/transactions', { method: 'DELETE' });
  if (!res.ok) {
    setMessage('Failed to clear transaction logs.');
    return;
  }
  allLogs = [];
  totalLogs = 0;
  currentPage = 1;
  renderPage();
  setMessage('All transaction logs cleared.');
}

function applyFilters(): void {
  applyFilterStateFromInputs();
  currentPage = 1;
  setMessage('Applying transaction filters...');
  void loadData()
    .then(() => setMessage('Transaction filters applied.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Filter failed.'),
    );
}

refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void loadData()
    .then(() => setMessage('Transaction logs refreshed.'))
    .catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Refresh failed.'),
    );
});

exportLogsBtn.addEventListener('click', () => {
  setMessage('Preparing transaction logs export...');
  const params = buildFilterParams(false);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  void apiFetch(`/api/admin/logs/transactions/export.csv${suffix}`)
    .then(async (response) => {
      if (!response.ok) throw new Error('Failed to export transaction logs.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `printbit-admin-transaction-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage('Transaction logs exported.');
    })
    .catch((error: unknown) => {
      const msg =
        error instanceof Error
          ? error.message
          : 'Failed to export transaction logs.';
      setMessage(msg);
    });
});

clearLogsBtn.addEventListener('click', () => void clearAllTransactionLogs());
applyFiltersBtn.addEventListener('click', applyFilters);
clearFiltersBtn.addEventListener('click', () => {
  resetFilterState();
  currentPage = 1;
  setMessage('Filters cleared.');
  void loadData().catch((error: unknown) =>
    setMessage(error instanceof Error ? error.message : 'Refresh failed.'),
  );
});

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    renderPage();
  }
});

nextPageBtn.addEventListener('click', () => {
  if (currentPage < totalPages()) {
    currentPage++;
    renderPage();
  }
});

logsBody.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const actionButton = target.closest<HTMLButtonElement>(
    '[data-action="open-receipt"]',
  );
  if (!actionButton) return;

  const transactionId = actionButton.dataset.transactionId?.trim() ?? '';
  if (!transactionId) {
    setMessage('Transaction context is missing for this log entry.');
    return;
  }

  const receiptWindow = window.open('', '_blank');
  if (!receiptWindow) {
    setMessage('Unable to open E-Receipt window. Please allow pop-ups and retry.');
    return;
  }
  writeReceiptWindow(receiptWindow, loadingReceiptHtml(transactionId));

  const defaultLabel = actionButton.textContent;
  actionButton.disabled = true;
  actionButton.textContent = 'Opening…';

  void openReceiptForTransaction(transactionId, receiptWindow)
    .then(() => setMessage(`Opened E-Receipt for ${transactionId}.`))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Failed to open E-Receipt.'),
    )
    .finally(() => {
      actionButton.disabled = false;
      actionButton.textContent = defaultLabel;
    });
});

initAuth(async () => {
  await loadData();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void loadData(), 10_000);
});
