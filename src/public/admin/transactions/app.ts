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

const txDrawerBackdrop = document.getElementById(
  'txDrawerBackdrop',
) as HTMLElement | null;
const txDetailDrawer = document.getElementById('txDetailDrawer') as HTMLElement | null;
const txDetailCloseBtn = document.getElementById(
  'txDetailCloseBtn',
) as HTMLButtonElement | null;
const txDetailState = document.getElementById('txDetailState') as HTMLElement | null;
const dTransactionId = document.getElementById('dTransactionId') as HTMLElement | null;
const dMode = document.getElementById('dMode') as HTMLElement | null;
const dAmount = document.getElementById('dAmount') as HTMLElement | null;
const dStatus = document.getElementById('dStatus') as HTMLElement | null;
const dChangeRequested = document.getElementById(
  'dChangeRequested',
) as HTMLElement | null;
const dChangeDispensed = document.getElementById(
  'dChangeDispensed',
) as HTMLElement | null;
const dChangeRemaining = document.getElementById(
  'dChangeRemaining',
) as HTMLElement | null;
const dChangeStatus = document.getElementById('dChangeStatus') as HTMLElement | null;
const dChangeMessage = document.getElementById('dChangeMessage') as HTMLElement | null;
const dSettledAt = document.getElementById('dSettledAt') as HTMLElement | null;
const dTerminalAt = document.getElementById('dTerminalAt') as HTMLElement | null;
const dGeneratedAt = document.getElementById('dGeneratedAt') as HTMLElement | null;
const dContextHint = document.getElementById('dContextHint') as HTMLElement | null;
const dMissingReasons = document.getElementById('dMissingReasons') as HTMLElement | null;
const dRelatedLogsBody = document.getElementById(
  'dRelatedLogsBody',
) as HTMLElement | null;
const dOpenReceiptBtn = document.getElementById(
  'dOpenReceiptBtn',
) as HTMLButtonElement | null;
const dCopyIdBtn = document.getElementById('dCopyIdBtn') as HTMLButtonElement | null;
const dCreateReportBtn = document.getElementById(
  'dCreateReportBtn',
) as HTMLButtonElement | null;

const txReportModal = document.getElementById('txReportModal') as HTMLElement | null;
const txReportCloseBtn = document.getElementById(
  'txReportCloseBtn',
) as HTMLButtonElement | null;
const txReportCancelBtn = document.getElementById(
  'txReportCancelBtn',
) as HTMLButtonElement | null;
const txReportSubmitBtn = document.getElementById(
  'txReportSubmitBtn',
) as HTMLButtonElement | null;
const txReportSummary = document.getElementById('txReportSummary') as HTMLElement | null;
const txReportTitleInput = document.getElementById(
  'txReportTitleInput',
) as HTMLInputElement | null;
const txReportCategoryInput = document.getElementById(
  'txReportCategoryInput',
) as HTMLSelectElement | null;
const txReportDescriptionInput = document.getElementById(
  'txReportDescriptionInput',
) as HTMLTextAreaElement | null;

const PAGE_SIZE = 20;
let refreshTimer: number | null = null;
let currentPage = 1;
let totalLogs = 0;
let allLogs: LogsResponse['logs'] = [];
let activeDrawerTransactionId: string | null = null;
let reportContext: TransactionContextPayload | null = null;
const transactionContextCache = new Map<string, TransactionContextPayload>();

type AdminReceiptPayload = {
  transactionId: string;
  mode: string | null;
  chargedAmount: number | null;
  status: string | null;
  change?: {
    requested: number;
    dispensed: number;
    remaining: number;
    state: string | null;
    attempts: number;
    owedChangeId: string | null;
    message: string | null;
  };
  settledAt: string | null;
  terminalAt: string | null;
  generatedAt: string;
};

