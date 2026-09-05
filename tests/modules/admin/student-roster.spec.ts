import type { Request, Response } from 'express';
import { AdminController } from '@/modules/admin/admin.controller';
import { StudentSessionController } from '@/modules/student-session/student-session.controller';
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
  test('keeps the import route in the canonical student-session controller behind local-admin and PIN middleware', () => {
    const adminController = new AdminController(
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
    expect(
      adminController.router.stack.find(
        (candidate: { route?: { path?: string } }) =>
          candidate.route?.path === '/student-roster/import',
      ),
    ).toBeUndefined();

    const controller = new StudentSessionController({
      identify: jest.fn(),
      getKioskState: jest.fn(),
      endActiveSession: jest.fn(),
      replaceRosterCsv: jest.fn(),
    });
    const layer = controller.router.stack.find(
      (candidate: {
        route?: { path?: string; stack?: Array<{ handle: unknown }> };
      }) =>
        candidate.route?.path === '/api/admin/student-roster/import',
    );

    expect(layer?.route?.stack).toHaveLength(4);
    expect(layer?.route?.stack.map((entry) => entry.handle)).toEqual(
      expect.arrayContaining([requireAdminLocalAccess, requireAdminPin]),
    );
  });

  test('returns only Task 6 UI counts from the canonical upload handler', () => {
    const studentSessionService = {
      replaceRosterCsv: jest
        .fn()
        .mockReturnValue({ rowCount: 3, activeCount: 2, inactiveCount: 1 }),
      identify: jest.fn(),
      getKioskState: jest.fn(),
      endActiveSession: jest.fn(),
    };
    const controller = new StudentSessionController(studentSessionService);
    const res = createResponse();

    (controller as unknown as {
      importRoster(req: Request, res: Response): void;
    }).importRoster(
      {
        file: { buffer: Buffer.from('student_id,active\n234-5678,true') },
      } as Request,
      res,
    );

    expect(res.body).toEqual({
      ok: true,
      acceptedCount: 2,
      disabledCount: 1,
    });
    expect(JSON.stringify(res.body)).not.toContain('234-5678');
  });
});
