import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {
  type AdminLogEntry,
  type ColorMode,
  type LogMeta,
  type PrintMode,
  type PricingSettings,
} from '@/modules/admin/admin.schema';
import { db } from '@/services/db';
import { getTrustedTimestamp } from '@/services/time-source';
import { adminLogStore } from '@/core/database/sqlite-storage';

export type EarningsAnalyticsView = 'daily' | 'weekly' | 'monthly' | 'yearly';
type EarningsMode = 'print' | 'copy' | 'scan';

export interface EarningsAnalyticsBucket {
  key: string;
  label: string;
  start: string;
  end: string;
  amount: number;
}

export interface EarningsAnalyticsResult {
  view: EarningsAnalyticsView;
  anchorDate: string;
  period: {
    start: string;
    end: string;
    label: string;
  };
  totals: {
    today: number;
    week: number;
    month: number;
    year: number;
    allTime: number;
    period: number;
  };
  buckets: EarningsAnalyticsBucket[];
  methods: {
    print: number;
    copy: number;
    scan: number;
    total: number;
    topMode: EarningsMode | null;
  };
}

export interface DispatchLatencyPercentiles {
  p50: number | null;
  p95: number | null;
  sampleCount: number;
}

export interface DispatchLatencyByMime extends DispatchLatencyPercentiles {
  mimeType: string;
}

export interface DispatchLatencyByEngine extends DispatchLatencyPercentiles {
  engine: string;
}

export interface DispatchLatencySpeculation {
  baselinePdfP95: number | null;
  worstNonPdfP95: number | null;
  thresholdPercent: number;
  confirmed: boolean;
}

export interface DispatchLatencyMetricsResult {
  generatedAt: string;
  sampleCount: number;
  byMimeType: DispatchLatencyByMime[];
  byEngine: DispatchLatencyByEngine[];
  speculation: DispatchLatencySpeculation;
}

export class AdminService {
  private readonly MAX_LOGS = 3000;

