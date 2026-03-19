import { apiFetch, initAuth, setMessage } from '../shared';

interface AnomalyIncident {
  id: string;
  type: string;
  source: string;
  category: 'printer' | 'spooler' | 'serial' | 'hopper' | 'network';
  severity: 'warning' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  message: string;
  context?: Record<string, string | number | boolean | null>;
  occurrenceCount: number;
  firstDetectedAt: string;
  lastDetectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}

interface AnomalyListResponse {
  total: number;
  openCount: number;
  acknowledgedCount: number;
  resolvedCount: number;
  items: AnomalyIncident[];
}

const incidentList = document.getElementById('incidentList') as HTMLElement;
const filterBar = document.getElementById('filterBar') as HTMLElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const prevPageBtn = document.getElementById('prevPageBtn') as HTMLButtonElement;
const nextPageBtn = document.getElementById('nextPageBtn') as HTMLButtonElement;
const pageInfo = document.getElementById('pageInfo') as HTMLElement;
const statTotal = document.getElementById('statTotal') as HTMLElement;
const statOpen = document.getElementById('statOpen') as HTMLElement;
const statAck = document.getElementById('statAck') as HTMLElement;
const statResolved = document.getElementById('statResolved') as HTMLElement;
const openAlertBadge = document.getElementById('openAlertBadge') as HTMLElement;
const openAlertBadgeMob = document.getElementById(
  'openAlertBadgeMob',
) as HTMLElement | null;

const detailOverlay = document.getElementById('detailOverlay') as HTMLElement;
const detailTitle = document.getElementById('detailTitle') as HTMLElement;
const detailBody = document.getElementById('detailBody') as HTMLElement;
const closeDetail = document.getElementById('closeDetail') as HTMLButtonElement;
const detailAckBtn = document.getElementById(
  'detailAckBtn',
) as HTMLButtonElement;
const detailResolveBtn = document.getElementById(
  'detailResolveBtn',
) as HTMLButtonElement;
const detailReopenBtn = document.getElementById(
  'detailReopenBtn',
) as HTMLButtonElement;

const PAGE_SIZE = 10;
let currentPage = 1;
let totalItems = 0;
let activeFilter: 'all' | 'open' | 'acknowledged' | 'resolved' = 'all';
let currentPageItems: AnomalyIncident[] = [];
let activeDetailId: string | null = null;
let refreshTimer: number | null = null;

function escHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function totalPages(): number {
  return Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
}

function updatePagination(): void {
  pageInfo.textContent = `Page ${currentPage} of ${totalPages()}`;
  prevPageBtn.disabled = currentPage <= 1;
  nextPageBtn.disabled = currentPage >= totalPages();
}

function updateStats(data: AnomalyListResponse): void {
  statTotal.textContent = String(data.total);
  statOpen.textContent = String(data.openCount);
  statAck.textContent = String(data.acknowledgedCount);
  statResolved.textContent = String(data.resolvedCount);
  const openText = data.openCount > 0 ? String(data.openCount) : '';
  openAlertBadge.textContent = openText;
  if (openAlertBadgeMob) openAlertBadgeMob.textContent = openText;
}

function renderIncidents(items: AnomalyIncident[]): void {
  incidentList.innerHTML = '';
  if (items.length === 0) {
    incidentList.innerHTML =
      '<div class="ri-empty"><div class="ri-empty__icon">📟</div><p>No anomalies found.</p></div>';
    return;
  }

  for (const item of items) {
    const card = document.createElement('div');
    card.className = `ri-card ri-card--${item.severity}`;
    card.innerHTML = `
      <div class="ri-card__accent"></div>
      <div class="ri-card__body">
        <div class="ri-card__meta">
          <span class="ri-card__time">${new Date(item.lastDetectedAt).toLocaleString()}</span>
          <span class="ri-badge ri-badge--${item.status}">${escHtml(item.status)}</span>
          <span class="ri-badge ri-badge--${item.severity}">${escHtml(item.severity)}</span>
          <span class="ri-badge ri-badge--cat">${escHtml(item.category)}</span>
        </div>
        <p class="ri-card__title">${escHtml(item.type)}</p>
        <p class="ri-card__desc">${escHtml(item.message)}</p>
        <div class="ri-card__actions">
          <button class="ri-action-btn" data-action="view" data-id="${escHtml(item.id)}">View</button>
        </div>
      </div>
    `;
    incidentList.appendChild(card);
  }

  incidentList
    .querySelectorAll<HTMLButtonElement>('[data-action="view"]')
    .forEach((button) => {
      button.addEventListener('click', () => {
        void openDetail(button.dataset.id!);
      });
    });
}

async function loadData(): Promise<void> {
  const offset = (currentPage - 1) * PAGE_SIZE;
  const statusParam = activeFilter !== 'all' ? `&status=${activeFilter}` : '';
  const response = await apiFetch(
    `/api/admin/anomaly-incidents?limit=${PAGE_SIZE}&offset=${offset}${statusParam}`,
  );
  if (!response.ok) {
    throw new Error('Failed to load anomaly incidents.');
  }

  const data = (await response.json()) as AnomalyListResponse;
  totalItems = data.total;
  currentPageItems = data.items;
  renderIncidents(data.items);
  updateStats(data);
  updatePagination();
}

