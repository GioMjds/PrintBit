import {
  LogsResponse,
  SummaryResponse,
  apiFetch,
  setMessage,
  initAuth,
  updateSidebarBadges,
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
const dColorPages = document.getElementById('dColorPages') as HTMLElement | null;
const dBwPages = document.getElementById('dBwPages') as HTMLElement | null;
const dPagesPrinted = document.getElementById('dPagesPrinted') as HTMLElement | null;
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

type TransactionContextPayload = {
  transactionId: string;
  mode: string | null;
  chargedAmount: number | null;
  colorPages: number | null;
  bwPages: number | null;
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
          Open details
        </button>
      </div>
    `;
    const tr = document.createElement('tr');
    tr.dataset.logId = log.id;
    tr.innerHTML = `
      <td class="logs-td logs-td--ts">${new Date(log.timestamp).toLocaleString()}</td>
      <td class="logs-td logs-td--id">${transactionIdCell}</td>
      <td class="logs-td logs-td--mode">${escapeHtml(inferMode(log))}</td>
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
  updateSidebarBadges(summary);
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
  setMessage('Applying transaction filters…');
  void loadData()
    .then(() => setMessage('Transaction filters applied.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Filter failed.'),
    );
}

function openTransactionDrawerShell(): void {
  txDrawerBackdrop?.classList.remove('is-leaving');
  txDetailDrawer?.classList.remove('is-leaving');
  txDrawerBackdrop?.classList.remove('hidden');
  txDetailDrawer?.classList.remove('hidden');
}

function closeTransactionDrawer(): void {
  activeDrawerTransactionId = null;
  if (txDrawerBackdrop && !txDrawerBackdrop.classList.contains('hidden')) {
    txDrawerBackdrop.classList.add('is-leaving');
    txDetailDrawer?.classList.add('is-leaving');
    window.setTimeout(() => {
      txDrawerBackdrop?.classList.add('hidden');
      txDetailDrawer?.classList.add('hidden');
      txDrawerBackdrop?.classList.remove('is-leaving');
      txDetailDrawer?.classList.remove('is-leaving');
    }, 200);
  } else {
    txDrawerBackdrop?.classList.add('hidden');
    txDetailDrawer?.classList.add('hidden');
  }
}

function resetDrawerView(): void {
  setField(dTransactionId, '—');
  setField(dMode, '—');
  setField(dAmount, '—');
  setField(dStatus, '—');
  setField(dColorPages, '—');
  setField(dBwPages, '—');
  setField(dPagesPrinted, '—');
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

function resolveSpoolerPagesPrinted(context: TransactionContextPayload): {
  pagesPrinted: number | null;
  totalPages: number | null;
} {
  const transitions = context.spoolerLifecycle?.transitions ?? [];
  const lastPrinted = [...transitions]
    .reverse()
    .find((t) => t.state === 'printed');
  return {
    pagesPrinted: lastPrinted?.pagesPrinted ?? null,
    totalPages: lastPrinted?.totalPages ?? null,
  };
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
  const { pagesPrinted, totalPages } = resolveSpoolerPagesPrinted(context);

  setField(dTransactionId, context.transactionId);
  setField(dMode, formatMode(context.mode));
  setField(dAmount, formatPeso(context.chargedAmount));
  setField(dStatus, formatStatus(context.status));
  setField(
    dColorPages,
    context.colorPages != null ? String(context.colorPages) : '—',
  );
  setField(dBwPages, context.bwPages != null ? String(context.bwPages) : '—');
  setField(
    dPagesPrinted,
    pagesPrinted != null
      ? totalPages != null
        ? `${pagesPrinted} of ${totalPages}`
        : `${pagesPrinted}`
      : '—',
  );
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
  if (txDetailState) txDetailState.textContent = 'Loading transaction context…';

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

function closeReportModal(): void {
  reportContext = null;
  if (txReportModal && !txReportModal.classList.contains('hidden')) {
    txReportModal.classList.add('is-leaving');
    window.setTimeout(() => {
      txReportModal?.classList.add('hidden');
      txReportModal?.classList.remove('is-leaving');
    }, 200);
  } else {
    txReportModal?.classList.add('hidden');
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
  setMessage('Submitting report…');
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
  setMessage('Refreshing…');
  void loadData()
    .then(() => setMessage('Transaction logs refreshed.'))
    .catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Refresh failed.'),
    );
});

exportLogsBtn.addEventListener('click', () => {
  setMessage('Preparing transaction logs export…');
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
});

txDetailCloseBtn?.addEventListener('click', closeTransactionDrawer);
txDrawerBackdrop?.addEventListener('click', closeTransactionDrawer);

txReportCloseBtn?.addEventListener('click', closeReportModal);
txReportCancelBtn?.addEventListener('click', closeReportModal);
txReportModal?.addEventListener('click', (event) => {
  if (event.target === txReportModal) closeReportModal();
});
txReportSubmitBtn?.addEventListener('click', () => void submitQuickReport());

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (txDrawerBackdrop && !txDrawerBackdrop.classList.contains('hidden')) {
      closeTransactionDrawer();
    } else if (txReportModal && !txReportModal.classList.contains('hidden')) {
      closeReportModal();
    }
  }
});

initAuth(async () => {
  await loadData();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void loadData(), 10_000);
});
