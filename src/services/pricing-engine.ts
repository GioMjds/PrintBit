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
  nearBlankBwMax: number;
  pricing: {
    baseBwPrice: number;
    baseColorPrice: number;
    colorMultiplier: number;
    decileSurcharges?: number[];
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
  suggestSavings?: boolean;
}

export interface JobPricingBreakdown {
  pages: PagePricingBreakdown[];
  pricingMode: 'legacy' | 'shadow' | 'live';
  subtotalExact: number;
  discountExact: number;
  finalExact: number;
  finalPayablePeso: number;
}

const DEFAULT_NEAR_BLANK_BW_COVERAGE_MAX = 0.08;

function normalizeNearBlankClassification(
  classification: PageClassification,
  coverage: number,
  nearBlankBwMax: number,
  explicitBlank: boolean,
  contentCoverage?: number,
): PageClassification {
  if (explicitBlank) return 'blank';

  if (classification !== 'bw') return classification;

  // `coverage` is color coverage. For B/W pages this is often exactly 0 even
  // when black text is clearly present, so do not use color coverage alone to
  // waive the page. Only apply the near-blank policy when the analyzer provides
  // an explicit all-content coverage signal, or when the legacy coverage is
  // non-zero.
  const bwCoverageForBlankPolicy =
    typeof contentCoverage === 'number' && Number.isFinite(contentCoverage)
      ? contentCoverage
      : coverage > 0
        ? coverage
        : undefined;

  if (
    bwCoverageForBlankPolicy !== undefined &&
    bwCoverageForBlankPolicy <= nearBlankBwMax
  ) {
    return 'blank';
  }

  return classification;
}

interface ExtractedPageSignals {
  coverage: number;
  contentCoverage?: number;
  hasMeasuredCoverage: boolean;
  isBlank: boolean;
  hasExplicitBlankSignal: boolean;
  classification?: PageClassification;
  contentCoverage?: number;
}

/**
 * Extracts the coverage ratio for a specific page index from the `DocumentAnalysis` object.
 * It ensures the return value is normalized between 0.0 and 1.0.
 * @param analysis: DocumentAnalysis - The result of the document scan/analysis
 * @param pageIndex: number - The zero-based index of the page to query
 * @returns number - A float representing the coverage ratio (0.0 for blank, up to 1.0 for full color)
 */
function extractPageSignals(
  analysis: DocumentAnalysis,
  pageIndex: number,
): ExtractedPageSignals {
  if (!Array.isArray(analysis.pages)) {
    return {
      coverage: 0,
      hasMeasuredCoverage: false,
      isBlank: true,
      hasExplicitBlankSignal: false,
    };
  }
  const page = analysis.pages.find((p) => p.index === pageIndex);
  if (!page) {
    return {
      coverage: 0,
      hasMeasuredCoverage: false,
      isBlank: true,
      hasExplicitBlankSignal: false,
    };
  }

  const rawCoverage = page.coverage;
  const hasCoverage =
    typeof rawCoverage === 'number' && Number.isFinite(rawCoverage);
  const coverage = hasCoverage
    ? Math.max(0, Math.min(1, rawCoverage))
    : page.isColor
      ? 1
      : 0;

  const classification =
    page.classification === 'blank' ||
    page.classification === 'bw' ||
    page.classification === 'partial' ||
    page.classification === 'full_color'
      ? page.classification
      : undefined;

  const hasExplicitBlankSignal = typeof page.isBlank === 'boolean';
  const isBlank = hasExplicitBlankSignal
    ? page.isBlank === true
    : classification === 'blank';

  const rawContentCoverage = page.contentCoverage;
  const contentCoverage =
    typeof rawContentCoverage === 'number' &&
    Number.isFinite(rawContentCoverage)
      ? Math.max(0, Math.min(1, rawContentCoverage))
      : undefined;

  return {
    coverage,
    contentCoverage,
    hasMeasuredCoverage: hasCoverage,
    isBlank,
    hasExplicitBlankSignal,
    classification,
    contentCoverage,
  };
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
  if (isBlank) return 'blank';
  if (coverage <= thresholds.bwMax) return 'bw';
  if (coverage >= thresholds.fullColorMin) return 'full_color';
  return 'partial';
}

