import type { Server as SocketIOServer } from 'socket.io';
import {
  adminLogStore,
  getSqliteDb,
  studentSessionStore,
} from '@/core/database/sqlite-storage';
import { StudentSessionService } from '@/modules/student-session/student-session.service';

const makeService = () => {
  const io = { emit: jest.fn() } as unknown as SocketIOServer;
  return {
    service: new StudentSessionService({
      io,
      store: studentSessionStore,
    }),
    io,
  };
};

afterEach(() => {
  const db = getSqliteDb();
  db.exec('DELETE FROM admin_logs;');
  db.exec('DELETE FROM student_transaction_attributions;');
  db.exec('DELETE FROM student_kiosk_sessions;');
  db.exec('DELETE FROM student_roster;');
});

test('identifies an active normalized roster ID and emits opaque active state', () => {
  const { service, io } = makeService();
  service.replaceRosterCsv('student_id,active\n2345678,true');

  const result = service.identify('234-5678');

  expect(result).toEqual({ ok: true, sessionId: expect.any(String) });
  if (!result.ok) throw new Error('expected identification to succeed');
  expect(io.emit).toHaveBeenCalledWith('kiosk.session.started', {
    sessionId: result.sessionId,
    status: 'active',
  });
  expect(JSON.stringify((io.emit as unknown as jest.Mock).mock.calls)).not.toContain(
    '234-5678',
  );
});

test('returns the same rejection for malformed and inactive student IDs', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n2345678,false');

  expect(service.identify('not-an-id')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
  expect(service.identify('2345678')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
  expect(service.identify('1345678')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
});

test('rejects a competing active identity claim with KIOSK_IN_USE', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n2345678,true\n2765432,true');

  expect(service.identify('2345678')).toMatchObject({ ok: true });
  expect(service.identify('2765432')).toEqual({
    ok: false,
    code: 'KIOSK_IN_USE',
  });
});

test('rejects ID-shaped end reasons before they can be persisted', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n2345678,true');
  expect(service.identify('2345678')).toMatchObject({ ok: true });

  expect(() => service.endActiveSession('234-5678' as never)).toThrow();
  expect(studentSessionStore.getActiveSession()).not.toBeNull();
  expect(
    getSqliteDb()
      .prepare('SELECT end_reason FROM student_kiosk_sessions WHERE end_reason = ?')
      .get('234-5678'),
  ).toBeUndefined();
});

test('persists idle timeout and emits the same opaque ended state as explicit end', () => {
  const { service, io } = makeService();
  service.replaceRosterCsv('student_id,active\n2345678,true');
  expect(service.identify('2345678')).toMatchObject({ ok: true });
  (io.emit as unknown as jest.Mock).mockClear();

  const idleEnded = service.endActiveSession('idle_timeout');
  const idleRow = getSqliteDb()
    .prepare('SELECT end_reason FROM student_kiosk_sessions WHERE id = ?')
    .get('sessionId' in idleEnded ? idleEnded.sessionId : '') as
    | { end_reason: string }
    | undefined;

  expect(idleRow?.end_reason).toBe('idle_timeout');
  expect(io.emit).toHaveBeenCalledWith('kiosk.session.ended', idleEnded);

  expect(service.identify('2345678')).toMatchObject({ ok: true });
  const explicitEnded = service.endActiveSession('user_ended');
  const explicitRow = getSqliteDb()
    .prepare('SELECT end_reason FROM student_kiosk_sessions WHERE id = ?')
    .get('sessionId' in explicitEnded ? explicitEnded.sessionId : '') as
    | { end_reason: string }
    | undefined;

  expect(explicitRow?.end_reason).toBe('user_ended');
});

test('requires the exact roster CSV header and valid active values', () => {
  const { service } = makeService();

  expect(() => service.replaceRosterCsv('active,student_id\ntrue,2345678')).toThrow();
  expect(() => service.replaceRosterCsv('student_id,active\n2345678,enabled')).toThrow();
});

test('rejects duplicate student IDs after normalization', () => {
  const { service } = makeService();

  expect(() =>
    service.replaceRosterCsv('student_id,active\n2345678,true\n234-5678,false'),
  ).toThrow();
});

test('records roster audit metadata as counts without student identifiers or HMACs', () => {
  const { service } = makeService();
  const result = service.replaceRosterCsv(
    'student_id,active\n2345678,true\n2765432,false',
  );

  const audit = adminLogStore.listByTypes(['student_roster_replaced']);
  expect(audit).toHaveLength(1);
  expect(audit[0]?.meta).toEqual({
    rowCount: result.rowCount,
    activeCount: result.activeCount,
    inactiveCount: result.inactiveCount,
  });
  expect(JSON.stringify(audit[0]?.meta)).not.toContain('2345678');
  expect(JSON.stringify(audit[0]?.meta)).not.toMatch(/hmac/i);
});

test('does not partially replace the roster when a later CSV row is invalid', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n2765432,true');

  expect(() =>
    service.replaceRosterCsv('student_id,active\n2345678,true\ninvalid,false'),
  ).toThrow();

  expect(service.identify('2765432')).toMatchObject({ ok: true });
  expect(service.endActiveSession('user_ended')).toMatchObject({ status: 'ended' });
  expect(service.identify('2345678')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
});

test('rolls back a roster replacement when its audit insert fails', () => {
  const { service } = makeService();
  service.replaceRosterCsv('student_id,active\n2765432,true');

  const auditStore = adminLogStore as unknown as {
    appendInCurrentTransaction?: (...args: unknown[]) => void;
  };
  expect(typeof auditStore.appendInCurrentTransaction).toBe('function');
  if (!auditStore.appendInCurrentTransaction) return;
  const appendAudit = jest
    .spyOn(auditStore, 'appendInCurrentTransaction')
    .mockImplementation(() => {
      throw new Error('audit unavailable');
    });

  expect(() =>
    service.replaceRosterCsv('student_id,active\n2345678,true'),
  ).toThrow('audit unavailable');
  appendAudit.mockRestore();

  expect(service.identify('2765432')).toMatchObject({ ok: true });
  expect(service.endActiveSession('user_ended')).toMatchObject({ status: 'ended' });
  expect(service.identify('2345678')).toEqual({
    ok: false,
    code: 'IDENTIFICATION_FAILED',
  });
});
