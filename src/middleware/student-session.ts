import type { RequestHandler } from 'express';
import { STUDENT_ID_VERIFICATION_ENABLED } from '@/config';

export interface StudentSessionTransactionAuthority {
  requireActiveSession(): { sessionId: string };
  attributeTransaction(transactionId: string, operation: string): unknown;
}

export function requireStudentSession(
  service: StudentSessionTransactionAuthority,
): RequestHandler {
  return (_req, res, next) => {
    if (!STUDENT_ID_VERIFICATION_ENABLED) {
      next();
      return;
    }

    try {
      const active = service.requireActiveSession();
      res.locals.studentKioskSessionId = active.sessionId;
      next();
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'ACTIVE_SESSION_REQUIRED'
      ) {
        res.status(403).json({ code: 'STUDENT_IDENTIFICATION_REQUIRED' });
        return;
      }
      next(error);
    }
  };
}

export function attributeStudentTransaction(
  service: StudentSessionTransactionAuthority | undefined,
  transactionId: string,
  operation: string,
): void {
  if (!STUDENT_ID_VERIFICATION_ENABLED) return;
  if (!service) {
    throw new Error(
      'Student session authority is required when verification is enabled.',
    );
  }
  service.attributeTransaction(transactionId, operation);
}