type TransactionContextPayload = {
  transactionId: string;
  mode: string | null;
  chargedAmount: number | null;
  status: string | null;
  change: {
    requested: number | null;
    dispensed: number | null;
    remaining: number | null;
    state: string | null;
    attempts: number | null;
    owedChangeId: string | null;
    message: string | null;
  };
  settledAt: string | null;
  terminalAt: string | null;
  generatedAt: string;
  receipt: {
    available: boolean;
    expired: boolean;
    source: 'snapshot' | 'derived';
  };
  contextFlags: {
    hasIncompleteContext: boolean;
    hasReceiptSnapshot: boolean;
    hasTransactionLogs: boolean;
    missingTransactionMeta: boolean;
    missingReasons: string[];
  };
  settlement: {
    spoolerPhase: string | null;
    reconciliationAction: string | null;
    pendingRefundCount: number;
    hasOutstandingReview: boolean;
    hint: string | null;
  };
  spoolerLifecycle: {
    currentState: string | null;
    queuedAt: string | null;
    processingAt: string | null;
    printedAt: string | null;
    failedAt: string | null;
    transitions: Array<{
      state: string;
      timestamp: string;
      reason: string | null;
      printerName: string | null;
      spoolerCorrelationKey: string | null;
      spoolerJobId: number | null;
      jobStatus: string | null;
      pagesPrinted: number | null;
      totalPages: number | null;
      meta: Record<string, string | number | boolean | null>;
    }>;
  } | null;
  pendingRefunds: Array<{
    id: string;
    status: string;
    chargedAmount: number;
    reason: string;
    closedAt: string | null;
  }>;
  ledgerEntries: Array<{
    id: string;
    eventType: string;
    amount: number;
    timestamp: string;
  }>;
  relatedLogs: Array<{
    id: string;
    type: string;
    message: string;
    timestamp: string;
    meta: Record<string, string | number | boolean | null>;
  }>;
};

type FilterState = {
  transactionId: string;
  mode: '' | 'print' | 'copy' | 'scan';
  status: '' | 'created' | 'processing' | 'completed' | 'failed' | 'refund';
  eventType: string;
  dateFrom: string;
  dateTo: string;
};

type ReportCategory =
  | 'hardware'
  | 'software'
  | 'print'
  | 'copy'
  | 'scan'
  | 'payment'
  | 'network'
  | 'other';

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
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function formatDate(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function formatMode(value: string | null): string {
  if (!value) return '—';
  return value.toUpperCase();
}

function formatStatus(value: string | null): string {
  if (!value) return '—';
  if (value === 'settled_pending_terminal') return 'pending terminal confirmation';
  if (value === 'refunded_pending_review') return 'refund pending review';
  return value.replace(/_/g, ' ');
}

function formatPeso(value: number | null): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  return `₱${value.toFixed(2)}`;
}

function formatChangeState(value: string | null): string {
  if (!value) return 'none';
  if (value === 'failed') return 'dispense failed';
  if (value === 'dispensed') return 'dispensed';
  if (value === 'none') return 'none';
  return value.replace(/_/g, ' ');
}

