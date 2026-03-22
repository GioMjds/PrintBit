import path from 'node:path';
import fs from 'node:fs';
import type { Express, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAdminLocalAccess, requireAdminPin } from '@/middleware';
import { reportIssueService } from '@/services';
import type { ReportIssueCategory, ReportIssueStatus } from '@/services';
import {
  reportIssueAttachmentUploadMiddleware,
  validateReportIssueAttachmentMagicBytes,
  scanReportIssueAttachmentForMalware,
  handleMulterError,
} from '@/middleware/file-validation';

export interface RegisterReportRoutesDeps {
  resolvePublicBaseUrl: (req: Request) => URL;
}

const REPORT_PORTAL_DIR = path.resolve('src/public/report');
const REPORT_PORTAL_ASSETS = new Set(['styles.css', 'app.js']);
const REPORT_IMAGE_DIR = path.resolve('uploads/report-issues');
const REPORT_ATTACHMENT_STAGING_DIR = path.resolve(
  'uploads/staging/report-issues',
);

const EXPIRED_HTML = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Session Expired · PrintBit</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    display:flex;align-items:center;justify-content:center;
    min-height:100vh;background:#f0f2f5;margin:0;color:#333}
  .c{background:#fff;border-radius:16px;padding:2rem;max-width:380px;
    text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .icon{font-size:2.5rem;margin-bottom:.75rem}
  h2{margin-bottom:.5rem;font-size:1.2rem}
  p{color:#666;font-size:.9rem;line-height:1.5}
</style></head>
<body><div class="c">
  <div class="icon">⏰</div>
  <h2>Session Expired</h2>
  <p>This link is no longer valid.</p>
  <p>Please go back to the kiosk and scan a new QR code to report an issue.</p>
</div></body></html>`;

const REPORT_PORTAL_TEMPLATE = fs.readFileSync(
  path.join(REPORT_PORTAL_DIR, 'index.html'),
  'utf-8',
);

function renderReportPortal(token: string): string {
  return REPORT_PORTAL_TEMPLATE.replace(
    '</head>',
    `<base href="/report/${encodeURIComponent(token)}/"><script>window.reportIssueToken=${JSON.stringify(token)};</script></head>`,
  );
}

function resolveAttachmentExtension(
  originalName: string,
  mimeType: string,
): string {
  const fromName = path.extname(originalName).toLowerCase();
  if (fromName === '.jpg' || fromName === '.jpeg') return '.jpg';
  if (fromName === '.png') return '.png';
  if (fromName === '.webp') return '.webp';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

async function persistAttachmentWithStaging(
  buffer: Buffer,
  storedName: string,
): Promise<string> {
  const resolvedReportDir = path.resolve(REPORT_IMAGE_DIR);
  const finalPath = path.resolve(resolvedReportDir, storedName);
  const relativePath = path.relative(resolvedReportDir, finalPath);
  const outsideDir =
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath);
  if (outsideDir) {
    throw new Error('Invalid file name.');
  }

  await fs.promises.mkdir(REPORT_IMAGE_DIR, { recursive: true });
  await fs.promises.mkdir(REPORT_ATTACHMENT_STAGING_DIR, { recursive: true });

  const resolvedStagingDir = path.resolve(REPORT_ATTACHMENT_STAGING_DIR);
  const stagingName = `${storedName}.part`;
  const stagingPath = path.resolve(resolvedStagingDir, stagingName);
  const stagingRelativePath = path.relative(resolvedStagingDir, stagingPath);
  const outsideStagingDir =
    stagingRelativePath === '..' ||
    stagingRelativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(stagingRelativePath);
  if (outsideStagingDir) {
    throw new Error('Invalid file name.');
  }

  await fs.promises.writeFile(stagingPath, buffer, { flag: 'wx' });
  try {
    const finalPathResolved = path.resolve(finalPath);
    if (!finalPathResolved.startsWith(resolvedReportDir + path.sep)) {
      await fs.promises.unlink(stagingPath).catch(() => {});
      throw new Error('Invalid file name.');
    }
    if (!stagingPath.startsWith(resolvedStagingDir + path.sep)) {
      await fs.promises.unlink(stagingPath).catch(() => {});
      throw new Error('Invalid file name.');
    }
    await fs.promises.rename(stagingPath, finalPath);
  } catch (error) {
    await fs.promises.unlink(stagingPath).catch(() => {});
    throw error;
  }

  return finalPath;
}

export function registerReportRoutes(
  app: Express,
  deps: RegisterReportRoutesDeps,
) {
  fs.mkdirSync(REPORT_IMAGE_DIR, { recursive: true });
  fs.mkdirSync(REPORT_ATTACHMENT_STAGING_DIR, { recursive: true });

  // ── Public session creation ────────────────────────────────────────────────

  app.post(
    '/api/report-issues/sessions',
    async (req: Request, res: Response) => {
      try {
        const baseUrl = deps.resolvePublicBaseUrl(req);
        const session = await reportIssueService.createSession(baseUrl);
        res.status(201).json(session);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(500).json({ error: message });
      }
    },
  );

  app.get(
    '/api/report-issues/sessions/by-token/:token',
    async (req: Request, res: Response) => {
      const { token } = req.params as { token: string };
      const session = await reportIssueService.getSessionByToken(token);
      if (!session) {
        return res.status(404).json({ error: 'Session not found or expired.' });
      }
      res.json({ sessionId: session.id, reportUrl: session.reportUrl });
    },
  );

  // ── Image upload ───────────────────────────────────────────────────────────

  app.post(
    '/api/report-issues/sessions/:sessionId/attachments',
    reportIssueAttachmentUploadMiddleware.single('file'),
    validateReportIssueAttachmentMagicBytes,
    scanReportIssueAttachmentForMalware,
    async (req: Request, res: Response) => {
      const { sessionId } = req.params as { sessionId: string };
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const file = req.file;

      if (!file) {
        return res.status(400).json({ error: 'No file provided.' });
      }

      const extension = resolveAttachmentExtension(
        file.originalname,
        file.mimetype,
      );
      const storedName = `${randomUUID()}${extension}`;
      let finalPath = '';

      try {
        finalPath = await persistAttachmentWithStaging(file.buffer, storedName);
        const attachment = await reportIssueService.registerAttachment({
          sessionId,
          token,
          originalName: file.originalname,
          storedName,
          contentType: file.mimetype,
          sizeBytes: file.size,
          filePath: finalPath,
        });

        res.status(201).json({
          attachmentId: attachment.id,
          fileName: attachment.originalName,
          contentType: attachment.contentType,
          sizeBytes: attachment.sizeBytes,
          uploadedAt: attachment.timestamp,
        });
      } catch (err) {
        if (finalPath) {
          await fs.promises.unlink(finalPath).catch(() => {});
        }
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );
  app.use('/api/report-issues/sessions/:sessionId/attachments', handleMulterError);

  // ── Report submission ──────────────────────────────────────────────────────

  app.post(
    '/api/report-issues/sessions/:sessionId/submit',
    async (req: Request, res: Response) => {
      const { sessionId } = req.params as { sessionId: string };
      const token = typeof req.query.token === 'string' ? req.query.token : '';
      const body = req.body as {
        title?: unknown;
        description?: unknown;
        category?: unknown;
        attachmentIds?: unknown;
      };

      const title = typeof body.title === 'string' ? body.title : '';
      const description =
        typeof body.description === 'string' ? body.description : '';
      const category = typeof body.category === 'string' ? body.category : null;
      const attachmentIds = Array.isArray(body.attachmentIds)
        ? (body.attachmentIds as unknown[]).filter(
            (id): id is string => typeof id === 'string',
          )
        : [];

      try {
        const entry = await reportIssueService.submitReportIssue({
          sessionId,
          token,
          title,
          description,
          category,
          attachmentIds,
        });
        res.status(201).json({ ok: true, reportIssueId: entry.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  // ── Public portal page ─────────────────────────────────────────────────────

  app.get('/report/:token', async (req: Request, res: Response) => {
    const { token } = req.params as { token: string };
    const session = await reportIssueService.getSessionByToken(token);
    if (!session) return res.status(410).type('html').send(EXPIRED_HTML);
    try {
      res.type('html').send(renderReportPortal(token));
    } catch {
      res.status(500).send('Error loading report portal.');
    }
  });

  app.get('/report/:token/:asset', (req: Request, res: Response) => {
    const { asset } = req.params as { asset: string };
    if (!REPORT_PORTAL_ASSETS.has(asset))
      return res.status(404).send('Not found.');
    res.sendFile(path.join(REPORT_PORTAL_DIR, asset), (err) => {
      if (err) res.status(404).send('Asset not found.');
    });
  });

  // ── Admin: list and filter ─────────────────────────────────────────────────

  app.get(
    '/api/admin/report-issues',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const {
        status: rawStatus,
        category: rawCategory,
        limit: rawLimit,
        offset: rawOffset,
      } = req.query;

      const status: ReportIssueStatus | undefined =
        rawStatus === 'open' ||
        rawStatus === 'acknowledged' ||
        rawStatus === 'resolved'
          ? rawStatus
          : undefined;

      const validCategories: ReportIssueCategory[] = [
        'hardware',
        'software',
        'print',
        'copy',
        'scan',
        'payment',
        'network',
        'other',
      ];
      const category: ReportIssueCategory | undefined =
        validCategories.includes(rawCategory as ReportIssueCategory)
          ? (rawCategory as ReportIssueCategory)
          : undefined;

      const limit = Number.isFinite(Number(rawLimit)) ? Number(rawLimit) : 100;
      const offset = Number.isFinite(Number(rawOffset)) ? Number(rawOffset) : 0;

      res.json(
        reportIssueService.listReportIssues({
          status,
          category,
          limit,
          offset,
        }),
      );
    },
  );

  // ── Admin: single report detail + attachments ──────────────────────────────

  app.get(
    '/api/admin/report-issues/:id',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      const issue = reportIssueService.getReportIssueById(id);
      if (!issue)
        return res.status(404).json({ error: 'Report issue not found.' });

      const attachments = reportIssueService.listAttachmentsForReport(id);
      res.json({ issue, attachments });
    },
  );

  // ── Admin: update status ───────────────────────────────────────────────────

  app.patch(
    '/api/admin/report-issues/:id/status',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const { id } = req.params as { id: string };
      const body = req.body as { status?: unknown };
      const status =
        body.status === 'open' ||
        body.status === 'acknowledged' ||
        body.status === 'resolved'
          ? body.status
          : null;

      if (!status)
        return res.status(400).json({
          error: 'Valid status required: open | acknowledged | resolved',
        });

      const updated = await reportIssueService.updateStatus(id, status);
      if (!updated)
        return res.status(404).json({ error: 'Report issue not found.' });

      res.json({ ok: true, entry: updated });
    },
  );

  // ── Admin: manual create ───────────────────────────────────────────────────

  app.post(
    '/api/admin/report-issues',
    requireAdminLocalAccess,
    requireAdminPin,
    async (req: Request, res: Response) => {
      const body = req.body as {
        title?: unknown;
        description?: unknown;
        category?: unknown;
        attachmentIds?: unknown;
      };

      const title = typeof body.title === 'string' ? body.title : '';
      const description =
        typeof body.description === 'string' ? body.description : '';
      const category = typeof body.category === 'string' ? body.category : null;
      const attachmentIds = Array.isArray(body.attachmentIds)
        ? (body.attachmentIds as unknown[]).filter(
            (id): id is string => typeof id === 'string',
          )
        : [];

      try {
        const entry = await reportIssueService.createByAdmin({
          title,
          description,
          category,
          attachmentIds,
        });
        res.status(201).json({ ok: true, reportIssueId: entry.id });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.status(400).json({ error: message });
      }
    },
  );

  // ── Admin: stream attachment image ────────────────────────────────────────

  app.get(
    '/api/admin/report-issues/attachments/:attachmentId/file',
    requireAdminLocalAccess,
    requireAdminPin,
    (req: Request, res: Response) => {
      const { attachmentId } = req.params as { attachmentId: string };
      const attachment = reportIssueService.findAttachmentById(attachmentId);
      if (!attachment)
        return res.status(404).json({ error: 'Attachment not found.' });

      const absolute = path.resolve(attachment.filePath);
      const rel = path.relative(REPORT_IMAGE_DIR, absolute);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        return res.status(403).json({ error: 'Forbidden.' });
      }

      res.type(attachment.contentType);
      res.sendFile(absolute, (err) => {
        if (err)
          res.status(404).json({ error: 'Image file not found on disk.' });
      });
    },
  );
}
