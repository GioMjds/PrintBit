import type { Request, Response } from 'express';
import { AdminController } from '@/modules/admin/admin.controller';
import { AdminService } from '@/modules/admin/admin.service';
import { studentSessionStore } from '@/core/database/models/student-session.model';
import {
  requireAdminLocalAccess,
  requireAdminPin,
} from '@/middleware/admin-auth';

function createResponse(): Response & { body?: unknown; statusCode: number } {
  const response: any = {
    statusCode: 200,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return response as Response & { body?: unknown; statusCode: number };
}

describe('admin student roster import', () => {
  test('registers the import behind local-admin and PIN middleware', () => {
    const controller = new AdminController(
      {} as never,
      {} as never,
      {
        io: { emit: jest.fn() },
        uploadDir: 'tmp',
        getSerialStatus: jest.fn(),
        getHopperStatus: jest.fn(),
        runHopperSelfTest: jest.fn(),
      } as never,
    );
    const layer = controller.router.stack.find(
      (candidate: {
        route?: { path?: string; stack?: Array<{ handle: unknown }> };
      }) =>
        candidate.route?.path === '/student-roster/import',
    );

    expect(layer?.route?.stack).toHaveLength(4);
    expect(layer?.route?.stack.map((entry) => entry.handle)).toEqual(
      expect.arrayContaining([requireAdminLocalAccess, requireAdminPin]),
    );
  });

  test('returns accepted and disabled counts without returning roster values', async () => {
    const service = new AdminService();
    const replaceRoster = service as unknown as {
      replaceStudentRosterCsv?: (
        csv: string,
      ) => Promise<{ acceptedCount: number; disabledCount: number }>;
    };
    const replaceStore = jest
      .spyOn(studentSessionStore, 'replaceRoster')
      .mockImplementation(() => undefined);
    const appendLog = jest
      .spyOn(service, 'appendAdminLog')
      .mockResolvedValue({} as never);

    expect(replaceRoster.replaceStudentRosterCsv).toBeDefined();
    if (!replaceRoster.replaceStudentRosterCsv) return;

    await expect(
      replaceRoster.replaceStudentRosterCsv(
        'student_id,active\n123-4567,true\n765-4321,false',
      ),
    ).resolves.toEqual({ acceptedCount: 1, disabledCount: 1 });
    expect(replaceStore).toHaveBeenCalledWith([
      expect.objectContaining({ studentIdHmac: expect.any(String) }),
    ]);
    expect(appendLog).toHaveBeenCalledWith(
      'student_roster_replaced',
      'Student roster replaced.',
      { acceptedCount: 1, disabledCount: 1 },
    );
    const auditMeta = appendLog.mock.calls[0]?.[2] ?? {};
    expect(JSON.stringify(auditMeta)).not.toContain('123-4567');
    expect(JSON.stringify(auditMeta)).not.toMatch(/hmac/i);
  });

  test('returns only counts from the upload handler', async () => {
    const adminService = {
      replaceStudentRosterCsv: jest
        .fn()
        .mockResolvedValue({ acceptedCount: 2, disabledCount: 1 }),
    };
    const controller = new AdminController(
      adminService as never,
      {} as never,
      {
        io: { emit: jest.fn() },
        uploadDir: 'tmp',
        getSerialStatus: jest.fn(),
        getHopperStatus: jest.fn(),
        runHopperSelfTest: jest.fn(),
      } as never,
    );
    const res = createResponse();

    await (controller as unknown as {
      handleImportStudentRoster(req: Request, res: Response): Promise<void>;
    }).handleImportStudentRoster(
      {
        file: { buffer: Buffer.from('student_id,active\n123-4567,true') },
      } as Request,
      res,
    );

    expect(res.body).toEqual({
      ok: true,
      acceptedCount: 2,
      disabledCount: 1,
    });
    expect(JSON.stringify(res.body)).not.toContain('123-4567');
  });
});
