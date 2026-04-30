import type { DocumentAnalysis } from './session';
import type { ColorMode, PricingEngineSettings } from './db';
import { db } from './db';

/**
 * Pricing engine configuration extracted from db.data.settings.pricingEngine
 */
export interface RuntimePricingConfig {
  pricingMode: 'legacy' | 'shadow' | 'live';
  thresholds: {
    bwMax: number;
    fullColorMin: number;
  };
  pricing: {
    baseBwPrice: number;
    baseColorPrice: number;
    colorMultiplier: number;
  };
  blankPagePolicy: 'charge_zero' | 'charge_bw' | 'charge_color';
  bulkTierDiscounts: Array<{
    minPages: number;
    maxPages?: number;
    discountPerPage: number;
  }>;
}

export type PageClassification = 'blank' | 'bw' | 'partial' | 'full_color';

export interface PagePricingBreakdown {
  index: number;
  coverage: number;
  classification: PageClassification;
  rawPriceExact: number;
  isBlank: boolean;
}

export interface JobPricingBreakdown {
  pages: PagePricingBreakdown[];
  pricingMode: 'legacy' | 'shadow' | 'live';
  subtotalExact: number;
  discountExact: number;
  finalExact: number;
  finalPayablePeso: number;
}

/**
 * Computes per-page coverage as a value in [0.0, 1.0] from analysis
 */
function extractPageCoverage(
  analysis: DocumentAnalysis,
  pageIndex: number,
): number {
  if (!Array.isArray(analysis.pages)) return 0;
  const page = analysis.pages.find((p) => p.index === pageIndex);
  if (!page) return 0;
  if (typeof page.coverage === 'number') {
    return Math.max(0, Math.min(1, page.coverage));
  }
  return page.isColor ? 1 : 0;
}

/**
 * Classifies a page based on coverage and configured thresholds
 */
function classifyPageCoverage(
  coverage: number,
  isBlank: boolean,
  thresholds: RuntimePricingConfig['thresholds'],
): PageClassification {
  if (isBlank || coverage === 0) return 'blank';
  if (coverage <= thresholds.bwMax) return 'bw';
  if (coverage >= thresholds.fullColorMin) return 'full_color';
  return 'partial';
}

/**
 * Computes raw page price before bulk discounts
 */
function computePagePrice(
  classification: PageClassification,
  coverage: number,
  config: RuntimePricingConfig,
): number {
  const { baseBwPrice, baseColorPrice, colorMultiplier } = config.pricing;
  const { blankPagePolicy } = config;

  if (classification === 'blank') {
    return blankPagePolicy === 'charge_zero' ? 0 : baseBwPrice;
  }

  if (classification === 'bw') {
    return baseBwPrice;
  }

  if (classification === 'full_color') {
    return baseColorPrice;
  }

  // Partial color: proportional pricing
  const rawPrice = baseBwPrice + coverage * colorMultiplier;
  return Math.min(rawPrice, baseColorPrice);
}

/**
 * Looks up bulk tier discount for the given billable page count
 */
function lookupBulkDiscount(
  totalBillablePages: number,
  tiers: RuntimePricingConfig['bulkTierDiscounts'],
): number {
  // Tiers are sorted descending by minPages; find the first matching tier
  const matchingTier = tiers.find((tier) => {
    const withinRange =
      totalBillablePages >= tier.minPages &&
      (tier.maxPages === undefined || totalBillablePages <= tier.maxPages);
    return withinRange;
  });
  if (!matchingTier) return 0;
  return matchingTier.discountPerPage * totalBillablePages;
}

/**
 * Loads and normalizes pricing engine config from db.data.settings.pricingEngine
 */
function loadPricingEngineConfig(): RuntimePricingConfig {
  const cfg = db.data?.settings?.pricingEngine as
    | PricingEngineSettings
    | undefined;

  const thresholds = cfg?.thresholds ?? { bwMax: 0.1, fullColorMin: 0.5 };
  const shortBond = cfg?.paperProfiles?.shortBond ?? {
    baseBwPrice: 5,
    baseColorPrice: 15,
  };

  return {
    pricingMode: (cfg?.enabledMode ?? 'legacy') as 'legacy' | 'shadow' | 'live',
    thresholds: {
      bwMax: thresholds.bwMax,
      fullColorMin: thresholds.fullColorMin,
    },
    pricing: {
      baseBwPrice: shortBond.baseBwPrice,
      baseColorPrice: shortBond.baseColorPrice,
      colorMultiplier: cfg?.colorMultiplier ?? 20,
    },
    blankPagePolicy:
      (cfg?.blankPagePolicy as 'charge_zero' | 'charge_bw' | 'charge_color') ??
      'charge_zero',
    bulkTierDiscounts: cfg?.bulkDiscountTiers ?? [],
  };
}

/**
 * Computes per-page and job-level pricing breakdown given analysis, copies, and selected pages
 */
export function computeJobPricing(input: {
  analysis: DocumentAnalysis;
  selectedPageIndices: Set<number>;
  copies: number;
}): JobPricingBreakdown {
  const config = loadPricingEngineConfig();
  const pages: PagePricingBreakdown[] = [];

  let subtotalExact = 0;
  let totalBillablePages = 0;

  // Process selected pages
  for (const pageIndex of input.selectedPageIndices) {
    const coverage = extractPageCoverage(input.analysis, pageIndex);
    const isBlank = coverage === 0;
    const classification = classifyPageCoverage(
      coverage,
      isBlank,
      config.thresholds,
    );
    const rawPrice = computePagePrice(classification, coverage, config);

    pages.push({
      index: pageIndex,
      coverage,
      classification,
      rawPriceExact: rawPrice,
      isBlank,
    });

    subtotalExact += rawPrice * input.copies;
    if (classification !== 'blank') {
      totalBillablePages += input.copies;
    }
  }

  // Apply bulk discount
  const discountExact = lookupBulkDiscount(
    totalBillablePages,
    config.bulkTierDiscounts,
  );
  const finalExact = Math.max(0, subtotalExact - discountExact);
  const finalPayablePeso = Math.ceil(finalExact);

  return {
    pages,
    pricingMode: config.pricingMode,
    subtotalExact,
    discountExact,
    finalExact,
    finalPayablePeso,
  };
}

/**
 * Minimal backward-compatible wrapper for legacy quote flow
 * Returns whole-peso amount like the original calculateDocumentAmount
 */
export function legacyComputeJobAmount(input: {
  analysis: DocumentAnalysis;
  selectedPageIndices: Set<number>;
  copies: number;
}): number {
  const breakdown = computeJobPricing(input);
  return breakdown.finalPayablePeso;
}
