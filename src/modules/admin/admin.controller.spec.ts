import type { Request, Response } from 'express';
import { AdminController } from './admin.controller';
import { db } from '@/services/db';

function createMockResponse() {
  const res: any = {
    statusCode: 200,
    _sent: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(data: any) {
      this._sent = data;
      return this;
    },
    send(data: any) {
      this._sent = data;
      return this;
    },
  };
  return res;
}

describe('AdminController pricing settings validation', () => {
  let controller: AdminController;
  let mockAdminService: any;
  let mockConsumablesService: any;
  let mockDeps: any;

  beforeEach(() => {
    jest.clearAllMocks();

    db.data = {
      settings: {
        pricing: {
          printPerPage: 3,
          copyPerPage: 3,
          scanDocument: 5,
          colorSurcharge: 2,
          highQualitySurcharge: 2,
        },
        pricingEngine: {
          paperProfiles: {
            a4: { baseBwPrice: 3, baseColorPrice: 18 },
            shortBond: { baseBwPrice: 3, baseColorPrice: 18 },
            longBond: { baseBwPrice: 4, baseColorPrice: 20 },
          },
          bulkDiscountTiers: [],
          rounding: 'whole_peso_total_only',
          highQualitySurcharge: 2,
        },
        idleTimeoutSeconds: 120,
        idleScreenTimeoutSeconds: 30,
        adminPin: 'dummy-pin',
        adminLocalOnly: true,
        kioskPreferences: { language: 'en', highContrast: false },
        inkMonitoring: {
          enabled: false,
          targetPrinterName: null,
          lowThresholdPercent: 20,
          criticalThresholdPercent: 10,
          blockOnLow: false,
          blockOnEmpty: false,
          telemetryUnknownPolicy: 'warn_allow',
        },
        consumablesForecasting: {
          enabled: false,
          rollingWindowDays: 14,
          alertDaysThreshold: 3,
          paperTrayCapacitySheets: 500,
          paperCurrentSheets: 500,
        },
        consumableEstimation: {
          defaultCoefficients: {},
          printerOverrides: {},
        },
        alerts: {
          severityThreshold: 'warning',
          dashboard: { enabled: true },
          email: {
            enabled: false,
            smtpHost: '',
            smtpPort: 587,
            secure: false,
            username: '',
            from: '',
            to: '',
          },
          dedupe: {},
        },
      },
    } as any;
    db.write = jest.fn().mockResolvedValue(undefined);

    mockAdminService = {
      appendAdminLog: jest.fn().mockResolvedValue(undefined),
    };
    mockConsumablesService = {
      evaluateAndPublishForecastAlerts: jest.fn().mockResolvedValue(undefined),
    };
    mockDeps = {
      io: { emit: jest.fn() },
      uploadDir: 'tmp',
      getSerialStatus: jest.fn(),
      getHopperStatus: jest.fn(),
      runHopperSelfTest: jest.fn(),
    };

    controller = new AdminController(
      mockAdminService,
      mockConsumablesService,
      mockDeps,
    );
  });

  describe('decimals in paper profiles, scan, and highQualitySurcharge are rejected', () => {
    it('rejects decimal in pricingEngine.paperProfiles.a4.baseBwPrice', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              a4: { baseBwPrice: 3.5, baseColorPrice: 18 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.a4.baseBwPrice');
    });

    it('rejects decimal in pricingEngine.paperProfiles.a4.baseColorPrice', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              a4: { baseBwPrice: 3, baseColorPrice: 18.75 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.a4.baseColorPrice');
    });

    it('rejects decimal in pricingEngine.paperProfiles.shortBond.baseBwPrice', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              shortBond: { baseBwPrice: 4.25, baseColorPrice: 18 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.shortBond.baseBwPrice');
    });

    it('rejects decimal in pricingEngine.paperProfiles.shortBond.baseColorPrice', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              shortBond: { baseBwPrice: 4, baseColorPrice: 18.99 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.shortBond.baseColorPrice');
    });

    it('rejects decimal in pricingEngine.paperProfiles.longBond.baseBwPrice', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              longBond: { baseBwPrice: 5.5, baseColorPrice: 20 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.longBond.baseBwPrice');
    });

    it('rejects decimal in pricingEngine.paperProfiles.longBond.baseColorPrice', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              longBond: { baseBwPrice: 5, baseColorPrice: 20.5 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.longBond.baseColorPrice');
    });

    it('rejects decimal in pricing.scanDocument', async () => {
      const req = {
        body: {
          pricing: {
            scanDocument: 5.5,
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('scanDocument');
    });

    it('rejects decimal in pricing.highQualitySurcharge', async () => {
      const req = {
        body: {
          pricing: {
            highQualitySurcharge: 2.25,
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('highQualitySurcharge');
    });

    it('rejects decimal in pricingEngine.highQualitySurcharge', async () => {
      const req = {
        body: {
          pricingEngine: {
            highQualitySurcharge: 2.75,
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('highQualitySurcharge');
    });
  });

  describe('baseColorPrice < baseBwPrice is rejected', () => {
    it('rejects baseColorPrice < baseBwPrice for a4 profile', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              a4: { baseBwPrice: 10, baseColorPrice: 5 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.a4.baseColorPrice');
    });

    it('rejects baseColorPrice < baseBwPrice for shortBond profile', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              shortBond: { baseBwPrice: 8, baseColorPrice: 6 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.shortBond.baseColorPrice');
    });

    it('rejects baseColorPrice < baseBwPrice for longBond profile', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              longBond: { baseBwPrice: 15, baseColorPrice: 12 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(400);
      expect(res._sent.error).toContain('pricingEngine.paperProfiles.longBond.baseColorPrice');
    });
  });

  describe('valid whole-peso values succeed', () => {
    it('accepts valid whole-peso pricing and pricingEngine updates', async () => {
      const req = {
        body: {
          pricing: {
            printPerPage: 4,
            copyPerPage: 4,
            scanDocument: 6,
            colorSurcharge: 15,
            highQualitySurcharge: 3,
          },
          pricingEngine: {
            paperProfiles: {
              a4: { baseBwPrice: 4, baseColorPrice: 19 },
              shortBond: { baseBwPrice: 4, baseColorPrice: 19 },
              longBond: { baseBwPrice: 5, baseColorPrice: 22 },
            },
            highQualitySurcharge: 3,
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(200);
      expect(db.write).toHaveBeenCalled();
      expect(db.data!.settings.pricing.scanDocument).toBe(6);
      expect(db.data!.settings.pricingEngine.paperProfiles.a4.baseBwPrice).toBe(4);
      expect(db.data!.settings.pricingEngine.paperProfiles.a4.baseColorPrice).toBe(19);
      expect(db.data!.settings.pricingEngine.paperProfiles.shortBond.baseBwPrice).toBe(4);
      expect(db.data!.settings.pricingEngine.paperProfiles.shortBond.baseColorPrice).toBe(19);
      expect(db.data!.settings.pricingEngine.paperProfiles.longBond.baseBwPrice).toBe(5);
      expect(db.data!.settings.pricingEngine.paperProfiles.longBond.baseColorPrice).toBe(22);
      expect(db.data!.settings.pricingEngine.highQualitySurcharge).toBe(3);
    });

    it('accepts equal baseBwPrice and baseColorPrice (zero surcharge)', async () => {
      const req = {
        body: {
          pricingEngine: {
            paperProfiles: {
              a4: { baseBwPrice: 5, baseColorPrice: 5 },
            },
          },
        },
      } as unknown as Request;
      const res = createMockResponse();

      await (controller as any).handleUpdateSettings(req, res as unknown as Response);

      expect(res.statusCode).toBe(200);
      expect(db.data!.settings.pricingEngine.paperProfiles.a4.baseBwPrice).toBe(5);
      expect(db.data!.settings.pricingEngine.paperProfiles.a4.baseColorPrice).toBe(5);
    });
  });
});
