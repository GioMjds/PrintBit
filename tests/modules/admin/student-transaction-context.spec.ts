import { createStudentIdLookupHmac } from '@/config';
import { getSqliteDb } from '@/core/database/sqlite-storage';
import { studentSessionStore } from '@/core/database/models/student-session.model';
import { AdminService } from '@/modules/admin/admin.service';

afterEach(() => {
  const sqlite = getSqliteDb();
  sqlite.exec('DELETE FROM student_transaction_attributions;');
  sqlite.exec('DELETE FROM student_kiosk_sessions;');
  sqlite.exec('DELETE FROM student_roster;');
});

describe('admin student transaction context', () => {
  test('looks up the attributed session without selecting or exposing the student HMAC', () => {
    const studentIdHmac = createStudentIdLookupHmac('123-4567');
    if (!studentIdHmac) throw new Error('Expected test student HMAC.');
    studentSessionStore.replaceRoster([{ studentIdHmac }]);
    studentSessionStore.claimSession({ id: 'session-opaque', studentIdHmac });
    studentSessionStore.attributeTransaction({
      transactionId: 'transaction-opaque',
      kioskSessionId: 'session-opaque',
      studentIdHmac,
      operation: 'print',
    });

    const service = new AdminService() as unknown as {
      getStudentTransactionContext?: (transactionId: string) =>
        | { id: string; status: string }
        | null;
    };
    expect(service.getStudentTransactionContext).toBeDefined();
    if (!service.getStudentTransactionContext) return;

    const context = service.getStudentTransactionContext('transaction-opaque');
    expect(context).toEqual({ id: 'session-opaque', status: 'active' });
    expect(JSON.stringify(context)).not.toContain(studentIdHmac);
    expect(JSON.stringify(context)).not.toContain('123-4567');
  });
});
