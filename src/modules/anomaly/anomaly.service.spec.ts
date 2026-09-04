import type { Request, Response } from 'express';
import { AnomalyService } from './anomaly.service';
import type { AnomalyIncidentEntry } from './anomaly.schema';
import { AdminController } from '@/modules/admin/admin.controller';
import { db } from '@/services/db';

jest.mock('@/modules/admin/admin.service', () => ({
  adminService: {
    appendAdminLog: jest.fn().mockResolvedValue(undefined),
  },
}));

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

function makeIncident(
  id: string,
  status: 'open' | 'acknowledged' | 'resolved',
  overrides: Partial<AnomalyIncidentEntry> = {},
): AnomalyIncidentEntry {
  return {
    id,
    type: 'paper_jam',
    source: 'printer-1',
    category: 'printer',
    severity: 'warning',
    status,
    fingerprint: `fp-${id}`,
    message: `Anomaly incident ${id}`,
    occurrenceCount: 1,
    firstDetectedAt: '2026-09-01T08:00:00.000Z',
    lastDetectedAt: '2026-09-01T08:00:00.000Z',
    createdAt: '2026-09-01T08:00:00.000Z',
    updatedAt: '2026-09-01T08:00:00.000Z',
    acknowledgedAt: status === 'acknowledged' || status === 'resolved' ? '2026-09-01T08:30:00.000Z' : null,
    resolvedAt: status === 'resolved' ? '2026-09-01T09:00:00.000Z' : null,
    lastNotificationAt: null,
    lastNotifiedChannels: [],
    ...overrides,
  };
}

describe('AnomalyService queue view filtering and status updates', () => {
  let service: AnomalyService;
  let openIncident: AnomalyIncidentEntry;
  let ackIncident: AnomalyIncidentEntry;
  let resolvedIncident: AnomalyIncidentEntry;

  beforeEach(() => {
    jest.clearAllMocks();

    openIncident = makeIncident('inc-open-1', 'open');
    ackIncident = makeIncident('inc-ack-2', 'acknowledged');
    resolvedIncident = makeIncident('inc-resolved-3', 'resolved');

    db.data = {
      anomalyIncidents: [openIncident, ackIncident, resolvedIncident],
      settings: {
        alerts: {
          severityThreshold: 'warning',
          dashboard: { enabled: true },
          email: { enabled: false },
          dedupe: {},
        },
      },
    } as any;
    db.write = jest.fn().mockResolvedValue(undefined);

    service = new AnomalyService();
  });

  it('1. no view returns all items (backward compatibility)', () => {
    const result = service.listIncidents();
    expect(result.total).toBe(3);
    expect(result.items.map((i) => i.id)).toEqual(
      expect.arrayContaining(['inc-open-1', 'inc-ack-2', 'inc-resolved-3']),
    );
  });

  it('explicit view=all returns all items', () => {
    const result = service.listIncidents({ view: 'all' });
    expect(result.total).toBe(3);
    expect(result.items.map((i) => i.id)).toEqual(
      expect.arrayContaining(['inc-open-1', 'inc-ack-2', 'inc-resolved-3']),
    );
  });

  it('2. view=active excludes only resolved items (retains open and acknowledged)', () => {
    const result = service.listIncidents({ view: 'active' });
    expect(result.total).toBe(2);
    const ids = result.items.map((i) => i.id);
    expect(ids).toContain('inc-open-1');
    expect(ids).toContain('inc-ack-2');
    expect(ids).not.toContain('inc-resolved-3');
  });

  it('3. view=archived returns only resolved items', () => {
    const result = service.listIncidents({ view: 'archived' });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe('inc-resolved-3');
    expect(result.items[0].status).toBe('resolved');
  });

  it('4. resolving changes the result from Active to Archived', async () => {
    // Before: inc-open-1 is active
    let activeResult = service.listIncidents({ view: 'active' });
    expect(activeResult.items.map((i) => i.id)).toContain('inc-open-1');

    // Resolve inc-open-1
    const updated = await service.updateIncidentStatus('inc-open-1', 'resolved');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('resolved');
    expect(updated?.resolvedAt).toBeTruthy();

    // After: inc-open-1 is no longer in active
    activeResult = service.listIncidents({ view: 'active' });
    expect(activeResult.items.map((i) => i.id)).not.toContain('inc-open-1');

    // After: inc-open-1 is now in archived
    const archivedResult = service.listIncidents({ view: 'archived' });
    expect(archivedResult.items.map((i) => i.id)).toContain('inc-open-1');
  });

  it('5. reopening reverses that move (returns from Archived to Active)', async () => {
    // Before: inc-resolved-3 is archived
    let archivedResult = service.listIncidents({ view: 'archived' });
    expect(archivedResult.items.map((i) => i.id)).toContain('inc-resolved-3');

    // Reopen inc-resolved-3
    const updated = await service.updateIncidentStatus('inc-resolved-3', 'open');
    expect(updated).not.toBeNull();
    expect(updated?.status).toBe('open');
    expect(updated?.resolvedAt).toBeNull();

    // After: inc-resolved-3 is now in active
    const activeResult = service.listIncidents({ view: 'active' });
    expect(activeResult.items.map((i) => i.id)).toContain('inc-resolved-3');

    // After: inc-resolved-3 is no longer in archived
    archivedResult = service.listIncidents({ view: 'archived' });
    expect(archivedResult.items.map((i) => i.id)).not.toContain('inc-resolved-3');
  });
});

describe('AdminController handleGetAnomalyIncidents view parameter validation', () => {
  let controller: AdminController;

  beforeEach(() => {
    controller = new AdminController(
      { appendAdminLog: jest.fn() } as any,
      {} as any,
      {} as any,
    );
  });

  it('rejects unknown view query parameter with 400', () => {
    const req = {
      query: { view: 'unknown-view' },
    } as unknown as Request;
    const res = createMockResponse();

    (controller as any).handleGetAnomalyIncidents(req, res as unknown as Response);

    expect(res.statusCode).toBe(400);
    expect(res._sent).toEqual({ error: 'view must be active, archived, or all.' });
  });

  it('accepts valid view values', () => {
    for (const view of ['active', 'archived', 'all']) {
      const req = {
        query: { view },
      } as unknown as Request;
      const res = createMockResponse();

      (controller as any).handleGetAnomalyIncidents(req, res as unknown as Response);

      expect(res.statusCode).toBe(200);
      expect(res._sent).toHaveProperty('items');
    }
  });
});