/**
 * Calculates the raw price of a single page before any job-level discounts. It implements "Partial Color" logic, where the price scales proportionally with coverage:
 * `rawPrice = baseBwPrice + (coverage * colorMultiplier)`
 * Or using decile tiers if configured.
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
  const { baseBwPrice, baseColorPrice, colorMultiplier, decileSurcharges } =
    config.pricing;
  const { blankPagePolicy } = config;

  if (classification === 'blank') {
    return blankPagePolicy === 'charge_zero' ? 0 : baseBwPrice;
  } else if (classification === 'bw') {
    return baseBwPrice;
  } else if (classification === 'full_color') {
    return baseColorPrice;
  } else if (classification === 'partial') {
    // If decile tiers are configured, use them
    if (Array.isArray(decileSurcharges) && decileSurcharges.length === 10) {
      const decileIndex = Math.min(9, Math.floor(coverage * 10));
      const multiplier = decileSurcharges[decileIndex] ?? 1.0;
      const colorSurcharge = baseColorPrice - baseBwPrice;
      const rawPrice = baseBwPrice + colorSurcharge * multiplier;
      return Math.min(rawPrice, baseColorPrice);
    }

    // Fallback to legacy linear model
    const rawPrice = baseBwPrice + coverage * colorMultiplier;
    return Math.min(rawPrice, baseColorPrice);
  }

  return baseBwPrice;
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
 * @param paperSize: 'A4' | 'Letter' | 'Legal' - The requested paper size to determine base prices
 * @returns RuntimePricingConfig - The active configuration for the pricing engine, ready to be used in calculations
 */
function loadPricingEngineConfig(
  paperSize: 'A4' | 'Letter' | 'Legal' = 'A4',
): RuntimePricingConfig {
  const cfg = db.data?.settings?.pricingEngine as
    | PricingEngineSettings
    | undefined;

  const thresholds = cfg?.thresholds ?? { bwMax: 0.1, fullColorMin: 0.5 };

  // Determine which profile to use. A4 = a4; Letter = shortBond; Legal = longBond.
  const profileKey =
    paperSize === 'Legal' ? 'longBond' : paperSize === 'Letter' ? 'shortBond' : 'a4';
  const profile = cfg?.paperProfiles?.[profileKey] ?? {
    baseBwPrice: profileKey === 'longBond' ? 4 : 3,
    baseColorPrice: profileKey === 'longBond' ? 20 : 18,
  };

  return {
    pricingMode: 'live',
    thresholds: {
      bwMax: thresholds.bwMax,
      fullColorMin: thresholds.fullColorMin,
    },
    nearBlankBwMax: cfg?.nearBlankBwMax ?? DEFAULT_NEAR_BLANK_BW_COVERAGE_MAX,
    pricing: {
      baseBwPrice: profile.baseBwPrice,
      baseColorPrice: profile.baseColorPrice,
      colorMultiplier: cfg?.colorMultiplier ?? 20,
      decileSurcharges: cfg?.decileSurcharges,
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
 * @param input.paperSize: Optional paper size override
 * @param input.colorMode: Optional color mode override (if 'grayscale', all colored pages are forced to BW price)
 */
export function computeJobPricing(input: {
  analysis: DocumentAnalysis;
  selectedPageIndices: Set<number>;
  copies: number;
  paperSize?: 'A4' | 'Letter' | 'Legal';
  colorMode?: ColorMode;
}): JobPricingBreakdown {
  const config = loadPricingEngineConfig(input.paperSize);
  const pages: PagePricingBreakdown[] = [];

  let subtotalExact = 0;
  let totalBillablePages = 0;

  // Process selected pages
  for (const pageIndex of input.selectedPageIndices) {
    const pageSignals = extractPageSignals(input.analysis, pageIndex);
    const coverage = pageSignals.coverage;
    const coverageClassification = classifyPageCoverage(
      coverage,
      pageSignals.isBlank,
      config.thresholds,
    );
    const analysisHintClassification = pageSignals.isBlank
      ? 'blank'
      : pageSignals.classification === 'blank'
        ? undefined
        : pageSignals.classification;
    const derivedClassification = pageSignals.hasMeasuredCoverage
      ? coverageClassification
      : (analysisHintClassification ?? coverageClassification);
    let classification = pageSignals.hasExplicitBlankSignal
      ? derivedClassification
      : normalizeNearBlankClassification(
          derivedClassification,
          coverage,
          config.nearBlankBwMax,
          false,
          pageSignals.contentCoverage,
        );

    // If user requested grayscale, force all non-blank pages to 'bw'
    if (input.colorMode === 'grayscale' && classification !== 'blank') {
      classification = 'bw';
    }

    const rawPrice = computePagePrice(classification, coverage, config);

    // Smart Suggestions: If coverage is just slightly above a decile boundary, suggest saving.
    let suggestSavings = false;
    const engineSettings = db.data?.settings?.pricingEngine as
      | PricingEngineSettings
      | undefined;
    const suggestionThreshold = engineSettings?.suggestionThreshold ?? 0.02;

    if (
      classification === 'partial' &&
      Array.isArray(config.pricing.decileSurcharges) &&
      config.pricing.decileSurcharges.length === 10
    ) {
      const decileIndex = Math.floor(coverage * 10);
      const tierBottom = decileIndex / 10;
      if (
        coverage > tierBottom &&
        coverage <= tierBottom + suggestionThreshold
      ) {
        suggestSavings = true;
      }
    }

    pages.push({
      index: pageIndex,
      coverage,
      classification,
      rawPriceExact: rawPrice,
      isBlank: classification === 'blank',
      suggestSavings,
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
