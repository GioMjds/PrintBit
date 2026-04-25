import { db } from '@/services/db';
import type { ConsumableEstimationCoefficients } from '@/modules/admin/admin.schema';

function normalizeKey(input: string): string {
  const compact = input.trim().toLowerCase();
  return compact.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function normalizeChannelName(input: string): 'c' | 'm' | 'y' | 'k' | null {
  const normalized = normalizeKey(input);
  if (normalized === 'c' || normalized === 'cyan') return 'c';
  if (normalized === 'm' || normalized === 'magenta') return 'm';
  if (normalized === 'y' || normalized === 'yellow') return 'y';
  if (normalized === 'k' || normalized === 'black') return 'k';
  return null;
}

function resolveCoefficients(
  printerName?: string | null,
): ConsumableEstimationCoefficients {
  const settings = db.data!.settings.consumableEstimation;
  const base = settings.defaultCoefficients;
  if (!printerName) return base;

  const override = settings.printerOverrides[normalizeKey(printerName)];
  if (!override) return base;

  return {
    bwBlack: override.bwBlack ?? base.bwBlack,
    colorCyan: override.colorCyan ?? base.colorCyan,
    colorMagenta: override.colorMagenta ?? base.colorMagenta,
    colorYellow: override.colorYellow ?? base.colorYellow,
    colorBlack: override.colorBlack ?? base.colorBlack,
  };
}

export function estimateInkUsageByJob(input: {
  selectedColorPages: number;
  selectedBwPages: number;
  copies: number;
  printerName?: string | null;
}): Record<string, number> {
  const colorPages = Math.max(0, Math.floor(input.selectedColorPages));
  const bwPages = Math.max(0, Math.floor(input.selectedBwPages));
  const copies = Math.max(1, Math.floor(input.copies));
  const coefficients = resolveCoefficients(input.printerName);

  const totals: Record<'c' | 'm' | 'y' | 'k', number> = {
    c: 0,
    m: 0,
    y: 0,
    k: 0,
  };

  totals.k += bwPages * copies * coefficients.bwBlack;
  totals.c += colorPages * copies * coefficients.colorCyan;
  totals.m += colorPages * copies * coefficients.colorMagenta;
  totals.y += colorPages * copies * coefficients.colorYellow;
  totals.k += colorPages * copies * coefficients.colorBlack;

  return Object.fromEntries(
    Object.entries(totals)
      .map(
        ([key, value]) =>
          [normalizeChannelName(key), Number(value.toFixed(6))] as const,
      )
      .filter(
        (row): row is readonly ['c' | 'm' | 'y' | 'k', number] =>
          row[0] !== null && Number.isFinite(row[1]) && row[1] > 0,
      ),
  );
}
