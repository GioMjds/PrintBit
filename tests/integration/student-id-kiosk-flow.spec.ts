import http from 'node:http';
import express, { type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import type { Server as SocketIOServer } from 'socket.io';
import {
  getSqliteDb,
  studentSessionStore,
  adminLogStore,
} from '@/core/database/sqlite-storage';
import { StudentSessionService } from '@/modules/student-session/student-session.service';
import { StudentSessionController } from '@/modules/student-session/student-session.controller';
import { registerStudentSessionModule } from '@/modules/student-session/student-session.module';
import { requireStudentSession } from '@/middleware/student-session';
import { createStudentIdLookupHmac } from '@/config';

jest.mock('@/config', () => {
  const actual = jest.requireActual('@/config');
  return {
    ...actual,
    STUDENT_ID_VERIFICATION_ENABLED: true,
  };
});

const TEST_SECRET = 'printbit-student-id-test-secret';
const RAW_STUDENT_ID = '234-5678';
const RAW_STUDENT_ID_DIGITS = '2345678';
const INACTIVE_STUDENT_ID = '234-5679';

describe('Student ID Kiosk Verification Integration Flow', () => {
  let app: express.Express;
  let server: http.Server;
  let baseUrl: string;
  let mockIo: { emit: jest.Mock };
  let service: StudentSessionService;
  let controller: StudentSessionController;

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PRINTBIT_STUDENT_ID_VERIFICATION = 'true';
    process.env.PRINTBIT_STUDENT_ID_HMAC_SECRET = TEST_SECRET;
  });

  afterAll(() => {
    process.env = { ...originalEnv };
  });

  beforeEach(async () => {
    const db = getSqliteDb();
    db.exec('DELETE FROM student_transaction_attributions;');
    db.exec('DELETE FROM student_kiosk_sessions;');
    db.exec('DELETE FROM student_roster;');
    db.exec('DELETE FROM admin_logs;');

    mockIo = { emit: jest.fn() };
    service = new StudentSessionService({
      io: mockIo as unknown as SocketIOServer,
      store: studentSessionStore,
    });
    controller = new StudentSessionController(service);

    app = express();
    app.set('trust proxy', true);
    app.use(cookieParser());
    app.use(express.json());
    app.use(controller.router);

    // Guarded representative customer transaction endpoint
    app.post(
      '/api/test/customer-transaction',
      requireStudentSession(service),
      (req: Request, res: Response) => {
        const txnId = typeof req.body?.txnId === 'string' ? req.body.txnId : 'txn-default';
        service.attributeTransaction(txnId, 'copy');
        res.json({ ok: true, transactionId: txnId });
      },
    );

    server = await new Promise<http.Server>((resolve) => {
      const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not expose TCP address.');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  test('Step 1: complete end-to-end flow with roster import, portal identification, attribution, and session end', async () => {
    // 1. Import a roster containing active and inactive students
    service.replaceRosterCsv(
      `student_id,active\n${RAW_STUDENT_ID},true\n${INACTIVE_STUDENT_ID},false`,
    );

    // 2. Before identification, customer transaction is rejected
    const unauthenticatedRes = await fetch(`${baseUrl}/api/test/customer-transaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txnId: 'txn-001' }),
    });
    expect(unauthenticatedRes.status).toBe(403);
    expect(await unauthenticatedRes.json()).toEqual({
      code: 'STUDENT_IDENTIFICATION_REQUIRED',
    });

    // 3. Inactive student cannot unlock
    const inactiveRes = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: INACTIVE_STUDENT_ID }),
    });
    expect(inactiveRes.status).toBe(400);

    // 4. Hotspot-connected student enters active Student ID
    const identifyRes = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: RAW_STUDENT_ID_DIGITS }),
    });
    expect(identifyRes.status).toBe(200);
    expect(await identifyRes.json()).toEqual({ status: 'active' });

    // 5. Verify Socket.IO event was broadcast
    expect(mockIo.emit).toHaveBeenCalledWith('kiosk.session.started', {
      sessionId: expect.any(String),
      status: 'active',
    });

    // 6. Second student attempting to identify is rejected with kiosk-in-use
    const competingRes = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: RAW_STUDENT_ID }),
    });
    expect(competingRes.status).toBe(409);
    expect(await competingRes.json()).toEqual({
      error: 'The kiosk is currently in use.',
    });

    // 7. Customer work can now proceed and is attributed
    const customerRes = await fetch(`${baseUrl}/api/test/customer-transaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txnId: 'txn-001' }),
    });
    expect(customerRes.status).toBe(200);
    expect(await customerRes.json()).toEqual({ ok: true, transactionId: 'txn-001' });

    // Verify attribution row in SQLite
    const activeSession = studentSessionStore.getActiveSession();
    expect(activeSession).not.toBeNull();
    const db = getSqliteDb();
    const attributionRow = db
      .prepare('SELECT transaction_id, kiosk_session_id, operation FROM student_transaction_attributions WHERE transaction_id = ?')
      .get('txn-001') as { transaction_id: string; kiosk_session_id: string; operation: string };
    expect(attributionRow).toEqual({
      transaction_id: 'txn-001',
      kiosk_session_id: activeSession?.id,
      operation: 'copy',
    });

    // 8. End the session via user_ended
    const endRes = await fetch(`${baseUrl}/api/kiosk/student-session/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'user_ended' }),
    });
    expect(endRes.status).toBe(200);
    expect(await endRes.json()).toMatchObject({ status: 'ended', sessionId: activeSession?.id });
    expect(mockIo.emit).toHaveBeenCalledWith('kiosk.session.ended', {
      sessionId: activeSession?.id,
      status: 'ended',
      verificationEnabled: true,
    });

    // 9. After session end, subsequent customer action is rejected
    const postEndRes = await fetch(`${baseUrl}/api/test/customer-transaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txnId: 'txn-002' }),
    });
    expect(postEndRes.status).toBe(403);
    expect(await postEndRes.json()).toEqual({
      code: 'STUDENT_IDENTIFICATION_REQUIRED',
    });

    // 10. Verify idle_timeout end reason also persists correctly
    const identifyAgain = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: RAW_STUDENT_ID }),
    });
    expect(identifyAgain.status).toBe(200);

    const idleEndRes = await fetch(`${baseUrl}/api/kiosk/student-session/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'idle_timeout' }),
    });
    expect(idleEndRes.status).toBe(200);

    const idleSessionRow = db
      .prepare('SELECT end_reason FROM student_kiosk_sessions ORDER BY started_at DESC LIMIT 1')
      .get() as { end_reason: string };
    expect(idleSessionRow.end_reason).toBe('idle_timeout');
  });

  test('Step 2: restart recovery clears active sessions with server_restart and leaves kiosk locked', () => {
    // Seed an active session into SQLite
    const studentHmac = createStudentIdLookupHmac(RAW_STUDENT_ID);
    if (!studentHmac) throw new Error('HMAC generation failed');
    studentSessionStore.replaceRoster([{ studentIdHmac: studentHmac }]);
    const claim = studentSessionStore.claimSession({
      id: 'session-pre-restart',
      studentIdHmac: studentHmac,
    });
    expect(claim.ok).toBe(true);
    expect(studentSessionStore.getActiveSession()?.id).toBe('session-pre-restart');

    // Simulate startup by initializing the module
    const startupApp = express();
    registerStudentSessionModule(startupApp, { io: mockIo as unknown as SocketIOServer });

    // Verify session became ended with server_restart
    const db = getSqliteDb();
    const row = db
      .prepare('SELECT status, end_reason FROM student_kiosk_sessions WHERE id = ?')
      .get('session-pre-restart') as { status: string; end_reason: string };

    expect(row).toEqual({
      status: 'ended',
      end_reason: 'server_restart',
    });
    expect(studentSessionStore.getActiveSession()).toBeNull();
    expect(service.getKioskState()).toEqual({
      status: 'idle',
      verificationEnabled: true,
    });
  });

  test('Step 3: privacy assertions ensure raw student ID and HMAC never leak across unprivileged boundaries', async () => {
    service.replaceRosterCsv(`student_id,active\n${RAW_STUDENT_ID},true`);

    // Perform identify
    const identifyRes = await fetch(`${baseUrl}/api/portal/identify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ studentId: RAW_STUDENT_ID }),
    });
    const identifyBody = await identifyRes.text();

    // Perform customer work
    await fetch(`${baseUrl}/api/test/customer-transaction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ txnId: 'txn-privacy-test' }),
    });

    // Check kiosk status
    const statusRes = await fetch(`${baseUrl}/api/kiosk/student-session`);
    const statusBody = await statusRes.text();

    // End session
    const endRes = await fetch(`${baseUrl}/api/kiosk/student-session/end`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason: 'user_ended' }),
    });
    const endBody = await endRes.text();

    const expectedHmac = createStudentIdLookupHmac(RAW_STUDENT_ID)!;

    // 1. Raw Student ID (with or without hyphen) must not appear anywhere in responses, Socket.IO, or admin logs
    const socketPayloads = JSON.stringify(mockIo.emit.mock.calls);
    const adminLogs = JSON.stringify(adminLogStore.list(100));

    for (const rawToken of [RAW_STUDENT_ID, RAW_STUDENT_ID_DIGITS]) {
      expect(socketPayloads).not.toContain(rawToken);
      expect(adminLogs).not.toContain(rawToken);
      expect(identifyBody).not.toContain(rawToken);
      expect(statusBody).not.toContain(rawToken);
      expect(endBody).not.toContain(rawToken);
    }

    // 2. Raw Student ID must not appear in any SQLite table
    const db = getSqliteDb();
    const tables = [
      'student_roster',
      'student_kiosk_sessions',
      'student_transaction_attributions',
      'admin_logs',
    ];
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all();
      const stringifiedRows = JSON.stringify(rows);
      expect(stringifiedRows).not.toContain(RAW_STUDENT_ID);
      expect(stringifiedRows).not.toContain(RAW_STUDENT_ID_DIGITS);
    }

    // 3. HMAC must not appear in Socket.IO, admin logs, or browser/API responses
    expect(socketPayloads).not.toContain(expectedHmac);
    expect(adminLogs).not.toContain(expectedHmac);
    expect(identifyBody).not.toContain(expectedHmac);
    expect(statusBody).not.toContain(expectedHmac);
    expect(endBody).not.toContain(expectedHmac);

    // 4. HMAC must ONLY appear in the 3 student tables, never in admin_logs
    const adminRows = db.prepare('SELECT * FROM admin_logs').all();
    expect(JSON.stringify(adminRows)).not.toContain(expectedHmac);

    const rosterRows = db.prepare('SELECT student_id_hmac FROM student_roster').all();
    expect(JSON.stringify(rosterRows)).toContain(expectedHmac);

    const sessionRows = db.prepare('SELECT student_id_hmac FROM student_kiosk_sessions').all();
    expect(JSON.stringify(sessionRows)).toContain(expectedHmac);

    const attributionRows = db.prepare('SELECT student_id_hmac FROM student_transaction_attributions').all();
    expect(JSON.stringify(attributionRows)).toContain(expectedHmac);
  });
});