function setField(target: HTMLElement | null, value: string): void {
  if (target) target.textContent = value;
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
  const amount = formatPeso(payload.chargedAmount);
  const changeRequested =
    typeof payload.change?.requested === 'number' &&
    Number.isFinite(payload.change.requested)
      ? Math.max(0, payload.change.requested)
      : 0;
  const changeDispensed =
    typeof payload.change?.dispensed === 'number' &&
    Number.isFinite(payload.change.dispensed)
      ? Math.max(0, Math.min(payload.change.dispensed, changeRequested))
      : 0;
  const changeRemaining =
    typeof payload.change?.remaining === 'number' &&
    Number.isFinite(payload.change.remaining)
      ? Math.max(0, payload.change.remaining)
      : Math.max(0, changeRequested - changeDispensed);
  const changeState =
    typeof payload.change?.state === 'string' ? payload.change.state : 'none';
  const changeMessage =
    typeof payload.change?.message === 'string' && payload.change.message.trim()
      ? payload.change.message.trim()
      : changeRemaining > 0
        ? 'Remaining change requires manual staff settlement.'
        : 'No outstanding change.';
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
        <div class="k">Mode</div><div class="v">${escapeHtml(formatMode(payload.mode))}</div>
        <div class="k">Charged</div><div class="v">${amount}</div>
        <div class="k">Change Requested</div><div class="v">${escapeHtml(formatPeso(changeRequested))}</div>
        <div class="k">Change Dispensed</div><div class="v">${escapeHtml(formatPeso(changeDispensed))}</div>
        <div class="k">Remaining Owed</div><div class="v">${escapeHtml(formatPeso(changeRemaining))}</div>
        <div class="k">Change Status</div><div class="v">${escapeHtml(formatChangeState(changeState))}</div>
        <div class="k">Change Message</div><div class="v">${escapeHtml(changeMessage)}</div>
        <div class="k">Status</div><div class="v">${escapeHtml(formatStatus(payload.status))}</div>
        <div class="k">Settled At</div><div class="v">${escapeHtml(formatDate(payload.settledAt))}</div>
        <div class="k">Terminal At</div><div class="v">${escapeHtml(formatDate(payload.terminalAt))}</div>
        <div class="k">Generated At</div><div class="v">${escapeHtml(formatDate(payload.generatedAt))}</div>
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

async function openReceiptWithButton(
  transactionId: string,
  actionButton: HTMLButtonElement,
): Promise<void> {
  const receiptWindow = window.open('', '_blank');
  if (!receiptWindow) {
    setMessage('Unable to open E-Receipt window. Please allow pop-ups and retry.');
    return;
  }
  writeReceiptWindow(receiptWindow, loadingReceiptHtml(transactionId));

  const defaultLabel = actionButton.textContent;
  actionButton.disabled = true;
  actionButton.textContent = 'Opening…';

  await openReceiptForTransaction(transactionId, receiptWindow)
    .then(() => setMessage(`Opened E-Receipt for ${transactionId}.`))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Failed to open E-Receipt.'),
    )
    .finally(() => {
      actionButton.disabled = false;
      actionButton.textContent = defaultLabel;
    });
}

