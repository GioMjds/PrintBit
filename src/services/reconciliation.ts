import { randomUUID } from 'node:crypto';
import { db, type FinancialLedgerEntry, type ReconciliationReport } from './db';
import { getTrustedTimestamp } from './time-source';
import { adminService } from './admin';
import { financialLedgerService } from './financial-ledger';

function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localDayRangeFromDateKey(dateKey: string): { start: Date; end: Date } {
  const [yRaw, mRaw, dRaw] = dateKey.split('-');
  const y = Number(yRaw);
  const m = Number(mRaw);
  const d = Number(dRaw);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d, 23, 59, 59, 999);
  return { start, end };
}

function readNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function inRange(
  entry: FinancialLedgerEntry,
  startMs: number,
  endMs: number,
): boolean {
  const ts = Date.parse(entry.timestamp);
  return Number.isFinite(ts) && ts >= startMs && ts <= endMs;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function pdfStr(text: string): string {
  let latin1only = '';
  for (const ch of text) {
    if (ch.charCodeAt(0) <= 0xff) latin1only += ch;
  }
  return latin1only
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

function xrefEntry(offset: number, gen: number, kind: 'n' | 'f'): string {
  return `${String(offset).padStart(10, '0')} ${String(gen).padStart(5, '0')} ${kind}\r\n`;
}

function buildSimplePdf(lines: string[]): Buffer {
  const streamLines = ['BT', '/F1 12 Tf'];
  let y = 780;
  for (const line of lines) {
    streamLines.push(`1 0 0 1 50 ${y} Tm`);
    streamLines.push(`(${pdfStr(line)}) Tj`);
    y -= 16;
  }
  streamLines.push('ET');

  const streamBuf = Buffer.from(streamLines.join('\n'), 'latin1');
  const o1 = Buffer.from(
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    'latin1',
  );
  const o2 = Buffer.from(
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    'latin1',
  );
  const o3 = Buffer.from(
    '3 0 obj\n' +
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R ' +
      '/Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n',
    'latin1',
  );
  const o4 = Buffer.concat([
    Buffer.from(`4 0 obj\n<< /Length ${streamBuf.length} >>\nstream\n`, 'latin1'),
    streamBuf,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ]);
  const o5 = Buffer.from(
    '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n',
    'latin1',
  );
  const header = Buffer.from('%PDF-1.4\n', 'latin1');
  const objects = [o1, o2, o3, o4, o5];
  const offsets: number[] = [];
  let bytePos = header.length;
  for (const obj of objects) {
    offsets.push(bytePos);
    bytePos += obj.length;
  }
  const xrefOffset = bytePos;
  const xref =
    'xref\n' +
    `0 ${objects.length + 1}\n` +
    xrefEntry(0, 65535, 'f') +
    offsets.map((offset) => xrefEntry(offset, 0, 'n')).join('');
  const trailer =
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.concat([
    header,
    ...objects,
    Buffer.from(xref, 'latin1'),
    Buffer.from(trailer, 'latin1'),
  ]);
}

class ReconciliationService {
  private runningDates = new Set<string>();
  generateDailyReport(input: {
    dateKey?: string;
    generatedBy: 'auto' | 'manual';
  }): ReconciliationReport {
    const dateKey = input.dateKey ?? toDateKey(new Date());
    const { start, end } = localDayRangeFromDateKey(dateKey);
    const startMs = start.getTime();
    const endMs = end.getTime();
    const entries = db.data!.financialLedger.filter((entry) =>
      inRange(entry, startMs, endMs),
    );

    const coinIntake = entries
      .filter((entry) => entry.eventType === 'coin_inserted')
      .reduce((sum, entry) => sum + readNumber(entry.amount), 0);
    const settledAmount = entries
      .filter((entry) => entry.eventType === 'job_completed')
      .reduce((sum, entry) => sum + readNumber(entry.amount), 0);
    const refundIssued = entries
      .filter((entry) => entry.eventType === 'refund_issued')
      .reduce((sum, entry) => sum + Math.abs(readNumber(entry.amount)), 0);

    const openPendingRefundAmount = (db.data!.pendingRefunds ?? [])
      .filter((entry) => entry.status === 'open')
      .reduce((sum, entry) => sum + readNumber(entry.chargedAmount), 0);
    const openOwedChangeAmount = (db.data!.owedChanges ?? [])
      .filter((entry) => entry.status === 'open')
      .reduce((sum, entry) => sum + readNumber(entry.amount), 0);

    const existingReports = db.data!.reconciliationReports.filter(
      (item) => item.dateKey === dateKey,
    );
    const revision = existingReports.length + 1;
    const trusted = getTrustedTimestamp();
    const threshold = readNumber(
      db.data!.reconciliationSettings.varianceThreshold,
    );
    const sortedAsc = [...entries].reverse();

    const report: ReconciliationReport = {
      id: randomUUID(),
      dateKey,
      revision,
      generatedAt: trusted.timestamp,
      generatedBy: input.generatedBy,
      timestampMeta: trusted.meta,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      totals: {
        coinIntake: round2(coinIntake),
        settledAmount: round2(settledAmount),
        refundIssued: round2(refundIssued),
        netSettled: round2(settledAmount - refundIssued),
        jobStartedCount: entries.filter(
          (entry) => entry.eventType === 'job_started',
        ).length,
        jobCompletedCount: entries.filter(
          (entry) => entry.eventType === 'job_completed',
        ).length,
        refundCount: entries.filter(
          (entry) => entry.eventType === 'refund_issued',
        ).length,
        ledgerEntryCount: entries.length,
      },
      liabilities: {
        openPendingRefundAmount: round2(openPendingRefundAmount),
        openOwedChangeAmount: round2(openOwedChangeAmount),
      },
      expectedCash: round2(settledAmount - refundIssued),
      expectedCashAfterLiabilities: round2(
        settledAmount -
          refundIssued -
          openPendingRefundAmount -
          openOwedChangeAmount,
      ),
      physicalCount: null,
      variance: {
        threshold,
        amount: 0,
        hasVariance: false,
        status: 'pending',
        alertLogId: null,
      },
      ledgerDigest: {
        entryCount: entries.length,
        firstHash: sortedAsc[0]?.hash ?? null,
        lastHash: entries[0]?.hash ?? null,
      },
      archivedAt: trusted.timestamp,
    };

    db.data!.reconciliationReports.unshift(report);
    db.data!.reconciliationReports.sort((a, b) =>
      a.generatedAt > b.generatedAt ? -1 : 1,
    );
    if (input.generatedBy === 'auto') {
      db.data!.reconciliationSettings.lastAutoRunDateKey = dateKey;
    }
    return report;
  }

  async runDailyReport(input: {
    dateKey?: string;
    generatedBy: 'auto' | 'manual';
  }): Promise<ReconciliationReport> {
    const dateKey = input.dateKey ?? toDateKey(new Date());
    if (this.runningDates.has(dateKey)) {
      throw new Error(`Reconciliation is already running for ${dateKey}.`);
    }
    this.runningDates.add(dateKey);
    try {
      const report = this.generateDailyReport({ ...input, dateKey });
      await db.write();
      await adminService.appendAdminLog(
        'reconciliation_report_generated',
        'Reconciliation report generated.',
        {
          reportId: report.id,
          dateKey: report.dateKey,
          revision: report.revision,
          generatedBy: report.generatedBy,
        },
      );
      return report;
    } finally {
      this.runningDates.delete(dateKey);
    }
  }

  listReports(range?: { from?: string; to?: string }): ReconciliationReport[] {
    const from = typeof range?.from === 'string' ? range.from : null;
    const to = typeof range?.to === 'string' ? range.to : null;

    return db.data!.reconciliationReports
      .filter((report) => {
        if (from && report.dateKey < from) return false;
        if (to && report.dateKey > to) return false;
        return true;
      })
      .sort((a, b) => (a.generatedAt > b.generatedAt ? -1 : 1));
  }

  getReportById(id: string): ReconciliationReport | null {
    return (
      db.data!.reconciliationReports.find((report) => report.id === id) ?? null
    );
  }

  getLatestReport(): ReconciliationReport | null {
    return db.data!.reconciliationReports[0] ?? null;
  }

  async submitPhysicalCount(input: {
    reportId: string;
    countedAmount: number;
    countedBy?: string | null;
    notes?: string | null;
  }): Promise<ReconciliationReport | null> {
    const report = this.getReportById(input.reportId);
    if (!report) return null;

    const trusted = getTrustedTimestamp();
    const countedAmount = round2(Math.max(0, readNumber(input.countedAmount)));
    const varianceAmount = round2(countedAmount - report.expectedCash);
    const hasVariance = Math.abs(varianceAmount) > report.variance.threshold;
    const status = hasVariance
      ? 'mismatch'
      : Math.abs(varianceAmount) === 0
        ? 'matched'
        : 'mismatch';

    report.physicalCount = {
      countedAmount,
      countedAt: trusted.timestamp,
      countedBy:
        typeof input.countedBy === 'string' && input.countedBy.trim()
          ? input.countedBy.trim()
          : null,
      notes:
        typeof input.notes === 'string' && input.notes.trim()
          ? input.notes.trim()
          : null,
    };
    report.variance.amount = varianceAmount;
    report.variance.hasVariance = hasVariance;
    report.variance.status = status;

    if (hasVariance) {
      const alertLog = await adminService.appendAdminLog(
        'reconciliation_variance_alert',
        'Reconciliation variance detected.',
        {
          reportId: report.id,
          dateKey: report.dateKey,
          expectedCash: report.expectedCash,
          countedAmount,
          varianceAmount,
        },
      );
      report.variance.alertLogId = alertLog.id;

      await financialLedgerService.append({
        eventType: 'variance_alert',
        amount: varianceAmount,
        referenceId: report.id,
        meta: {
          dateKey: report.dateKey,
          expectedCash: report.expectedCash,
          countedAmount,
        },
      });
    } else {
      report.variance.alertLogId = null;
    }

    await db.write();
    return report;
  }

  exportReportCsv(report: ReconciliationReport): string {
    const rows: string[] = [];
    rows.push('field,value');
    rows.push(`dateKey,${csvEscape(report.dateKey)}`);
    rows.push(`revision,${csvEscape(report.revision)}`);
    rows.push(`generatedAt,${csvEscape(report.generatedAt)}`);
    rows.push(`generatedBy,${csvEscape(report.generatedBy)}`);
    rows.push(`coinIntake,${csvEscape(report.totals.coinIntake)}`);
    rows.push(`settledAmount,${csvEscape(report.totals.settledAmount)}`);
    rows.push(`refundIssued,${csvEscape(report.totals.refundIssued)}`);
    rows.push(`netSettled,${csvEscape(report.totals.netSettled)}`);
    rows.push(`expectedCash,${csvEscape(report.expectedCash)}`);
    rows.push(
      `expectedCashAfterLiabilities,${csvEscape(report.expectedCashAfterLiabilities)}`,
    );
    rows.push(
      `openPendingRefundAmount,${csvEscape(report.liabilities.openPendingRefundAmount)}`,
    );
    rows.push(
      `openOwedChangeAmount,${csvEscape(report.liabilities.openOwedChangeAmount)}`,
    );
    rows.push(
      `physicalCount,${csvEscape(report.physicalCount?.countedAmount ?? '')}`,
    );
    rows.push(`varianceAmount,${csvEscape(report.variance.amount)}`);
    rows.push(`varianceStatus,${csvEscape(report.variance.status)}`);
    rows.push(
      `ledgerFirstHash,${csvEscape(report.ledgerDigest.firstHash ?? '')}`,
    );
    rows.push(
      `ledgerLastHash,${csvEscape(report.ledgerDigest.lastHash ?? '')}`,
    );
    return rows.join('\n');
  }

  exportReportPdf(report: ReconciliationReport): Buffer {
    const lines = [
      `PrintBit Reconciliation Report`,
      `Date: ${report.dateKey}  Revision: ${report.revision}`,
      `Generated: ${report.generatedAt} (${report.generatedBy})`,
      `Timestamp source: ${report.timestampMeta.source} synced=${report.timestampMeta.synced}`,
      `Coin Intake: PHP ${report.totals.coinIntake.toFixed(2)}`,
      `Settled Amount: PHP ${report.totals.settledAmount.toFixed(2)}`,
      `Refund Issued: PHP ${report.totals.refundIssued.toFixed(2)}`,
      `Net Settled: PHP ${report.totals.netSettled.toFixed(2)}`,
      `Expected Cash: PHP ${report.expectedCash.toFixed(2)}`,
      `Expected Cash (after liabilities): PHP ${report.expectedCashAfterLiabilities.toFixed(2)}`,
      `Physical Count: ${report.physicalCount ? `PHP ${report.physicalCount.countedAmount.toFixed(2)}` : 'Not submitted'}`,
      `Variance: PHP ${report.variance.amount.toFixed(2)} (${report.variance.status})`,
      `Ledger entries: ${report.ledgerDigest.entryCount}`,
      `Ledger first hash: ${report.ledgerDigest.firstHash ?? 'n/a'}`,
      `Ledger last hash: ${report.ledgerDigest.lastHash ?? 'n/a'}`,
    ];
    return buildSimplePdf(lines);
  }
}

export const reconciliationService = new ReconciliationService();

let autoRunTimer: NodeJS.Timeout | null = null;

function computeNextAutoRunDelayMs(now: Date): number {
  const hour = Math.max(
    0,
    Math.min(23, Math.floor(readNumber(db.data!.reconciliationSettings.cutoffHourLocal))),
  );
  const minute = Math.max(
    0,
    Math.min(
      59,
      Math.floor(readNumber(db.data!.reconciliationSettings.cutoffMinuteLocal)),
    ),
  );

  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return Math.max(1000, next.getTime() - now.getTime());
}

async function runAutoReconciliationIfNeeded(now: Date): Promise<void> {
  if (!db.data!.reconciliationSettings.autoGenerateEnabled) return;
  const target = new Date(now);
  target.setDate(target.getDate() - 1);
  const dateKey = toDateKey(target);
  if (db.data!.reconciliationSettings.lastAutoRunDateKey === dateKey) return;

  await reconciliationService.runDailyReport({
    dateKey,
    generatedBy: 'auto',
  });
}

function scheduleNextAutoRun(): void {
  if (autoRunTimer) {
    clearTimeout(autoRunTimer);
    autoRunTimer = null;
  }
  const delay = computeNextAutoRunDelayMs(new Date());
  autoRunTimer = setTimeout(() => {
    void runAutoReconciliationIfNeeded(new Date())
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'Unknown auto-run error.';
        void adminService.appendAdminLog(
          'reconciliation_auto_run_failed',
          'Automatic reconciliation run failed.',
          { error: message },
        );
      })
      .finally(() => {
        scheduleNextAutoRun();
      });
  }, delay);
}

export function startReconciliationScheduler(): void {
  scheduleNextAutoRun();
}
