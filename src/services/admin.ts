import { randomUUID } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import {
  type AdminLogEntry,
  type ColorMode,
  type LogMeta,
  type PrintMode,
  type PricingSettings,
} from './db';
import { settingsRepository, stateRepository } from '@/state/repositories';

class AdminService {
  private readonly MAX_LOGS = 3000;

  getPricingSettings(): PricingSettings {
    return settingsRepository.getPricingSettings();
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
    const entry: AdminLogEntry = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type,
      message,
      meta,
    };

    const state = stateRepository.getState();
    state.logs.unshift(entry);
    if (state.logs.length > this.MAX_LOGS) {
      state.logs.length = this.MAX_LOGS;
    }
    await stateRepository.write();
    return entry;
  }

  async incrementCoinStats(coinValue: number): Promise<void> {
    // if (coinValue === 1) db.data!.coinStats.one += 1;
    // else if (coinValue === 5) db.data!.coinStats.five += 1;
    // else if (coinValue === 10) db.data!.coinStats.ten += 1;
    // else if (coinValue === 20) db.data!.coinStats.twenty += 1;
    // else return;
    const state = stateRepository.getState();

    switch (coinValue) {
      case 1:
        state.coinStats.one += 1;
        break;
      case 5:
        state.coinStats.five += 1;
        break;
      case 10:
        state.coinStats.ten += 1;
        break;
      case 20:
        state.coinStats.twenty += 1;
        break;
      default:
        return;
    }

    await stateRepository.write();
  }

  async incrementJobStats(mode: PrintMode): Promise<void> {
    const state = stateRepository.getState();
    state.jobStats.total += 1;
    switch (mode) {
      case 'print':
        state.jobStats.print += 1;
        break;
      case 'copy':
        state.jobStats.copy += 1;
        break;
      case 'scan':
        state.jobStats.scan += 1;
        break;
    }
    await stateRepository.write();
  }

  computeEarningsBuckets(now = new Date()) {
    const state = stateRepository.getState();
    const allTime = state.earnings;
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const startOfWeek = new Date(startOfToday);
    startOfWeek.setDate(startOfWeek.getDate() - 6);

    let today = 0;
    let week = 0;

    for (const log of state.logs) {
      if (log.type !== 'payment_confirmed') continue;
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
