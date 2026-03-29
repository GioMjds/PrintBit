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
const clearLogsBtn = document.getElementById(
  'clearLogsBtn',
) as HTMLButtonElement;
const prevPageBtn = document.getElementById('prevPageBtn') as HTMLButtonElement;
const nextPageBtn = document.getElementById('nextPageBtn') as HTMLButtonElement;
const pageInfo = document.getElementById('pageInfo') as HTMLElement;
const transactionSearchInput = document.getElementById(
  'transactionSearchInput',
) as HTMLInputElement | null;
const transactionSearchBtn = document.getElementById(
  'transactionSearchBtn',
) as HTMLButtonElement | null;
const transactionSearchClearBtn = document.getElementById(
  'transactionSearchClearBtn',
) as HTMLButtonElement | null;
const transactionLookupResult = document.getElementById(
  'transactionLookupResult',
) as HTMLElement | null;
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
let activeTransactionIdFilter = '';

type TransactionLookupResponse = {
  transactionId: string;
  mode: string | null;
  chargedAmount: number | null;
  settledAt: string | null;
  spoolerPhase: string | null;
  reconciliationAction: string | null;
  pendingRefunds: Array<{
    id: string;
    status: string;
    chargedAmount: number;
    reason: string;
  }>;
};

function setOpenAlertBadge(openCount: number): void {
  const value = openCount > 0 ? String(openCount) : '';
  if (openAlertBadge) openAlertBadge.textContent = value;
  if (openAlertBadgeMob) openAlertBadgeMob.textContent = value;
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
    tr.innerHTML = `<td colspan="4" style="text-align:center;color:var(--ink-muted);padding:24px">No log entries.</td>`;
    logsBody.appendChild(tr);
    return;
  }

  for (const log of logs) {
    const tr = document.createElement('tr');
    tr.dataset.logId = log.id;
    tr.innerHTML = `
      <td class="logs-td logs-td--ts">${new Date(log.timestamp).toLocaleString()}</td>
      <td class="logs-td">${escapeHtml(log.message)}</td>
      <td class="logs-td logs-td--action">
        <button class="log-delete-btn" aria-label="Delete log entry" data-id="${escapeHtml(log.id)}">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" aria-hidden="true">
            <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"/>
          </svg>
        </button>
      </td>
    `;
    logsBody.appendChild(tr);
  }

  logsBody
    .querySelectorAll<HTMLButtonElement>('.log-delete-btn')
    .forEach((btn) => {
      btn.addEventListener(
        'click',
        () => void deleteSingleLog(btn.dataset.id!),
      );
    });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadData(): Promise<void> {
  const params = new URLSearchParams({ limit: '1000' });

  if (activeTransactionIdFilter) {
    params.set('transactionId', activeTransactionIdFilter);
  }
  const res = await apiFetch(`/api/admin/logs?${params.toString()}`);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid admin PIN.');
    throw new Error('Failed to load logs.');
  }
  const data = (await res.json()) as LogsResponse;
  allLogs = data.logs;
  totalLogs = allLogs.length;
  if (currentPage > totalPages()) currentPage = totalPages();
  renderPage();
  await loadSummary();
}

function showLookupResult(message: string | null): void {
  if (!transactionLookupResult) return;
  if (!message) {
    transactionLookupResult.setAttribute('hidden', '');
    transactionLookupResult.textContent = '';
    return;
  }
  transactionLookupResult.textContent = message;
  transactionLookupResult.removeAttribute('hidden');
}

async function loadTransactionSummary(transactionId: string): Promise<void> {
  const res = await apiFetch(
    `/api/admin/transactions/${encodeURIComponent(transactionId)}`,
  );
  if (!res.ok) {
    showLookupResult(
      res.status === 404
        ? `No transaction summary found for ${transactionId}.`
        : `Failed to load transaction summary for ${transactionId}.`,
    );
    return;
  }
  const data = (await res.json()) as TransactionLookupResponse;
  const amountText =
    typeof data.chargedAmount === 'number'
      ? `₱${data.chargedAmount.toFixed(2)}`
      : 'unknown';
  const settledText = data.settledAt
    ? new Date(data.settledAt).toLocaleString()
    : 'unknown';
  const refundState =
    data.pendingRefunds.length > 0
      ? `${data.pendingRefunds.length} pending/processed refund record(s)`
      : 'no refund records';
  showLookupResult(
    `Transaction ${data.transactionId} • mode=${data.mode ?? 'unknown'} • amount=${amountText} • settled=${settledText} • spooler=${data.spoolerPhase ?? 'n/a'} • ${refundState}`,
  );
}

function applyTransactionSearch(): void {
  const raw = transactionSearchInput?.value ?? '';
  activeTransactionIdFilter = raw.trim();
  currentPage = 1;
  if (!activeTransactionIdFilter) {
    showLookupResult(null);
    setMessage('Showing all logs.');
    void loadData().catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Search failed.'),
    );
    return;
  }

  setMessage(`Searching transaction: ${activeTransactionIdFilter}`);
  void loadData()
    .then(() => loadTransactionSummary(activeTransactionIdFilter))
    .catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Search failed.'),
    );
}

async function loadSummary(): Promise<void> {
  const res = await apiFetch('/api/admin/summary');
  if (!res.ok) return;
  const summary = (await res.json()) as SummaryResponse;
  setOpenAlertBadge(summary.anomalyStats.openCount);
}

async function deleteSingleLog(id: string): Promise<void> {
  setMessage('Deleting entry…');
  const res = await apiFetch(`/api/admin/logs/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  if (!res.ok) {
    setMessage('Failed to delete entry.');
    return;
  }
  allLogs = allLogs.filter((l) => l.id !== id);
  totalLogs = allLogs.length;
  if (currentPage > totalPages()) currentPage = totalPages();
  renderPage();
  setMessage('Entry deleted.');
}

async function clearAllLogs(): Promise<void> {
  if (!confirm('Delete ALL log entries? This cannot be undone.')) return;
  setMessage('Clearing logs…');
  const res = await apiFetch('/api/admin/logs', { method: 'DELETE' });
  if (!res.ok) {
    setMessage('Failed to clear logs.');
    return;
  }
  allLogs = [];
  totalLogs = 0;
  currentPage = 1;
  renderPage();
  setMessage('All logs cleared.');
}

refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void loadData()
    .then(() => setMessage('Logs refreshed.'))
    .catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Refresh failed.'),
    );
});

exportLogsBtn.addEventListener('click', () => {
  setMessage('Preparing logs export...');
  void apiFetch('/api/admin/logs/export.csv')
    .then(async (response) => {
      if (!response.ok) throw new Error('Failed to export logs.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `printbit-admin-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage('Logs exported.');
    })
    .catch((error: unknown) => {
      const msg =
        error instanceof Error ? error.message : 'Failed to export logs.';
      setMessage(msg);
    });
});

clearLogsBtn.addEventListener('click', () => void clearAllLogs());

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

transactionSearchBtn?.addEventListener('click', applyTransactionSearch);
transactionSearchInput?.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  applyTransactionSearch();
});
transactionSearchClearBtn?.addEventListener('click', () => {
  if (transactionSearchInput) transactionSearchInput.value = '';
  activeTransactionIdFilter = '';
  currentPage = 1;
  showLookupResult(null);
  setMessage('Showing all logs.');
  void loadData().catch((e: unknown) =>
    setMessage(e instanceof Error ? e.message : 'Refresh failed.'),
  );
});

initAuth(async () => {
  await loadData();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void loadData(), 10_000);
});
