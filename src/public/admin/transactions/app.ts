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

function getTransactionId(log: LogsResponse['logs'][number]): string {
  const transactionId = log.meta?.transactionId;
  return typeof transactionId === 'string' && transactionId.trim().length > 0
    ? transactionId
    : '—';
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
    tr.innerHTML = `<td colspan="5" style="text-align:center;color:var(--ink-muted);padding:24px">No transaction log entries.</td>`;
    logsBody.appendChild(tr);
    return;
  }

  for (const log of logs) {
    const tr = document.createElement('tr');
    tr.dataset.logId = log.id;
    tr.innerHTML = `
      <td class="logs-td logs-td--ts">${new Date(log.timestamp).toLocaleString()}</td>
      <td class="logs-td logs-td--id">${escapeHtml(getTransactionId(log))}</td>
      <td class="logs-td logs-td--mode">${escapeHtml(inferMode(log))}</td>
      <td class="logs-td logs-td--type">${escapeHtml(log.type)}</td>
      <td class="logs-td">${escapeHtml(log.message)}</td>
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

initAuth(async () => {
  await loadData();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void loadData(), 10_000);
});
