import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { Router, type Request, type Response } from 'express';
import {
  requireAdminLocalAccess,
  requireAdminPin,
} from '@/middleware/admin-auth';
import { handleMulterError } from '@/middleware/file-validation';
import { createKioskAccessMiddleware } from '@/middleware/kiosk-access';
import { createRateLimit } from '@/middleware/rate-limit';
import type {
  RosterReplacementResult,
  StudentIdentificationResult,
  StudentKioskState,
} from './student-session.types';
import { StudentSessionService } from './student-session.service';

const PORTAL_STATUS_COOKIE = 'printbit_portal_status';
type BrowserSessionEndReason = 'user_ended' | 'idle_timeout';

function isBrowserSessionEndReason(
  value: unknown,
): value is BrowserSessionEndReason {
  return value === 'user_ended' || value === 'idle_timeout';
}

const identifyRateLimit = createRateLimit({
  keyPrefix: 'student-portal-identify',
  windowMs: 60_000,
  max: 10,
});

const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024, files: 1 },
});

export interface StudentSessionControllerService {
  identify(studentId: string): StudentIdentificationResult;
  getKioskState(): StudentKioskState;
  endActiveSession(reason: BrowserSessionEndReason): StudentKioskState;
  replaceRosterCsv(csv: string): RosterReplacementResult;
}

export class StudentSessionController {
  public readonly router: Router;

  constructor(private readonly service: StudentSessionControllerService) {
    this.router = Router();
    this.initializeRoutes();
  }

  private initializeRoutes(): void {
    this.router.use((_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    });

    this.router.post(
      '/api/portal/identify',
      identifyRateLimit,
      this.identify,
    );
    this.router.get('/api/portal/student-session', this.getPortalStatus);

    this.router.get(
      '/api/kiosk/student-session',
      createKioskAccessMiddleware(),
      this.getKioskStatus,
    );
    this.router.post(
      '/api/kiosk/student-session/end',
      createKioskAccessMiddleware(),
      this.endKioskSession,
    );

    this.router.post(
      '/api/admin/student-roster/import',
      requireAdminLocalAccess,
      requireAdminPin,
      rosterUpload.single('file'),
      this.importRoster,
    );
    this.router.use('/api/admin/student-roster/import', handleMulterError);
  }

  private identify = (req: Request, res: Response): void => {
    const studentId =
      typeof req.body?.studentId === 'string' ? req.body.studentId : '';
    const result = this.service.identify(studentId);

    if (!result.ok) {
      if (result.code === 'KIOSK_IN_USE') {
        res.status(409).json({ error: 'The kiosk is currently in use.' });
        return;
      }
      res.status(400).json({ error: 'Student ID could not be verified.' });
      return;
    }

    // This cookie is intentionally unrelated to the internal kiosk session ID.
    res.cookie(PORTAL_STATUS_COOKIE, randomUUID(), {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ status: 'active' });
  };

  private getPortalStatus = (_req: Request, res: Response): void => {
    const { status } = this.service.getKioskState();
    res.json({ status });
  };

  private getKioskStatus = (_req: Request, res: Response): void => {
    res.json(this.service.getKioskState());
  };

  private endKioskSession = (req: Request, res: Response): void => {
    const reason: unknown = req.body?.reason;
    if (!isBrowserSessionEndReason(reason)) {
      res.status(400).json({ error: 'Invalid session end reason.' });
      return;
    }
    res.json(this.service.endActiveSession(reason));
  };

  private importRoster = (req: Request, res: Response): void => {
    if (!req.file) {
      res.status(400).json({ error: 'Roster CSV file is required.' });
      return;
    }

    try {
      const result = this.service.replaceRosterCsv(req.file.buffer.toString('utf8'));
      res.json({ ok: true, ...result });
    } catch {
      // Do not echo CSV validation details because they could contain ID-shaped input.
      res.status(400).json({ error: 'Roster import was rejected.' });
    }
  };
}

export const createStudentSessionController = (
  service: StudentSessionService,
): StudentSessionController => new StudentSessionController(service);
