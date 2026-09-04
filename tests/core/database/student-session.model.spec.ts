import {
  getSqliteDb,
  studentSessionStore,
} from '../../../src/core/database/sqlite-storage';

const hmac = (suffix: string) => `hmac-${suffix}-${Date.now()}-${Math.random()}`;

afterEach(() => {
  const db = getSqliteDb();
  db.exec('DELETE FROM student_transaction_attributions;');
  db.exec('DELETE FROM student_kiosk_sessions;');
  db.exec('DELETE FROM student_roster;');
});

test('atomically replaces the active roster and finds only active entries', () => {
  const first = hmac('first');
  const second = hmac('second');

  studentSessionStore.replaceRoster([
    { studentIdHmac: first, importedAt: '2026-09-03T10:00:00.000Z' },
    { studentIdHmac: second, importedAt: '2026-09-03T10:00:00.000Z' },
  ]);
  studentSessionStore.replaceRoster([
    { studentIdHmac: second, importedAt: '2026-09-03T11:00:00.000Z' },
  ]);

  expect(studentSessionStore.findActiveRosterEntry(first)).toBeNull();
  expect(studentSessionStore.findActiveRosterEntry(second)).toEqual({
    studentIdHmac: second,
    active: true,
    importedAt: '2026-09-03T11:00:00.000Z',
  });
});

test('allows exactly one active kiosk session and ends it explicitly', () => {
  const studentIdHmac = hmac('session');
  studentSessionStore.replaceRoster([{ studentIdHmac }]);

  const claimed = studentSessionStore.claimSession({
    id: 'session-1',
    studentIdHmac,
    startedAt: '2026-09-03T10:00:00.000Z',
  });
  const conflict = studentSessionStore.claimSession({
    id: 'session-2',
    studentIdHmac,
    startedAt: '2026-09-03T10:01:00.000Z',
  });

  expect(claimed).toMatchObject({ ok: true, session: { id: 'session-1' } });
  expect(conflict).toEqual({ ok: false, reason: 'session-active' });
  expect(studentSessionStore.endSession('session-1', 'manual')).toEqual({
    id: 'session-1',
    studentIdHmac,
    status: 'ended',
    startedAt: '2026-09-03T10:00:00.000Z',
    endedAt: expect.any(String),
    endReason: 'manual',
  });
  expect(studentSessionStore.getActiveSession()).toBeNull();
});

test('ends all active sessions at startup', () => {
  const studentIdHmac = hmac('startup');
  studentSessionStore.replaceRoster([{ studentIdHmac }]);
  studentSessionStore.claimSession({ id: 'session-1', studentIdHmac });

  expect(studentSessionStore.endAllActiveSessions('startup')).toBe(1);
  expect(studentSessionStore.getActiveSession()).toBeNull();
});

test('rejects a second active kiosk session at the SQLite schema boundary', () => {
  const studentIdHmac = hmac('schema-constraint');
  studentSessionStore.replaceRoster([{ studentIdHmac }]);
  studentSessionStore.claimSession({ id: 'session-1', studentIdHmac });

  expect(() =>
    getSqliteDb()
      .prepare(
        `INSERT INTO student_kiosk_sessions (
          id, student_id_hmac, status, started_at, ended_at, end_reason
        ) VALUES (?, ?, 'active', ?, NULL, NULL)`,
      )
      .run('session-2', studentIdHmac, '2026-09-03T10:00:00.000Z'),
  ).toThrow();
});

test('keeps the first transaction attribution immutable', () => {
  const studentIdHmac = hmac('attribution');
  studentSessionStore.replaceRoster([{ studentIdHmac }]);
  studentSessionStore.claimSession({ id: 'session-1', studentIdHmac });

  const initial = studentSessionStore.attributeTransaction({
    transactionId: 'transaction-1',
    kioskSessionId: 'session-1',
    studentIdHmac,
    operation: 'print',
    attributedAt: '2026-09-03T10:00:00.000Z',
  });
  const repeated = studentSessionStore.attributeTransaction({
    transactionId: 'transaction-1',
    kioskSessionId: 'session-other',
    studentIdHmac: hmac('other'),
    operation: 'copy',
    attributedAt: '2026-09-03T11:00:00.000Z',
  });

  expect(initial).toEqual({
    transactionId: 'transaction-1',
    kioskSessionId: 'session-1',
    studentIdHmac,
    operation: 'print',
    attributedAt: '2026-09-03T10:00:00.000Z',
  });
  expect(repeated).toEqual(initial);
});