async function copyToClipboard(value: string): Promise<boolean> {
  const text = value.trim();
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to textarea fallback
    }
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', 'true');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
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
    const transactionIdCell = transactionContextId
      ? escapeHtml(transactionContextId)
      : '<span class="tx-context-missing">Missing transaction context</span>';
    const actionMarkup = `
      <div class="tx-actions">
        <button class="tx-action-btn" data-action="view-details" data-transaction-id="${escapeHtml(transactionContextId ?? '')}" ${transactionContextId ? '' : 'disabled'}>
          View details
        </button>
        <button class="tx-action-btn" data-action="open-receipt" data-transaction-id="${escapeHtml(transactionContextId ?? '')}" ${transactionContextId ? '' : 'disabled'}>
          Open E-Receipt
        </button>
        <button class="tx-action-btn" data-action="copy-transaction-id" data-copy-value="${escapeHtml(transactionContextId ?? log.id)}">
          ${transactionContextId ? 'Copy ID' : 'Copy Log ID'}
        </button>
        <button class="tx-action-btn tx-action-btn--accent" data-action="create-report" data-transaction-id="${escapeHtml(transactionContextId ?? '')}" ${transactionContextId ? '' : 'disabled'}>
          Create report
        </button>
      </div>
    `;
    const tr = document.createElement('tr');
    tr.dataset.logId = log.id;
    tr.innerHTML = `
      <td class="logs-td logs-td--ts">${new Date(log.timestamp).toLocaleString()}</td>
      <td class="logs-td logs-td--id">${transactionIdCell}</td>
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

  if (filterState.transactionId) params.set('transactionId', filterState.transactionId);
  if (filterState.mode) params.set('mode', filterState.mode);
  if (filterState.status) params.set('status', filterState.status);
  if (filterState.eventType) params.set('eventType', filterState.eventType);

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
    const errorText = await resolveApiErrorMessage(
      res,
      'Failed to load transaction logs.',
    );
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
  transactionContextCache.clear();
  closeTransactionDrawer();
  closeReportModal();
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

function openTransactionDrawerShell(): void {
  txDrawerBackdrop?.classList.remove('hidden');
  txDetailDrawer?.classList.remove('hidden');
}

function closeTransactionDrawer(): void {
  activeDrawerTransactionId = null;
  txDrawerBackdrop?.classList.add('hidden');
  txDetailDrawer?.classList.add('hidden');
}

function resetDrawerView(): void {
  setField(dTransactionId, '—');
  setField(dMode, '—');
  setField(dAmount, '—');
  setField(dStatus, '—');
  setField(dChangeRequested, '—');
  setField(dChangeDispensed, '—');
  setField(dChangeRemaining, '—');
  setField(dChangeStatus, '—');
  setField(dChangeMessage, '—');
  setField(dSettledAt, '—');
  setField(dTerminalAt, '—');
  setField(dGeneratedAt, '—');
  setField(dContextHint, '—');
  if (dMissingReasons) dMissingReasons.innerHTML = '';
  if (dRelatedLogsBody) dRelatedLogsBody.innerHTML = '';
}

async function fetchTransactionContext(
  transactionId: string,
): Promise<TransactionContextPayload> {
  const cached = transactionContextCache.get(transactionId);
  if (cached) return cached;

  const res = await apiFetch(
    `/api/admin/transactions/${encodeURIComponent(transactionId)}/context`,
  );
  if (!res.ok) {
    const fallback =
      res.status === 404
        ? `Transaction ${transactionId} no longer has resolvable context.`
        : 'Failed to load transaction details.';
    const message = await resolveApiErrorMessage(res, fallback);
    throw new Error(message);
  }
  const payload = (await res.json()) as TransactionContextPayload;
  transactionContextCache.set(transactionId, payload);
  return payload;
}

function renderDrawerRelatedLogs(context: TransactionContextPayload): void {
  if (!dRelatedLogsBody) return;
  dRelatedLogsBody.innerHTML = '';
  if (context.relatedLogs.length === 0) {
    const row = document.createElement('tr');
    row.innerHTML = `<td colspan="3" style="color:var(--ink-muted);padding:9px">No related logs found.</td>`;
    dRelatedLogsBody.appendChild(row);
    return;
  }
  for (const entry of context.relatedLogs.slice(0, 20)) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(formatDate(entry.timestamp))}</td>
      <td>${escapeHtml(entry.type)}</td>
      <td>${escapeHtml(entry.message)}</td>
    `;
    dRelatedLogsBody.appendChild(row);
  }
}

function renderDrawer(context: TransactionContextPayload): void {
  setField(dTransactionId, context.transactionId);
  setField(dMode, formatMode(context.mode));
  setField(dAmount, formatPeso(context.chargedAmount));
  setField(dStatus, formatStatus(context.status));
  setField(dChangeRequested, formatPeso(context.change.requested));
  setField(dChangeDispensed, formatPeso(context.change.dispensed));
  setField(dChangeRemaining, formatPeso(context.change.remaining));
  setField(dChangeStatus, formatChangeState(context.change.state));
  setField(dChangeMessage, context.change.message ?? '—');
  setField(dSettledAt, formatDate(context.settledAt));
  setField(dTerminalAt, formatDate(context.terminalAt));
  setField(dGeneratedAt, formatDate(context.generatedAt));
  const hint =
    context.settlement.hint ??
    (context.contextFlags.hasIncompleteContext
      ? 'Some transaction context is incomplete.'
      : 'Transaction context is complete.');
  setField(dContextHint, hint);

  if (dMissingReasons) {
    dMissingReasons.innerHTML = '';
    if (context.contextFlags.missingReasons.length === 0) {
      const li = document.createElement('li');
      li.textContent = 'No missing context flags.';
      dMissingReasons.appendChild(li);
    } else {
      for (const reason of context.contextFlags.missingReasons) {
        const li = document.createElement('li');
        li.textContent = reason;
        dMissingReasons.appendChild(li);
      }
    }
  }

  renderDrawerRelatedLogs(context);
}