async function openDetail(id: string): Promise<void> {
  activeDetailId = id;
  const response = await apiFetch(`/api/admin/anomaly-incidents/${id}`);
  if (!response.ok) {
    setMessage('Failed to load incident detail.');
    return;
  }
  const payload = (await response.json()) as { incident: AnomalyIncident };
  const incident = payload.incident;
  detailTitle.textContent = `${incident.type} (${incident.status})`;
  detailBody.innerHTML = `
    <dl class="ri-detail-grid">
      <dt>Type</dt><dd>${escHtml(incident.type)}</dd>
      <dt>Message</dt><dd>${escHtml(incident.message)}</dd>
      <dt>Severity</dt><dd>${escHtml(incident.severity)}</dd>
      <dt>Status</dt><dd>${escHtml(incident.status)}</dd>
      <dt>Category</dt><dd>${escHtml(incident.category)}</dd>
      <dt>Source</dt><dd>${escHtml(incident.source)}</dd>
      <dt>Occurrences</dt><dd>${incident.occurrenceCount}</dd>
      <dt>First seen</dt><dd>${new Date(incident.firstDetectedAt).toLocaleString()}</dd>
      <dt>Last seen</dt><dd>${new Date(incident.lastDetectedAt).toLocaleString()}</dd>
      <dt>Acknowledged</dt><dd>${incident.acknowledgedAt ? new Date(incident.acknowledgedAt).toLocaleString() : '—'}</dd>
      <dt>Resolved</dt><dd>${incident.resolvedAt ? new Date(incident.resolvedAt).toLocaleString() : '—'}</dd>
    </dl>
    ${
      incident.context
        ? `<pre class="ri-context">${escHtml(
            JSON.stringify(incident.context, null, 2),
          )}</pre>`
        : ''
    }
  `;

  detailAckBtn.classList.toggle('hidden', incident.status !== 'open');
  detailResolveBtn.classList.toggle('hidden', incident.status === 'resolved');
  detailReopenBtn.classList.toggle('hidden', incident.status === 'open');

  detailOverlay.classList.remove('hidden');
}

async function updateStatus(
  status: 'open' | 'acknowledged' | 'resolved',
): Promise<void> {
  if (!activeDetailId) return;
  const response = await apiFetch(
    `/api/admin/anomaly-incidents/${activeDetailId}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
  if (!response.ok) {
    setMessage('Failed to update status.');
    return;
  }
  detailOverlay.classList.add('hidden');
  activeDetailId = null;
  await loadData();
  setMessage('Incident status updated.');
}

function closeDetailModal(): void {
  detailOverlay.classList.add('hidden');
  activeDetailId = null;
}

refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void loadData()
    .then(() => setMessage('Alerts refreshed.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Refresh failed.'),
    );
});

filterBar
  .querySelectorAll<HTMLButtonElement>('.filter-btn')
  .forEach((button) => {
    button.addEventListener('click', () => {
      activeFilter = button.dataset.filter as typeof activeFilter;
      currentPage = 1;
      filterBar
        .querySelectorAll('.filter-btn')
        .forEach((btn) => btn.classList.remove('filter-btn--active'));
      button.classList.add('filter-btn--active');
      void loadData();
    });
  });

prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage -= 1;
    void loadData();
  }
});

nextPageBtn.addEventListener('click', () => {
  if (currentPage < totalPages()) {
    currentPage += 1;
    void loadData();
  }
});

closeDetail.addEventListener('click', closeDetailModal);
detailOverlay.addEventListener('click', (event) => {
  if (event.target === detailOverlay) closeDetailModal();
});

detailAckBtn.addEventListener('click', () => void updateStatus('acknowledged'));
detailResolveBtn.addEventListener('click', () => void updateStatus('resolved'));
detailReopenBtn.addEventListener('click', () => void updateStatus('open'));

declare const io: (opts?: {
  auth?: Record<string, string>;
  reconnectionDelay?: number;
}) => {
  on(event: string, cb: (...args: unknown[]) => void): void;
  disconnect(): void;
};

let socket: ReturnType<typeof io> | null = null;

function connectSocket(): void {
  const pin = sessionStorage.getItem('adminPin') ?? '';
  socket = io({ auth: { pin }, reconnectionDelay: 2000 });
  socket.on('adminAnomalyIncident', () => {
    void loadData();
  });
  socket.on('adminAnomalyCount', (payload: unknown) => {
    const openCount =
      payload &&
      typeof payload === 'object' &&
      'openCount' in payload &&
      typeof (payload as { openCount: unknown }).openCount === 'number'
        ? (payload as { openCount: number }).openCount
        : 0;
    const openText = openCount > 0 ? String(openCount) : '';
    openAlertBadge.textContent = openText;
    if (openAlertBadgeMob) openAlertBadgeMob.textContent = openText;
  });
}

initAuth(async () => {
  await loadData();
  connectSocket();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => void loadData(), 10_000);
});

window.addEventListener('pagehide', () => {
  socket?.disconnect();
});
