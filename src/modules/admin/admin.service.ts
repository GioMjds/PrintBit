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

export class AdminService {
  private readonly MAX_LOGS = 3000;

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
      new Set(types.map((value) => value.trim()).filter((value) => value.length > 0)),
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