async function openTransactionDrawer(transactionId: string): Promise<void> {
  activeDrawerTransactionId = transactionId;
  openTransactionDrawerShell();
  resetDrawerView();
  if (txDetailState) txDetailState.textContent = 'Loading transaction context...';

  try {
    const context = await fetchTransactionContext(transactionId);
    if (activeDrawerTransactionId !== transactionId) return;
    renderDrawer(context);
    if (txDetailState) {
      txDetailState.textContent = context.contextFlags.hasIncompleteContext
        ? 'Context loaded with missing fields flagged below.'
        : 'Context loaded.';
    }
  } catch (error: unknown) {
    if (activeDrawerTransactionId !== transactionId) return;
    if (txDetailState) {
      txDetailState.textContent =
        error instanceof Error ? error.message : 'Failed to load context.';
    }
    setMessage(
      error instanceof Error ? error.message : 'Failed to load transaction context.',
    );
  }
}

function resolveReportCategory(context: TransactionContextPayload): ReportCategory {
  if (context.status === 'refunded' || context.status === 'refunded_pending_review') {
    return 'payment';
  }
  if (context.mode === 'print' || context.mode === 'copy' || context.mode === 'scan') {
    return context.mode;
  }
  return 'other';
}

function buildReportDescription(context: TransactionContextPayload): string {
  const missingFlags =
    context.contextFlags.missingReasons.length > 0
      ? context.contextFlags.missingReasons.join('; ')
      : 'none';
  return [
    `Transaction ID: ${context.transactionId}`,
    `Mode: ${formatMode(context.mode)}`,
    `Status: ${formatStatus(context.status)}`,
    `Charged Amount: ${formatPeso(context.chargedAmount)}`,
    `Change Remaining: ${formatPeso(context.change.remaining)}`,
    `Settled At: ${formatDate(context.settledAt)}`,
    `Terminal At: ${formatDate(context.terminalAt)}`,
    `Spooler Phase: ${context.settlement.spoolerPhase ?? '—'}`,
    `Reconciliation Action: ${context.settlement.reconciliationAction ?? '—'}`,
    `Missing Context Flags: ${missingFlags}`,
    '',
    'Issue details:',
  ].join('\n');
}

function openReportModalWithContext(context: TransactionContextPayload): void {
  reportContext = context;
  if (txReportSummary) {
    txReportSummary.textContent =
      `Transaction ${context.transactionId} · ${formatMode(context.mode)} · ${formatStatus(context.status)}`;
  }
  if (txReportTitleInput) {
    txReportTitleInput.value = `Transaction ${context.transactionId} support follow-up`;
  }
  if (txReportCategoryInput) {
    txReportCategoryInput.value = resolveReportCategory(context);
  }
  if (txReportDescriptionInput) {
    txReportDescriptionInput.value = buildReportDescription(context);
  }
  txReportModal?.classList.remove('hidden');
}

function closeReportModal(): void {
  txReportModal?.classList.add('hidden');
  reportContext = null;
}

async function openReportModalForTransaction(transactionId: string): Promise<void> {
  try {
    const context = await fetchTransactionContext(transactionId);
    openReportModalWithContext(context);
  } catch (error: unknown) {
    setMessage(
      error instanceof Error ? error.message : 'Failed to prepare report draft.',
    );
  }
}

