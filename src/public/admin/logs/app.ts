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
    tr.innerHTML = `<td colspan="2" style="text-align:center;color:var(--ink-muted);padding:24px">No system log entries.</td>`;
    logsBody.appendChild(tr);
    return;
  }

  for (const log of logs) {
    const tr = document.createElement('tr');
    tr.dataset.logId = log.id;
    tr.innerHTML = `
      <td class="logs-td logs-td--ts">${new Date(log.timestamp).toLocaleString()}</td>
      <td class="logs-td">${escapeHtml(log.message)}</td>
    `;
    logsBody.appendChild(tr);
  }
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
  const res = await apiFetch(`/api/admin/logs/system?${params.toString()}`);
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid admin PIN.');
    throw new Error('Failed to load system logs.');
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

async function clearAllLogs(): Promise<void> {
  if (!confirm('Delete ALL system log entries? This cannot be undone.')) return;
  setMessage('Clearing system logs…');
  const res = await apiFetch('/api/admin/logs/system', { method: 'DELETE' });
  if (!res.ok) {
    setMessage('Failed to clear system logs.');
    return;
  }
  allLogs = [];
  totalLogs = 0;
  currentPage = 1;
  renderPage();
  setMessage('All system logs cleared.');
}

refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void loadData()
    .then(() => setMessage('System logs refreshed.'))
    .catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Refresh failed.'),
    );
});

exportLogsBtn.addEventListener('click', () => {
  setMessage('Preparing system logs export...');
  void apiFetch('/api/admin/logs/system/export.csv')
    .then(async (response) => {
      if (!response.ok) throw new Error('Failed to export system logs.');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `printbit-admin-system-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage('System logs exported.');
    })
    .catch((error: unknown) => {
      const msg =
        error instanceof Error ? error.message : 'Failed to export system logs.';
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

initAuth(async () => {
  await loadData();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void loadData(), 10_000);
});