  private readonly dateShortFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  private readonly monthFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
  });

  private readonly monthYearFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
  });

  getPricingSettings(): PricingSettings {
    return db.data!.settings.pricing;
  }

  calculateJobAmount(
    mode: PrintMode,
    colorOrPageCounts: ColorMode | { colorPages: number; bwPages: number },
    copies: number,
  ): number {
    const safeCopies = Math.max(1, Math.floor(copies));
    const pricing = this.getPricingSettings();

    if (mode === 'scan') {
      return pricing.scanDocument;
    }

    const basePerPage =
      mode === 'print' ? pricing.printPerPage : pricing.copyPerPage;

    if (typeof colorOrPageCounts === 'object' && colorOrPageCounts !== null) {
      const safeColorPages = Math.max(
        0,
        Math.floor(colorOrPageCounts.colorPages),
      );
      const safeBwPages = Math.max(0, Math.floor(colorOrPageCounts.bwPages));

      return (
        (safeColorPages * (basePerPage + pricing.colorSurcharge) +
          safeBwPages * basePerPage) *
        safeCopies
      );
    }

    const color = colorOrPageCounts === 'colored' ? pricing.colorSurcharge : 0;
    return (basePerPage + color) * safeCopies;
  }

  calculateDocumentAmount(
    mode: Exclude<PrintMode, 'scan'>,
    pageCounts: { colorPages: number; bwPages: number },
    copies: number,
  ): number {
    const safeCopies = Math.max(1, Math.floor(copies));
    const safeColorPages = Math.max(0, Math.floor(pageCounts.colorPages));
    const safeBwPages = Math.max(0, Math.floor(pageCounts.bwPages));
    const pricing = this.getPricingSettings();
    const basePerPage =
      mode === 'print' ? pricing.printPerPage : pricing.copyPerPage;

    return (
      (safeColorPages * (basePerPage + pricing.colorSurcharge) +
        safeBwPages * basePerPage) *
      safeCopies
    );
  }

  async appendAdminLog(
    type: string,
    message: string,
    meta?: LogMeta,
  ): Promise<AdminLogEntry> {
    const trusted = getTrustedTimestamp();
    const entry: AdminLogEntry = {
      id: randomUUID(),
      timestamp: trusted.timestamp,
      timestampMeta: trusted.meta,
      type,
      message,
      meta,
    };

    adminLogStore.append(entry, this.MAX_LOGS);
    return entry;
  }

  listLogs(limit: number): AdminLogEntry[] {
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(1000, Math.floor(limit)))
      : 200;
    return adminLogStore.list(safeLimit);
  }

  listAllLogs(): AdminLogEntry[] {
    return adminLogStore.listAll();
  }

  listLogsByTypes(types: ReadonlyArray<string>): AdminLogEntry[] {
    const normalized = Array.from(
      new Set(
        types.map((value) => value.trim()).filter((value) => value.length > 0),
      ),
    );
    if (normalized.length === 0) return [];
    return adminLogStore.listByTypes(normalized);
  }

  clearLogs(): void {
    adminLogStore.clear();
  }

  async incrementCoinStats(coinValue: number): Promise<void> {
    switch (coinValue) {
      case 1:
        db.data!.coinStats.one += 1;
        break;
      case 5:
        db.data!.coinStats.five += 1;
        break;
      case 10:
        db.data!.coinStats.ten += 1;
        break;
      case 20:
        db.data!.coinStats.twenty += 1;
        break;
      default:
        return;
    }

    await db.write();
  }

  async incrementJobStats(mode: PrintMode): Promise<void> {
    db.data!.jobStats.total += 1;
    switch (mode) {
      case 'print':
        db.data!.jobStats.print += 1;
        break;
      case 'copy':
        db.data!.jobStats.copy += 1;
        break;
      case 'scan':
        db.data!.jobStats.scan += 1;
        break;
    }
    await db.write();
  }

  computeEarningsBuckets(now = new Date()) {
    const allTime = db.data!.earnings;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 6);

    let today = 0;
    let week = 0;

    // Use date-bounded query to avoid transferring all payment logs
    const weekTimestamp = startOfWeek.toISOString();
    for (const log of adminLogStore.listByTypesSince(
      ['payment_confirmed'],
      weekTimestamp,
    )) {
      const amountRaw = log.meta?.amount;
      const amount =
        typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const ts = new Date(log.timestamp);
      if (Number.isNaN(ts.getTime())) continue;

      if (ts >= startOfToday) today += amount;
      if (ts >= startOfWeek) week += amount;
    }

    return {
      today: Number(today.toFixed(2)),
      week: Number(week.toFixed(2)),
      allTime: Number(allTime.toFixed(2)),
    };
  }

  private normalizeMoney(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Number(value.toFixed(2));
  }

  private startOfDay(input: Date): Date {
    const value = new Date(input);
    value.setHours(0, 0, 0, 0);
    return value;
  }

  private addDays(input: Date, days: number): Date {
    const value = new Date(input);
    value.setDate(value.getDate() + days);
    return value;
  }

  private toDateKey(input: Date): string {
    const year = input.getFullYear();
    const month = String(input.getMonth() + 1).padStart(2, '0');
    const day = String(input.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private resolveBucketKey(
    view: EarningsAnalyticsView,
    timestamp: Date,
  ): string {
    if (view === 'daily') {
      return String(timestamp.getHours());
    }
    if (view === 'yearly') {
      return String(timestamp.getMonth());
    }
    return this.toDateKey(this.startOfDay(timestamp));
  }

  private buildAnalyticsPeriod(
    view: EarningsAnalyticsView,
    anchorInput: Date,
  ): {
    start: Date;
    end: Date;
    label: string;
    buckets: EarningsAnalyticsBucket[];
  } {
    const anchor = this.startOfDay(anchorInput);

    if (view === 'daily') {
      const start = new Date(anchor);
      const end = this.addDays(start, 1);
      const buckets: EarningsAnalyticsBucket[] = [];
      for (let hour = 0; hour < 24; hour += 1) {
        const bucketStart = new Date(start);
        bucketStart.setHours(hour, 0, 0, 0);
        const bucketEnd = new Date(bucketStart);
        bucketEnd.setHours(hour + 1, 0, 0, 0);
        buckets.push({
          key: String(hour),
          label: `${String(hour).padStart(2, '0')}:00`,
          start: bucketStart.toISOString(),
          end: bucketEnd.toISOString(),
          amount: 0,
        });
      }
      return {
        start,
        end,
        label: this.dateShortFormatter.format(anchor),
        buckets,
      };
    }

    if (view === 'weekly') {
      const start = this.addDays(anchor, -6);
      const end = this.addDays(anchor, 1);
      const buckets: EarningsAnalyticsBucket[] = [];
      for (let day = 0; day < 7; day += 1) {
        const bucketStart = this.addDays(start, day);
        const bucketEnd = this.addDays(start, day + 1);
        buckets.push({
          key: this.toDateKey(bucketStart),
          label: `${new Intl.DateTimeFormat('en-US', { weekday: 'short' }).format(bucketStart)} ${bucketStart.getDate()}`,
          start: bucketStart.toISOString(),
          end: bucketEnd.toISOString(),
          amount: 0,
        });
      }
      return {
        start,
        end,
        label: `${this.dateShortFormatter.format(start)} - ${this.dateShortFormatter.format(this.addDays(end, -1))}`,
        buckets,
      };
    }

    if (view === 'monthly') {
      const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
      const buckets: EarningsAnalyticsBucket[] = [];
      const daysInMonth = new Date(
        start.getFullYear(),
        start.getMonth() + 1,
        0,
      ).getDate();
      for (let day = 1; day <= daysInMonth; day += 1) {
        const bucketStart = new Date(
          start.getFullYear(),
          start.getMonth(),
          day,
        );
        const bucketEnd = new Date(
          start.getFullYear(),
          start.getMonth(),
          day + 1,
        );
        buckets.push({
          key: this.toDateKey(bucketStart),
          label: String(day),
          start: bucketStart.toISOString(),
          end: bucketEnd.toISOString(),
          amount: 0,
        });
      }
      return {
        start,
        end,
        label: this.monthYearFormatter.format(start),
        buckets,
      };
    }

    const start = new Date(anchor.getFullYear(), 0, 1);
    const end = new Date(anchor.getFullYear() + 1, 0, 1);
    const buckets: EarningsAnalyticsBucket[] = [];
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      const bucketStart = new Date(start.getFullYear(), monthIndex, 1);
      const bucketEnd = new Date(start.getFullYear(), monthIndex + 1, 1);
      buckets.push({
        key: String(monthIndex),
        label: this.monthFormatter.format(bucketStart),
        start: bucketStart.toISOString(),
        end: bucketEnd.toISOString(),
        amount: 0,
      });
    }
    return {
      start,
      end,
      label: String(start.getFullYear()),
      buckets,
    };
  }

  computeDetailedEarningsAnalytics(input: {
    view: EarningsAnalyticsView;
    anchor: Date;
    now?: Date;
  }): EarningsAnalyticsResult {
    const now = input.now ?? new Date();
    const startOfToday = this.startOfDay(now);
    const startOfWeek = this.addDays(startOfToday, -6);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);

    const period = this.buildAnalyticsPeriod(input.view, input.anchor);
    const bucketTotals = new Map<string, number>();
    for (const bucket of period.buckets) {
      bucketTotals.set(bucket.key, 0);
    }
    const pendingRefundModes = new Map<string, EarningsMode>();
    for (const refund of db.data!.pendingRefunds) {
      const mode = refund.jobContext.mode;
      if (mode === 'print' || mode === 'copy' || mode === 'scan') {
        pendingRefundModes.set(refund.id, mode);
      }
    }

    let today = 0;
    let week = 0;
    let month = 0;
    let year = 0;
    const methodTotals: Record<EarningsMode, number> = {
      print: 0,
      copy: 0,
      scan: 0,
    };

    for (const entry of db.data!.financialLedger) {
      if (
        entry.eventType !== 'job_completed' &&
        entry.eventType !== 'refund_issued'
      ) {
        continue;
      }

      const amount = Number(entry.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const timestamp = new Date(entry.timestamp);
      if (Number.isNaN(timestamp.getTime())) continue;

      const signedAmount =
        entry.eventType === 'refund_issued' ? -amount : amount;

      if (timestamp >= startOfToday) today += signedAmount;
      if (timestamp >= startOfWeek) week += signedAmount;
      if (timestamp >= startOfMonth) month += signedAmount;
      if (timestamp >= startOfYear) year += signedAmount;

      if (timestamp >= period.start && timestamp < period.end) {
        const bucketKey = this.resolveBucketKey(input.view, timestamp);
        const previous = bucketTotals.get(bucketKey);
        if (previous !== undefined) {
          bucketTotals.set(bucketKey, previous + signedAmount);
        }

        const mode =
          entry.eventType === 'refund_issued'
            ? (entry.meta?.originalMode ??
              entry.meta?.mode ??
              (typeof entry.referenceId === 'string'
                ? pendingRefundModes.get(entry.referenceId)
                : null))
            : entry.meta?.mode;

        if (mode === 'print' || mode === 'copy' || mode === 'scan') {
          methodTotals[mode] += signedAmount;
        }
      }
    }

    const buckets = period.buckets.map((bucket) => ({
      ...bucket,
      amount: this.normalizeMoney(bucketTotals.get(bucket.key) ?? 0),
    }));
    const periodTotal = buckets.reduce((sum, bucket) => sum + bucket.amount, 0);

    const normalizedMethods = {
      print: this.normalizeMoney(methodTotals.print),
      copy: this.normalizeMoney(methodTotals.copy),
      scan: this.normalizeMoney(methodTotals.scan),
    };
    const methodTotal = this.normalizeMoney(
      normalizedMethods.print + normalizedMethods.copy + normalizedMethods.scan,
    );
    const topMode: EarningsMode | null =
      methodTotal <= 0
        ? null
        : (Object.entries(normalizedMethods).sort(
            (a, b) => b[1] - a[1],
          )[0][0] as EarningsMode);

    return {
      view: input.view,
      anchorDate: this.toDateKey(this.startOfDay(input.anchor)),
      period: {
        start: period.start.toISOString(),
        end: period.end.toISOString(),
        label: period.label,
      },
      totals: {
        today: this.normalizeMoney(today),
        week: this.normalizeMoney(week),
        month: this.normalizeMoney(month),
        year: this.normalizeMoney(year),
        allTime: this.normalizeMoney(db.data!.earnings),
        period: this.normalizeMoney(periodTotal),
      },
      buckets,
      methods: {
        print: normalizedMethods.print,
        copy: normalizedMethods.copy,
        scan: normalizedMethods.scan,
        total: methodTotal,
        topMode,
      },
    };
  }

  private computePercentile(
    values: number[],
    percentile: number,
  ): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 1) return sorted[0];
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    const weight = index - lower;
    return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
  }

  private summarizeLatencies(values: number[]): DispatchLatencyPercentiles {
    const p50 = this.computePercentile(values, 50);
    const p95 = this.computePercentile(values, 95);
    return {
      p50: p50 === null ? null : Math.round(p50),
      p95: p95 === null ? null : Math.round(p95),
      sampleCount: values.length,
    };
  }

  computeDispatchLatencyMetrics(maxEvents = 5000): DispatchLatencyMetricsResult {
    const safeMaxEvents = Number.isFinite(maxEvents)
      ? Math.max(100, Math.min(20_000, Math.floor(maxEvents)))
      : 5000;
    const logs = adminLogStore
      .listByTypes([
        'print_dispatch_summary',
        'print_spooler_confirmed',
        'print_spooler_job_failed',
        'print_spooler_auto_refund',
        'print_spooler_monitor_timeout',
        'print_spooler_monitor_unavailable',
      ])
      .slice(0, safeMaxEvents);

    const dispatchByTransaction = new Map<
      string,
      {
        dispatchedAtMs: number;
        mimeType: string;
        engine: string;
      }
    >();
    const terminalByTransaction = new Map<string, number>();

    for (const log of logs) {
      const transactionId =
        typeof log.meta?.transactionId === 'string'
          ? log.meta.transactionId.trim()
          : '';
      if (!transactionId) continue;
      const timestampMs = Date.parse(log.timestamp);
      if (!Number.isFinite(timestampMs)) continue;

      if (log.type === 'print_dispatch_summary') {
        const engine =
          typeof log.meta?.selectedEngine === 'string'
            ? log.meta.selectedEngine
            : null;
        if (!engine) continue;
        const mimeType =
          typeof log.meta?.mimeType === 'string' && log.meta.mimeType.length > 0
            ? log.meta.mimeType
            : 'application/octet-stream';
        const existing = dispatchByTransaction.get(transactionId);
        if (!existing || timestampMs >= existing.dispatchedAtMs) {
          dispatchByTransaction.set(transactionId, {
            dispatchedAtMs: timestampMs,
            mimeType,
            engine,
          });
        }
        continue;
      }

      const existingTerminal = terminalByTransaction.get(transactionId);
      if (!existingTerminal || timestampMs >= existingTerminal) {
        terminalByTransaction.set(transactionId, timestampMs);
      }
    }

    const mimeSamples = new Map<string, number[]>();
    const engineSamples = new Map<string, number[]>();

    for (const [transactionId, dispatchMeta] of dispatchByTransaction.entries()) {
      const terminalAtMs = terminalByTransaction.get(transactionId);
      if (terminalAtMs === undefined || !Number.isFinite(terminalAtMs)) continue;
      const latencyMs = terminalAtMs - dispatchMeta.dispatchedAtMs;
      if (!Number.isFinite(latencyMs) || latencyMs < 0) continue;

      const byMime = mimeSamples.get(dispatchMeta.mimeType) ?? [];
      byMime.push(latencyMs);
      mimeSamples.set(dispatchMeta.mimeType, byMime);

      const byEngine = engineSamples.get(dispatchMeta.engine) ?? [];
      byEngine.push(latencyMs);
      engineSamples.set(dispatchMeta.engine, byEngine);
    }

    const byMimeType = Array.from(mimeSamples.entries())
      .map(([mimeType, values]) => ({
        mimeType,
        ...this.summarizeLatencies(values),
      }))
      .sort((a, b) => b.sampleCount - a.sampleCount);

    const byEngine = Array.from(engineSamples.entries())
      .map(([engine, values]) => ({
        engine,
        ...this.summarizeLatencies(values),
      }))
      .sort((a, b) => b.sampleCount - a.sampleCount);

    const pdfBucket = byMimeType.find(
      (bucket) => bucket.mimeType === 'application/pdf',
    );
    const nonPdfP95Values = byMimeType
      .filter((bucket) => bucket.mimeType !== 'application/pdf')
      .map((bucket) => bucket.p95)
      .filter((value): value is number => value !== null);
    const worstNonPdfP95 =
      nonPdfP95Values.length > 0 ? Math.max(...nonPdfP95Values) : null;
    const thresholdPercent = 30;
    const baselinePdfP95 = pdfBucket?.p95 ?? null;
    const confirmed =
      baselinePdfP95 !== null &&
      worstNonPdfP95 !== null &&
      worstNonPdfP95 >= baselinePdfP95 * (1 + thresholdPercent / 100);

    return {
      generatedAt: new Date().toISOString(),
      sampleCount: Array.from(mimeSamples.values()).reduce(
        (sum, values) => sum + values.length,
        0,
      ),
      byMimeType,
      byEngine,
      speculation: {
        baselinePdfP95,
        worstNonPdfP95,
        thresholdPercent,
        confirmed,
      },
    };
  }

  getStorageUsage(uploadDir: string): { fileCount: number; bytes: number } {
    const dirPath = path.resolve(uploadDir);
    if (!fs.existsSync(dirPath)) {
      return { fileCount: 0, bytes: 0 };
    }

    const items = fs.readdirSync(dirPath, { withFileTypes: true });
    let bytes = 0;
    let fileCount = 0;

    for (const item of items) {
      if (!item.isFile()) continue;
      const fullPath = path.join(dirPath, item.name);
      const stat = fs.statSync(fullPath);
      bytes += stat.size;
      fileCount += 1;
    }

    return { fileCount, bytes };
  }

  logsToCsv(logs: AdminLogEntry[]): string {
    const escapeCsv = (value: unknown): string => {
      const text = value == null ? '' : String(value);
      const escaped = text.replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const header = ['timestamp', 'type', 'message', 'meta'].join(',');
    const rows = logs.map((log) => {
      const metaText = log.meta ? JSON.stringify(log.meta) : '';
      return [
        escapeCsv(log.timestamp),
        escapeCsv(log.type),
        escapeCsv(log.message),
        escapeCsv(metaText),
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }
}

export const adminService = new AdminService();