async function submitQuickReport(): Promise<void> {
  if (!reportContext) {
    setMessage('No transaction context loaded for report creation.');
    return;
  }
  const title = txReportTitleInput?.value.trim() ?? '';
  const description = txReportDescriptionInput?.value.trim() ?? '';
  const category = (txReportCategoryInput?.value ?? 'other') as ReportCategory;
  if (!title) {
    setMessage('Report title is required.');
    return;
  }
  if (!description) {
    setMessage('Report description is required.');
    return;
  }

  if (txReportSubmitBtn) txReportSubmitBtn.disabled = true;
  setMessage('Submitting report...');
  try {
    const transactionId = reportContext.transactionId;
    const response = await apiFetch('/api/admin/report-issues', {
      method: 'POST',
      body: JSON.stringify({
        title,
        description,
        category,
        meta: {
          source: 'admin_transaction_logs',
          transactionId: reportContext.transactionId,
          mode: reportContext.mode,
          status: reportContext.status,
          chargedAmount: reportContext.chargedAmount,
          settledAt: reportContext.settledAt,
          terminalAt: reportContext.terminalAt,
          hasIncompleteContext: reportContext.contextFlags.hasIncompleteContext,
          pendingRefundCount: reportContext.settlement.pendingRefundCount,
        },
      }),
    });

    if (!response.ok) {
      const message = await resolveApiErrorMessage(
        response,
        'Failed to submit report.',
      );
      setMessage(message);
      if (txReportSubmitBtn) txReportSubmitBtn.disabled = false;
      return;
    }

    closeReportModal();
    setMessage(`Report created for transaction ${transactionId}.`);
    if (txReportSubmitBtn) txReportSubmitBtn.disabled = false;
  } catch {
    if (txReportSubmitBtn) txReportSubmitBtn.disabled = false;
    setMessage('Network error while submitting report.');
  }
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
  const actionButton = target.closest<HTMLButtonElement>('[data-action]');
  if (!actionButton) return;

  const action = actionButton.dataset.action;
  const transactionId = actionButton.dataset.transactionId?.trim() ?? '';

  if (action === 'view-details') {
    if (!transactionId) {
      setMessage('Missing transaction context for this log row.');
      return;
    }
    void openTransactionDrawer(transactionId);
    return;
  }

  if (action === 'open-receipt') {
    if (!transactionId) {
      setMessage('Missing transaction ID. Cannot open E-Receipt.');
      return;
    }
    void openReceiptWithButton(transactionId, actionButton);
    return;
  }

  if (action === 'copy-transaction-id') {
    const copyValue = actionButton.dataset.copyValue?.trim() ?? '';
    if (!copyValue) {
      setMessage('Nothing to copy.');
      return;
    }
    void copyToClipboard(copyValue).then((copied) => {
      if (copied) {
        setMessage(
          transactionId ? 'Transaction ID copied.' : 'Log ID copied (no transaction ID).',
        );
      } else {
        setMessage('Failed to copy value.');
      }
    });
    return;
  }

  if (action === 'create-report') {
    if (!transactionId) {
      setMessage('Missing transaction ID. Cannot create linked report.');
      return;
    }
    void openReportModalForTransaction(transactionId);
  }
});

txDetailCloseBtn?.addEventListener('click', closeTransactionDrawer);
txDrawerBackdrop?.addEventListener('click', closeTransactionDrawer);

dOpenReceiptBtn?.addEventListener('click', () => {
  if (!activeDrawerTransactionId) {
    setMessage('No active transaction selected.');
    return;
  }
  void openReceiptWithButton(activeDrawerTransactionId, dOpenReceiptBtn);
});

dCopyIdBtn?.addEventListener('click', () => {
  if (!activeDrawerTransactionId) {
    setMessage('No active transaction selected.');
    return;
  }
  void copyToClipboard(activeDrawerTransactionId).then((copied) =>
    setMessage(copied ? 'Transaction ID copied.' : 'Failed to copy transaction ID.'),
  );
});

dCreateReportBtn?.addEventListener('click', () => {
  if (!activeDrawerTransactionId) {
    setMessage('No active transaction selected.');
    return;
  }
  void openReportModalForTransaction(activeDrawerTransactionId);
});

txReportCloseBtn?.addEventListener('click', closeReportModal);
txReportCancelBtn?.addEventListener('click', closeReportModal);
txReportModal?.addEventListener('click', (event) => {
  if (event.target === txReportModal) closeReportModal();
});
txReportSubmitBtn?.addEventListener('click', () => void submitQuickReport());

initAuth(async () => {
  await loadData();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void loadData(), 10_000);
});
