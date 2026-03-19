import {
  apiFetch,
  initAuth,
  setMessage,
  type ReconciliationReport,
} from '../shared';

interface ReconciliationListResponse {
  total: number;
  items: ReconciliationReport[];
}

const runNowBtn = document.getElementById('runNowBtn') as HTMLButtonElement;
const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
const exportCsvBtn = document.getElementById('exportCsvBtn') as HTMLButtonElement;
const exportPdfBtn = document.getElementById('exportPdfBtn') as HTMLButtonElement;
const saveCountBtn = document.getElementById('saveCountBtn') as HTMLButtonElement;
const countInput = document.getElementById('physicalCountInput') as HTMLInputElement;
const countByInput = document.getElementById('countedByInput') as HTMLInputElement;
const countNotesInput = document.getElementById(
  'countNotesInput',
) as HTMLTextAreaElement;

const reportDate = document.getElementById('reportDate') as HTMLElement;
const reportRevision = document.getElementById('reportRevision') as HTMLElement;
const reportGeneratedAt = document.getElementById('reportGeneratedAt') as HTMLElement;
const expectedCash = document.getElementById('expectedCash') as HTMLElement;
const expectedCashAfterLiabilities = document.getElementById(
  'expectedCashAfterLiabilities',
) as HTMLElement;
const totalCoinIntake = document.getElementById('totalCoinIntake') as HTMLElement;
const totalSettled = document.getElementById('totalSettled') as HTMLElement;
const totalRefunded = document.getElementById('totalRefunded') as HTMLElement;
const netSettled = document.getElementById('netSettled') as HTMLElement;
const varianceBadge = document.getElementById('varianceBadge') as HTMLElement;
const varianceAmount = document.getElementById('varianceAmount') as HTMLElement;

let latestReport: ReconciliationReport | null = null;

function peso(value: number): string {
  return `₱ ${value.toFixed(2)}`;
}

function resetViewForEmptyState(): void {
  latestReport = null;
  reportDate.textContent = '-';
  reportRevision.textContent = '-';
  reportGeneratedAt.textContent = '-';
  expectedCash.textContent = peso(0);
  expectedCashAfterLiabilities.textContent = peso(0);
  totalCoinIntake.textContent = peso(0);
  totalSettled.textContent = peso(0);
  totalRefunded.textContent = peso(0);
  netSettled.textContent = peso(0);
  countInput.value = '';
  varianceBadge.textContent = 'PENDING';
  varianceBadge.className = 'recon-badge recon-badge--pending';
  varianceAmount.textContent = peso(0);
}

function updateVarianceUi(report: ReconciliationReport): void {
  const status = report.variance.status;
  varianceBadge.textContent = status.toUpperCase();
  varianceBadge.className = `recon-badge recon-badge--${status}`;
  varianceAmount.textContent = peso(report.variance.amount);
}

function applyReport(report: ReconciliationReport): void {
  latestReport = report;
  reportDate.textContent = report.dateKey;
  reportRevision.textContent = `R${report.revision}`;
  reportGeneratedAt.textContent = new Date(report.generatedAt).toLocaleString();
  expectedCash.textContent = peso(report.expectedCash);
  expectedCashAfterLiabilities.textContent = peso(
    report.expectedCashAfterLiabilities,
  );
  totalCoinIntake.textContent = peso(report.totals.coinIntake);
  totalSettled.textContent = peso(report.totals.settledAmount);
  totalRefunded.textContent = peso(report.totals.refundIssued);
  netSettled.textContent = peso(report.totals.netSettled);
  countInput.value = report.physicalCount
    ? String(report.physicalCount.countedAmount)
    : '';
  updateVarianceUi(report);
}

async function loadLatest(): Promise<void> {
  const response = await apiFetch('/api/admin/reconciliation/reports?to=9999-12-31');
  if (!response.ok) {
    throw new Error('Failed to load reconciliation reports.');
  }
  const data = (await response.json()) as ReconciliationListResponse;
  const report = data.items[0];
  if (!report) {
    resetViewForEmptyState();
    setMessage('No reconciliation reports yet. Click "Run now" first.');
    return;
  }
  applyReport(report);
}

async function runNow(): Promise<void> {
  const response = await apiFetch('/api/admin/reconciliation/reports/run', {
    method: 'POST',
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error('Failed to run reconciliation.');
  }
  await loadLatest();
}

async function savePhysicalCount(): Promise<void> {
  if (!latestReport) throw new Error('No report loaded.');
  const countedAmount = Number(countInput.value);
  if (!Number.isFinite(countedAmount) || countedAmount < 0) {
    throw new Error('Physical count must be a non-negative number.');
  }

  const response = await apiFetch(
    `/api/admin/reconciliation/reports/${encodeURIComponent(latestReport.id)}/physical-count`,
    {
      method: 'POST',
      body: JSON.stringify({
        countedAmount,
        countedBy: countByInput.value.trim() || null,
        notes: countNotesInput.value.trim() || null,
      }),
    },
  );
  if (!response.ok) {
    throw new Error('Failed to save physical count.');
  }
  const body = (await response.json()) as { report: ReconciliationReport };
  applyReport(body.report);
}

async function exportReport(kind: 'csv' | 'pdf'): Promise<void> {
  if (!latestReport) throw new Error('No report loaded.');
  const response = await apiFetch(
    `/api/admin/reconciliation/reports/${encodeURIComponent(latestReport.id)}/export.${kind}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to export ${kind.toUpperCase()}.`);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `printbit-reconciliation-${latestReport.dateKey}-r${latestReport.revision}.${kind}`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

runNowBtn.addEventListener('click', () => {
  setMessage('Running reconciliation...');
  void runNow()
    .then(() => setMessage('Reconciliation report generated.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Failed to run report.'),
    );
});

refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void loadLatest()
    .then(() => setMessage('Reconciliation refreshed.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Failed to refresh.'),
    );
});

saveCountBtn.addEventListener('click', () => {
  setMessage('Saving physical count...');
  void savePhysicalCount()
    .then(() => setMessage('Physical count saved.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'Failed to save count.'),
    );
});

exportCsvBtn.addEventListener('click', () => {
  setMessage('Preparing CSV export...');
  void exportReport('csv')
    .then(() => setMessage('CSV exported.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'CSV export failed.'),
    );
});

exportPdfBtn.addEventListener('click', () => {
  setMessage('Preparing PDF export...');
  void exportReport('pdf')
    .then(() => setMessage('PDF exported.'))
    .catch((error: unknown) =>
      setMessage(error instanceof Error ? error.message : 'PDF export failed.'),
    );
});

initAuth(async () => {
  try {
    await loadLatest();
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Failed to load reconciliation.';
    setMessage(message);
  }
});
