import { db } from '@/services/db';
import {
  consumablesStore,
  type ConsumableInkSnapshotEntry,
  type ConsumableInkSnapshotSupply,
  type ConsumableUsageEventEntry,
} from '@/core/database/sqlite-storage';

const DAY_MS = 24 * 60 * 60 * 1000;

export type ConsumableForecastStatus =
  | 'ok'
  | 'insufficient_data'
  | 'telemetry_unavailable';

export type ForecastConfidence = 'high' | 'medium' | 'low';

export interface PaperConsumableForecast {
  status: ConsumableForecastStatus;
  confidence: ForecastConfidence;
  currentSheets: number;
  trayCapacitySheets: number;
  avgDailyUse: number;
  daysRemaining: number | null;
  projectedDepletionDate: string | null;
  sampleDays: number;
}

export interface InkConsumableForecast {
  name: string;
  status: ConsumableForecastStatus;
  confidence: ForecastConfidence;
  level: number | null;
  avgDailyDrop: number;
  daysRemaining: number | null;
  detectionMethod:
    | 'snmp'
    | 'vendor-wmi'
    | 'printer-property'
    | 'error-state'
    | 'none';
  telemetryReason: string | null;
}

export interface ConsumablesForecastResponse {
  generatedAt: string;
  rollingWindowDays: number;
  alertDaysThreshold: number;
  paper: PaperConsumableForecast;
  inkSupplies: InkConsumableForecast[];
  alerts: {
    withinThreshold: boolean;
    reasons: string[];
  };
}

