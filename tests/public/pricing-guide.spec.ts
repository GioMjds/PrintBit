import {
  formatPricingGuide,
  normalizePricingConfig,
} from '@/public/shared/pricing-guide';

test('renders each paper rate and the high-quality surcharge', () => {
  const pricing = normalizePricingConfig({
    paperProfiles: {
      a4: { baseBwPrice: 3, baseColorPrice: 18 },
      shortBond: { baseBwPrice: 4, baseColorPrice: 19 },
      longBond: { baseBwPrice: 5, baseColorPrice: 21 },
    },
    highQualitySurcharge: 2,
  });

  expect(formatPricingGuide(pricing)).toContain('A4');
  expect(formatPricingGuide(pricing)).toContain('₱3');
  expect(formatPricingGuide(pricing)).toContain('₱21');
  expect(formatPricingGuide(pricing)).toContain('₱2 per page');
});
