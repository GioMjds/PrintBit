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
 * Extracts the coverage ratio for a specific page index from the `DocumentAnalysis` object.
 * It ensures the return value is normalized between 0.0 and 1.0.
 * @param analysis: DocumentAnalysis - The result of the document scan/analysis
 * @param pageIndex: number - The zero-based index of the page to query
 * @returns number - A float representing the coverage ratio (0.0 for blank, up to 1.0 for full color)
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
 * Categorizes a page into one of 4 types based on its ink coverage and the system's defined thresholds:
 * @param coverage: number - The normalized coverage value
 * @param isBlank: boolean - Explicit flag indicating if the page contains no content
 * @param thresholds: RuntimePricingConfig['thresholds'] - The `bwMax` and `fullColorMin` limits
 * @returns PageClassification - 'blank' | 'bw' | 'partial' | 'full_color'.
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
 * Calculates the raw price of a single page before any job-level discounts. It implements "Partial Color" logic, where the price scales proportionally with coverage:
 * `rawPrice = baseBwPrice + (coverage * colorMultiplier)`
 * @param classification: PageClassification - The category of the page
 * @param coverage: number - The ink coverage ratio
 * @param config: RuntimePricingConfig - The active pricing rules and base prices
 * @returns number - The calculated price for one copy of the page
 */
function computePagePrice(
  classification: PageClassification,
  coverage: number,
  config: RuntimePricingConfig,
): number {
  const { baseBwPrice, baseColorPrice, colorMultiplier } = config.pricing;
  const { blankPagePolicy } = config;

  switch (classification) {
    case 'blank':
      return blankPagePolicy === 'charge_zero' ? 0 : baseBwPrice;
    case 'bw':
      return baseBwPrice;
    case 'full_color':
      return baseColorPrice;
    case 'partial':
      const rawPrice = baseBwPrice + coverage * colorMultiplier;
      return Math.min(rawPrice, baseColorPrice);
    default:
      return baseBwPrice;
  }
}

/**
 * Searches the configuration for a matching bulk discount tier based on the total number of billable pages in the job.
 * @param totalBillablePages: number - The total count of non-blank pages (multiplied by copies)
 * @param tiers: RuntimePricingConfig['bulkTierDiscounts'] - Array of discount ranges
 * @returns number - The total currency amount to be subtracted from the subtotal
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
 * Retrieves settings from the database and applies default values if specific configurations are missing. It normalizes the data into a RuntimePricingConfig object.
 * @returns RuntimePricingConfig - The active configuration for the pricing engine, ready to be used in calculations
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

// Exported functions

/**
 * The primary logic gate for the pricing engine. It iterates through selected pages, classifies them, calculates individual costs, and aggregates them into a final job breakdown.
 * @param input.analysis: The `DocumentAnalysis` object
 * @param input.selectedPageIndices: A `Set` of indices the user wants to print
 * @param input.copies: The number of sets to be printed
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