function roundTo(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function toDayKey(timestamp: string): string | null {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function estimatePaperConfidence(
  windowDays: number,
  sampleDays: number,
): ForecastConfidence {
  if (sampleDays >= Math.min(windowDays, 7)) return 'high';
  if (sampleDays >= 3) return 'medium';
  return 'low';
}

function estimateInkConfidence(input: {
  status: ConsumableForecastStatus;
  detectionMethod:
    | 'snmp'
    | 'vendor-wmi'
    | 'printer-property'
    | 'error-state'
    | 'none';
  validIntervals: number;
  usablePoints: number;
}): ForecastConfidence {
  if (input.status === 'telemetry_unavailable') return 'low';
  const methodScore =
    input.detectionMethod === 'snmp'
      ? 2
      : input.detectionMethod === 'vendor-wmi' ||
          input.detectionMethod === 'printer-property'
        ? 1
        : 0;
  const intervalScore = input.validIntervals >= 5 ? 2 : input.validIntervals >= 2 ? 1 : 0;
  const continuityScore = input.usablePoints >= 4 ? 1 : 0;
  const total = methodScore + intervalScore + continuityScore;
  if (total >= 4) return 'high';
  if (total >= 2) return 'medium';
  return 'low';
}

function resolveLatestSupply(
  snapshot: ConsumableInkSnapshotEntry | undefined,
  name: string,
): ConsumableInkSnapshotSupply | null {
  if (!snapshot) return null;
  const candidate = snapshot.supplies.find(
    (entry) => entry.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  return candidate ?? null;
}

export class ConsumablesService {
  getForecast(now = new Date()): ConsumablesForecastResponse {
    const settings = db.data!.settings.consumablesForecasting;
    const rollingWindowDays = Math.max(1, settings.rollingWindowDays);
    const alertDaysThreshold = Math.max(1, settings.alertDaysThreshold);
    const windowStart = new Date(now.getTime() - rollingWindowDays * DAY_MS);
    const windowStartIso = windowStart.toISOString();

    const usageEvents = consumablesStore.listUsageEventsSince(windowStartIso);
    const paper = this.buildPaperForecast({
      now,
      rollingWindowDays,
      usageEvents,
      currentSheets: settings.paperCurrentSheets,
      trayCapacitySheets: settings.paperTrayCapacitySheets,
    });

    const inkSnapshots = consumablesStore
      .listInkSnapshotsSince(windowStartIso)
      .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const inkSupplies = this.buildInkForecasts(inkSnapshots);

    const reasons: string[] = [];
    if (
      paper.status === 'ok' &&
      paper.daysRemaining !== null &&
      paper.daysRemaining <= alertDaysThreshold
    ) {
      reasons.push(
        `Paper is projected to deplete in ${roundTo(paper.daysRemaining, 1)} day(s).`,
      );
    }
    for (const supply of inkSupplies) {
      if (
        supply.status === 'ok' &&
        supply.daysRemaining !== null &&
        supply.daysRemaining <= alertDaysThreshold
      ) {
        reasons.push(
          `${supply.name} is projected to deplete in ${roundTo(supply.daysRemaining, 1)} day(s).`,
        );
      }
    }
    if (inkSupplies.length === 0) {
      reasons.push('No usable ink telemetry snapshots are available yet.');
    }

    return {
      generatedAt: now.toISOString(),
      rollingWindowDays,
      alertDaysThreshold,
      paper,
      inkSupplies,
      alerts: {
        withinThreshold: reasons.some((reason) =>
          reason.includes('projected to deplete'),
        ),
        reasons,
      },
    };
  }

  async applyPaperRefill(input: {
    currentSheets: number;
    trayCapacitySheets?: number;
    updatedAt?: string;
  }): Promise<{
    currentSheets: number;
    trayCapacitySheets: number;
    updatedAt: string;
  }> {
    const nextCapacityRaw =
      input.trayCapacitySheets ?? db.data!.settings.consumablesForecasting.paperTrayCapacitySheets;
    const nextCapacity = Math.max(1, Math.floor(nextCapacityRaw));
    const nextCurrentSheets = Math.max(
      0,
      Math.min(Math.floor(input.currentSheets), nextCapacity),
    );
    const updatedAt = input.updatedAt ?? nowIso();

    db.data!.settings.consumablesForecasting.paperTrayCapacitySheets = nextCapacity;
    db.data!.settings.consumablesForecasting.paperCurrentSheets = nextCurrentSheets;
    db.data!.settings.consumablesForecasting.paperRefillUpdatedAt = updatedAt;
    await db.write();

    return {
      currentSheets: nextCurrentSheets,
      trayCapacitySheets: nextCapacity,
      updatedAt,
    };
  }

  private buildPaperForecast(input: {
    now: Date;
    rollingWindowDays: number;
    usageEvents: ConsumableUsageEventEntry[];
    currentSheets: number;
    trayCapacitySheets: number;
  }): PaperConsumableForecast {
    const byDay = new Map<string, number>();
    for (const event of input.usageEvents) {
      const dayKey = toDayKey(event.timestamp);
      if (!dayKey) continue;
      const previous = byDay.get(dayKey) ?? 0;
      byDay.set(dayKey, previous + Math.max(0, event.estimatedSheetsUsed));
    }

    const totalSheetsUsed = Array.from(byDay.values()).reduce(
      (sum, value) => sum + value,
      0,
    );
    const avgDailyUse =
      input.rollingWindowDays > 0
        ? roundTo(totalSheetsUsed / input.rollingWindowDays, 3)
        : 0;
    const sampleDays = byDay.size;
    const status: ConsumableForecastStatus =
      avgDailyUse > 0 ? 'ok' : 'insufficient_data';
    const confidence = estimatePaperConfidence(input.rollingWindowDays, sampleDays);
    const daysRemaining =
      avgDailyUse > 0 ? roundTo(input.currentSheets / avgDailyUse, 2) : null;
    const projectedDepletionDate =
      daysRemaining !== null
        ? new Date(input.now.getTime() + daysRemaining * DAY_MS).toISOString()
        : null;

    return {
      status,
      confidence,
      currentSheets: input.currentSheets,
      trayCapacitySheets: input.trayCapacitySheets,
      avgDailyUse,
      daysRemaining,
      projectedDepletionDate,
      sampleDays,
    };
  }

  private buildInkForecasts(
    snapshotsAscending: ConsumableInkSnapshotEntry[],
  ): InkConsumableForecast[] {
    if (snapshotsAscending.length === 0) return [];
    const latestSnapshot = snapshotsAscending[snapshotsAscending.length - 1];
    const supplyNames = new Set<string>();
    for (const snapshot of snapshotsAscending) {
      for (const supply of snapshot.supplies) {
        if (supply.name.trim()) supplyNames.add(supply.name.trim());
      }
    }

    const results: InkConsumableForecast[] = [];
    for (const name of supplyNames) {
      const latestSupply = resolveLatestSupply(latestSnapshot, name);
      const points = snapshotsAscending
        .map((snapshot) => {
          const supply = resolveLatestSupply(snapshot, name);
          if (!supply) return null;
          if (supply.level === null) return null;
          if (!snapshot.inkTelemetryAvailable) return null;
          const timestampMs = Date.parse(snapshot.timestamp);
          if (!Number.isFinite(timestampMs)) return null;
          return {
            timestampMs,
            level: supply.level,
          };
        })
        .filter(
          (
            point,
          ): point is {
            timestampMs: number;
            level: number;
          } => point !== null,
        )
        .sort((a, b) => a.timestampMs - b.timestampMs);

      let dropTotal = 0;
      let intervalDaysTotal = 0;
      let validIntervals = 0;
      let previousPoint: { timestampMs: number; level: number } | null = null;
      for (const point of points) {
        if (!previousPoint) {
          previousPoint = point;
          continue;
        }
        const days = (point.timestampMs - previousPoint.timestampMs) / DAY_MS;
        const drop = previousPoint.level - point.level;
        if (days > 0 && drop > 0) {
          dropTotal += drop;
          intervalDaysTotal += days;
          validIntervals += 1;
        }
        previousPoint = point;
      }

      const avgDailyDrop =
        intervalDaysTotal > 0 ? roundTo(dropTotal / intervalDaysTotal, 4) : 0;
      const latestLevel = latestSupply?.level ?? null;
      const status: ConsumableForecastStatus = !latestSnapshot.inkTelemetryAvailable
        ? 'telemetry_unavailable'
        : latestLevel === null || avgDailyDrop <= 0
          ? 'insufficient_data'
          : 'ok';
      const daysRemaining =
        status === 'ok' && latestLevel !== null
          ? roundTo(latestLevel / avgDailyDrop, 2)
          : null;
      const confidence = estimateInkConfidence({
        status,
        detectionMethod: latestSnapshot.inkDetectionMethod,
        validIntervals,
        usablePoints: points.length,
      });

      results.push({
        name,
        status,
        confidence,
        level: latestLevel,
        avgDailyDrop,
        daysRemaining,
        detectionMethod: latestSnapshot.inkDetectionMethod,
        telemetryReason: latestSnapshot.inkTelemetryReason,
      });
    }

    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
