import type { Response } from 'express';
import { FinancialService } from '@/modules/financial/financial.service';

test('exposes the high-quality surcharge with public paper pricing', () => {
  const json = jest.fn();
  const service = new FinancialService({
    io: null as never,
    sessionStore: null as never,
    resolvePublicBaseUrl: null as never,
  });

  service.getPricingConfig(null as never, { json } as unknown as Response);

  expect(json).toHaveBeenCalledWith(
    expect.objectContaining({
      highQualitySurcharge: expect.any(Number),
      paperProfiles: expect.objectContaining({
        a4: expect.objectContaining({
          baseBwPrice: expect.any(Number),
          baseColorPrice: expect.any(Number),
        }),
      }),
    }),
  );
});
