import path from 'node:path';
import fs from 'node:fs';
import {
  reportIssueService,
  type ReportIssueAttachmentEntry,
  type ReportIssueCategory,
  type ReportIssueEntry,
  type ReportIssueSessionEntry,
  type ReportIssueStatus,
} from '@/services';

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

export interface CreateSessionResult {
  sessionId: string;
  token: string;
  reportUrl: string;
  expiresAt: string;
}

export interface RegisterAttachmentInput {
  sessionId: string;
  token: string;
  originalName: string;
  storedName: string;
  contentType: string;
  sizeBytes: number;
  filePath: string;
}

export interface SubmitReportIssueInput {
  sessionId: string;
  token: string;
  title: string;
  description: string;
  category?: string | null;
  attachmentIds?: string[] | null;
}

export interface CreateAdminReportIssueInput {
  title: string;
  description: string;
  category?: string | null;
  attachmentIds?: string[];
}

export interface ListReportIssueOptions {
  status?: ReportIssueStatus;
  category?: ReportIssueCategory;
  limit?: number;
  offset?: number;
}

export interface ListReportIssueResult {
  total: number;
  items: ReportIssueEntry[];
}

export class ReportService {
  async createSession(publicBaseUrl: URL): Promise<CreateSessionResult> {
    return reportIssueService.createSession(publicBaseUrl);
  }

  async getSessionByToken(token: string): Promise<ReportIssueSessionEntry | null> {
    return reportIssueService.getSessionByToken(token);
  }

  resolveAttachmentExtension(originalName: string, mimeType: string): string {
    const fromName = path.extname(originalName).toLowerCase();
    if (fromName === '.jpg' || fromName === '.jpeg') return '.jpg';
    if (fromName === '.png') return '.png';
    if (fromName === '.webp') return '.webp';
    if (mimeType === 'image/png') return '.png';
    if (mimeType === 'image/webp') return '.webp';
    return '.jpg';
  }

  async persistAttachmentWithStaging(
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

  async removeAttachmentFile(filePath: string): Promise<void> {
    await fs.promises.unlink(filePath).catch(() => {});
  }

  async registerAttachment(
    input: RegisterAttachmentInput,
  ): Promise<ReportIssueAttachmentEntry> {
    return reportIssueService.registerAttachment(input);
  }

  async submitReportIssue(
    input: SubmitReportIssueInput,
  ): Promise<ReportIssueEntry> {
    return reportIssueService.submitReportIssue(input);
  }

  renderReportPortal(token: string): string {
    return REPORT_PORTAL_TEMPLATE.replace(
      '</head>',
      `<base href="/report/${encodeURIComponent(token)}/"><script>window.reportIssueToken=${JSON.stringify(token)};</script></head>`,
    );
  }

  isReportPortalAssetAllowed(asset: string): boolean {
    return REPORT_PORTAL_ASSETS.has(asset);
  }

  getReportPortalAssetPath(asset: string): string {
    return path.join(REPORT_PORTAL_DIR, asset);
  }

  getExpiredHtml(): string {
    return EXPIRED_HTML;
  }

  listReportIssues(options: ListReportIssueOptions): ListReportIssueResult {
    return reportIssueService.listReportIssues(options);
  }

  getReportIssueById(id: string): ReportIssueEntry | null {
    return reportIssueService.getReportIssueById(id);
  }

  listAttachmentsForReport(reportIssueId: string): ReportIssueAttachmentEntry[] {
    return reportIssueService.listAttachmentsForReport(reportIssueId);
  }

  async updateStatus(
    id: string,
    status: ReportIssueStatus,
  ): Promise<ReportIssueEntry | null> {
    return reportIssueService.updateStatus(id, status);
  }

  async createByAdmin(input: CreateAdminReportIssueInput): Promise<ReportIssueEntry> {
    return reportIssueService.createByAdmin(input);
  }

  findAttachmentById(attachmentId: string): ReportIssueAttachmentEntry | null {
    return reportIssueService.findAttachmentById(attachmentId);
  }

  isAttachmentInReportDir(filePath: string): boolean {
    const absolute = path.resolve(filePath);
    const rel = path.relative(REPORT_IMAGE_DIR, absolute);
    return !(rel.startsWith('..') || path.isAbsolute(rel));
  }

  ensureStorageDirs(): void {
    fs.mkdirSync(REPORT_IMAGE_DIR, { recursive: true });
    fs.mkdirSync(REPORT_ATTACHMENT_STAGING_DIR, { recursive: true });
  }
}
