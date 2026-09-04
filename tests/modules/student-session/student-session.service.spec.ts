import type { Server as SocketIOServer } from 'socket.io';
import {
  getSqliteDb,
  studentSessionStore,
} from '@/core/database/sqlite-storage';
import { StudentSessionService } from '@/modules/student-session/student-session.service';

const makeService = () => {
  const io = { emit: jest.fn() } as unknown as SocketIOServer;
  const appendAdminLog = jest.fn().mockResolvedValue(undefined);
  return {
    service: new StudentSessionService({
      io,
      store: studentSessionStore,
      adminService: { appendAdminLog },
    }),
    io,
    appendAdminLog,
  };
};

afterEach(() => {
  const db = getSqliteDb();
  db.exec('DELETE FROM student_transaction_attributions;');
  db.exec('DELETE FROM student_kiosk_sessions;');
  db.exec('DELETE FROM student_roster;');
});

test('identifies an active normalized roster ID and emits opaque active state', () => {
  const { service, io } = makeService();
  service.replaceRosterCsv('student_id,active\n1234567,true');

  const result = service.identify('123-4567');

  expect(result).toEqual({ ok: true, sessionId: expect.any(String) });
  if (!result.ok) throw new Error('expected identification to succeed');
  expect(io.emit).toHaveBeenCalledWith('kiosk.session.started', {
    sessionId: result.sessionId,
    status: 'active',
  });
  expect(JSON.stringify((io.emit as unknown as jest.Mock).mock.calls)).not.toContain(
    '123-4567',
  );
});

test('returns the same rejection for malformed and inactive student IDs', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n1234567,false');

  expect(service.identify('not-an-id')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
  expect(service.identify('1234567')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
});

test('rejects a competing active identity claim with KIOSK_IN_USE', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n1234567,true\n7654321,true');

  expect(service.identify('1234567')).toMatchObject({ ok: true });
  expect(service.identify('7654321')).toEqual({
    ok: false,
    code: 'KIOSK_IN_USE',
  });
});

test('rejects ID-shaped end reasons before they can be persisted', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n1234567,true');
  expect(service.identify('1234567')).toMatchObject({ ok: true });

  expect(() => service.endActiveSession('123-4567' as never)).toThrow();
  expect(studentSessionStore.getActiveSession()).not.toBeNull();
  expect(
    getSqliteDb()
      .prepare('SELECT end_reason FROM student_kiosk_sessions WHERE end_reason = ?')
      .get('123-4567'),
  ).toBeUndefined();
});

test('requires the exact roster CSV header and valid active values', () => {
  const { service } = makeService();

  expect(() => service.replaceRosterCsv('active,student_id\ntrue,1234567')).toThrow();
  expect(() => service.replaceRosterCsv('student_id,active\n1234567,enabled')).toThrow();
});

test('rejects duplicate student IDs after normalization', () => {
  const { service } = makeService();

  expect(() =>
    service.replaceRosterCsv('student_id,active\n1234567,true\n123-4567,false'),
  ).toThrow();
});

test('does not partially replace the roster when a later CSV row is invalid', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n7654321,true');

  expect(() =>
    service.replaceRosterCsv('student_id,active\n1234567,true\ninvalid,false'),
  ).toThrow();

  expect(service.identify('7654321')).toMatchObject({ ok: true });
  expect(service.endActiveSession('user_ended')).toMatchObject({ status: 'ended' });
  expect(service.identify('1234567')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
});
