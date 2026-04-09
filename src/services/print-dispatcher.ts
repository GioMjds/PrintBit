import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GHOSTSCRIPT_PATH,
  LIBREOFFICE_PATH,
  PDFTOPRINTER_PATH,
  PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS,
  PRINT_DISPATCH_MODE,
  PRINT_DISPATCH_TIMEOUT_MS,
  type PrintDispatchMode,
  SUMATRA_PATH,
} from '@/config';
import { adminService } from './admin';
import type { PrintJobOptions } from './printer';

const execFileAsync = promisify(execFile);

export type PrintDispatchEngine =
  | 'sumatra'
  | 'pdftoprinter'
  | 'ghostscript'
  | 'libreoffice';

export interface PrintDispatchContext {
  transactionId?: string | null;
  sessionId?: string | null;
  documentId?: string | null;
  spoolerCorrelationKey?: string | null;
  mode?: 'print' | 'copy' | 'admin-test' | 'legacy-print';
  source?: string | null;
}

export interface PrintDispatchAttemptResult {
  engine: PrintDispatchEngine;
  executablePath: string | null;
  success: boolean;
  skipped: boolean;
  skipReason: string | null;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  stderrHash: string | null;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  timedOut: boolean;
}

export interface PrintDispatchResult {
  success: boolean;
  selectedEngine: PrintDispatchEngine | null;
  mode: PrintDispatchMode;
  requestedMode: PrintDispatchMode;
  fileExtension: string;
  mimeType: string;
  attempts: PrintDispatchAttemptResult[];
  durationMs: number;
}

export class PrintDispatchError extends Error {
  readonly result: PrintDispatchResult;

  constructor(message: string, result: PrintDispatchResult) {
    super(message);
    this.name = 'PrintDispatchError';
    this.result = result;
  }
}

interface ExecutableRunResult {
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const PDF_EXTENSIONS = new Set(['.pdf']);
const OFFICE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png']);
const SUMATRA_FALLBACK_COMPATIBLE_EXTENSIONS = new Set([
  '.pdf',
  '.jpg',
  '.jpeg',
  '.png',
]);
const MIME_BY_EXTENSION: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function normalizeOptional(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readWhereResult(command: string): string | null {
  const lookup = spawnSync('where.exe', [command], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (lookup.status !== 0 || !lookup.stdout) return null;
  const resolved = lookup.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && fs.existsSync(line));
  return resolved ?? null;
}

function coerceStdout(value: string | Buffer | undefined): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  return value.toString('utf8');
}

function hashOrNull(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function parseSimplePageRange(
  pageRange: string | undefined,
): { firstPage: number; lastPage: number } | null {
  if (!pageRange) return null;
  const trimmed = pageRange.trim();
  if (!trimmed) return null;
  const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
  if (!match) return null;
  const firstPage = Number(match[1]);
  const lastPage = Number(match[2] ?? match[1]);
  if (!Number.isInteger(firstPage) || !Number.isInteger(lastPage)) return null;
  if (firstPage <= 0 || lastPage <= 0 || lastPage < firstPage) return null;
  return { firstPage, lastPage };
}

function resolvePaperSizeArg(size: PrintJobOptions['paperSize']): string {
  if (size === 'Letter') return 'letter';
  if (size === 'Legal') return 'legal';
  return 'a4';
}

function buildSumatraSettings(options: PrintJobOptions): string {
  const parts: string[] = [];
  const pageRange = options.pageRange?.trim();
  if (pageRange) parts.push(pageRange);
  const copies = Math.max(1, Math.floor(options.copies));
  if (copies > 1) parts.push(`${copies}x`);
  parts.push(options.colorMode === 'colored' ? 'color' : 'monochrome');
  parts.push(options.orientation === 'landscape' ? 'landscape' : 'portrait');
  if (typeof options.duplex === 'boolean') {
    parts.push(options.duplex ? 'duplex' : 'simplex');
  }
  parts.push(`paper=${options.paperSize}`);
  return parts.join(',');
}

export class PrintDispatcher {
  private cachedPdfToPrinterPath: string | null | undefined;
  private cachedGhostScriptPath: string | null | undefined;
  private cachedLibreOfficePath: string | null | undefined;
  private cachedSumatraPath: string | null | undefined;
  private activeModeCache: PrintDispatchMode | null = null;
  private nonProductionFallbackLogged = false;

  private resolveConfiguredPath(
    configuredPath: string | undefined | null,
  ): string | null {
    const normalized = normalizeOptional(configuredPath);
    if (!normalized) return null;
    return fs.existsSync(normalized) ? normalized : null;
  }

  private resolvePdfToPrinterPath(): string | null {
    if (this.cachedPdfToPrinterPath !== undefined) {
      return this.cachedPdfToPrinterPath;
    }
    this.cachedPdfToPrinterPath = this.resolveConfiguredPath(PDFTOPRINTER_PATH);
    return this.cachedPdfToPrinterPath;
  }

  private resolveGhostScriptPath(): string | null {
    if (this.cachedGhostScriptPath !== undefined) {
      return this.cachedGhostScriptPath;
    }
    const configured = this.resolveConfiguredPath(GHOSTSCRIPT_PATH);
    if (configured) {
      this.cachedGhostScriptPath = configured;
      return configured;
    }
    const detected = readWhereResult('gswin64c') ?? readWhereResult('gswin32c');
    this.cachedGhostScriptPath = detected;
    return detected;
  }

  private resolveLibreOfficePath(): string | null {
    if (this.cachedLibreOfficePath !== undefined) {
      return this.cachedLibreOfficePath;
    }
    const configured = this.resolveConfiguredPath(LIBREOFFICE_PATH);
    if (configured) {
      this.cachedLibreOfficePath = configured;
      return configured;
    }
    const candidates = [
      path.join(
        process.env.ProgramFiles ?? '',
        'LibreOffice',
        'program',
        'soffice.exe',
      ),
      path.join(
        process.env['ProgramFiles(x86)'] ?? '',
        'LibreOffice',
        'program',
        'soffice.exe',
      ),
      path.join(
        process.env.ProgramFiles ?? '',
        'LibreOffice',
        'program',
        'soffice.com',
      ),
      path.join(
        process.env['ProgramFiles(x86)'] ?? '',
        'LibreOffice',
        'program',
        'soffice.com',
      ),
    ];
    const localFound = candidates.find((candidate) => fs.existsSync(candidate));
    if (localFound) {
      this.cachedLibreOfficePath = localFound;
      return localFound;
    }
    const detected = readWhereResult('soffice');
    this.cachedLibreOfficePath = detected;
    return detected;
  }

  private resolveSumatraPath(): string | null {
    if (this.cachedSumatraPath !== undefined) {
      return this.cachedSumatraPath;
    }
    this.cachedSumatraPath = this.resolveConfiguredPath(SUMATRA_PATH);
    return this.cachedSumatraPath;
  }

  private resolveNewStackMissingDependencies(): string[] {
    const missing: string[] = [];
    if (!this.resolvePdfToPrinterPath()) missing.push('PDFtoPrinter');
    if (!this.resolveGhostScriptPath()) missing.push('GhostScript');
    if (!this.resolveLibreOfficePath()) missing.push('LibreOffice');
    return missing;
  }

  private isProduction(): boolean {
    return process.env.NODE_ENV?.trim().toLowerCase() === 'production';
  }

  private getActiveMode(): PrintDispatchMode {
    if (this.activeModeCache) return this.activeModeCache;
    if (PRINT_DISPATCH_MODE === 'legacy') {
      this.activeModeCache = 'legacy';
      return this.activeModeCache;
    }

    const missing = this.resolveNewStackMissingDependencies();
    if (missing.length === 0) {
      this.activeModeCache = PRINT_DISPATCH_MODE;
      return this.activeModeCache;
    }

    const details = `Missing print dependencies: ${missing.join(', ')}. Requested mode=${PRINT_DISPATCH_MODE}.`;
    if (this.isProduction()) {
      throw new Error(
        `[PRINT_DISPATCH] ${details} Set paths for PDFtoPrinter, GhostScript, and LibreOffice before startup.`,
      );
    }

    if (!this.nonProductionFallbackLogged) {
      this.nonProductionFallbackLogged = true;
      console.warn(
        `[PRINT_DISPATCH] ${details} Falling back to legacy Sumatra mode for local/dev.`,
      );
    }
    this.activeModeCache = 'legacy';
    return this.activeModeCache;
  }

  async assertReady(): Promise<void> {
    void this.getActiveMode();
    if (this.getActiveMode() !== 'legacy' && !this.resolveSumatraPath()) {
      // Sumatra is used as emergency fallback in phased mode.
      console.warn(
        '[PRINT_DISPATCH] Sumatra fallback is unavailable (SUMATRA_PATH not found).',
      );
    }
  }

  async warmLibreOfficeProfile(): Promise<void> {
    const mode = this.getActiveMode();
    if (mode === 'legacy') return;
    const sofficePath = this.resolveLibreOfficePath();
    if (!sofficePath) return;

    const warmupTimeoutMs = Math.max(
      10_000,
      Math.min(20_000, PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS),
    );
    const startedAt = Date.now();
    try {
      await execFileAsync(
        sofficePath,
        ['--headless', '--nologo', '--nodefault', '--version'],
        {
          windowsHide: true,
          timeout: warmupTimeoutMs,
        },
      );
      console.log(
        `[PRINT_DISPATCH] LibreOffice warm-up completed in ${Date.now() - startedAt}ms`,
      );
    } catch (error) {
      console.warn('[PRINT_DISPATCH] LibreOffice warm-up failed.', {
        durationMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private resolveMimeFromExtension(extension: string): string {
    return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
  }

  private resolveEngineChain(
    extension: string,
    mode: PrintDispatchMode,
  ): PrintDispatchEngine[] {
    if (mode === 'legacy') {
      return ['sumatra'];
    }
    if (PDF_EXTENSIONS.has(extension)) {
      return mode === 'phased'
        ? ['pdftoprinter', 'ghostscript', 'sumatra']
        : ['pdftoprinter', 'ghostscript'];
    }
    if (OFFICE_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension)) {
      if (mode === 'phased' && SUMATRA_FALLBACK_COMPATIBLE_EXTENSIONS.has(extension)) {
        return ['libreoffice', 'sumatra'];
      }
      return ['libreoffice'];
    }
    return mode === 'phased' ? ['libreoffice', 'sumatra'] : ['libreoffice'];
  }

  private async executeCommand(
    executablePath: string,
    args: string[],
    timeoutMs: number,
  ): Promise<ExecutableRunResult> {
    return new Promise((resolve) => {
      execFile(
        executablePath,
        args,
        { windowsHide: true, timeout: timeoutMs },
        (error, stdout, stderr) => {
          const normalizedStdout = coerceStdout(stdout);
          const normalizedStderr = coerceStdout(stderr);
          if (!error) {
            resolve({
              success: true,
              exitCode: 0,
              stdout: normalizedStdout,
              stderr: normalizedStderr,
              timedOut: false,
            });
            return;
          }

          const err = error as NodeJS.ErrnoException & {
            code?: string | number;
            signal?: NodeJS.Signals;
            killed?: boolean;
          };
          const exitCode = typeof err.code === 'number' ? err.code : null;
          const timedOut =
            err.code === 'ETIMEDOUT' ||
            (err.killed === true && err.signal === 'SIGTERM');
          resolve({
            success: false,
            exitCode,
            stdout: normalizedStdout,
            stderr: normalizedStderr,
            timedOut,
          });
        },
      );
    });
  }

  private async logAttempt(
    attempt: PrintDispatchAttemptResult,
    extension: string,
    mimeType: string,
    context: PrintDispatchContext,
  ): Promise<void> {
    await adminService.appendAdminLog(
      'print_dispatch_attempt',
      attempt.success
        ? `Print dispatch attempt succeeded via ${attempt.engine}.`
        : attempt.skipped
          ? `Print dispatch attempt skipped for ${attempt.engine}.`
          : `Print dispatch attempt failed via ${attempt.engine}.`,
      {
        transactionId: normalizeOptional(context.transactionId),
        sessionId: normalizeOptional(context.sessionId),
        documentId: normalizeOptional(context.documentId),
        spoolerCorrelationKey: normalizeOptional(context.spoolerCorrelationKey),
        mode: context.mode ?? null,
        source: normalizeOptional(context.source),
        engine: attempt.engine,
        executablePath: attempt.executablePath,
        success: attempt.success,
        skipped: attempt.skipped,
        skipReason: attempt.skipReason,
        exitCode: attempt.exitCode,
        durationMs: attempt.durationMs,
        timedOut: attempt.timedOut,
        fileExtension: extension,
        mimeType,
        stderrHash: attempt.stderrHash,
      },
    );
  }

  private async runAttempt(
    engine: PrintDispatchEngine,
    filePath: string,
    options: PrintJobOptions,
  ): Promise<PrintDispatchAttemptResult> {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const skip = (skipReason: string): PrintDispatchAttemptResult => ({
      engine,
      executablePath: null,
      success: false,
      skipped: true,
      skipReason,
      exitCode: null,
      stdout: '',
      stderr: '',
      stderrHash: null,
      durationMs: 0,
      startedAt,
      endedAt: new Date().toISOString(),
      timedOut: false,
    });

    if (engine === 'pdftoprinter') {
      const executablePath = this.resolvePdfToPrinterPath();
      if (!executablePath) return skip('pdftoprinter_missing');
      // PDFtoPrinter is kept as a lightweight handoff tool; advanced options use GhostScript.
      if (
        options.copies > 1 ||
        Boolean(options.pageRange?.trim()) ||
        options.duplex === true
      ) {
        return skip('pdftoprinter_unsupported_advanced_options');
      }
      const args = [filePath];
      if (options.printerName?.trim()) {
        args.push(options.printerName.trim());
      }
      const runResult = await this.executeCommand(
        executablePath,
        args,
        PRINT_DISPATCH_TIMEOUT_MS,
      );
      const endedAt = new Date().toISOString();
      return {
        engine,
        executablePath,
        success: runResult.success,
        skipped: false,
        skipReason: null,
        exitCode: runResult.exitCode,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        stderrHash: hashOrNull(runResult.stderr),
        durationMs: Date.now() - startedMs,
        startedAt,
        endedAt,
        timedOut: runResult.timedOut,
      };
    }

    if (engine === 'ghostscript') {
      const executablePath = this.resolveGhostScriptPath();
      if (!executablePath) return skip('ghostscript_missing');
      const printerTarget = options.printerName?.trim()
        ? `%printer%${options.printerName.trim()}`
        : '%printer%';
      const args = [
        '-dPrinted',
        '-dBATCH',
        '-dNOPAUSE',
        '-dNOSAFER',
        '-sDEVICE=mswinpr2',
        `-sOutputFile=${printerTarget}`,
        `-sPAPERSIZE=${resolvePaperSizeArg(options.paperSize)}`,
      ];
      if (options.copies > 1) {
        args.push(`-dNumCopies=${Math.max(1, Math.floor(options.copies))}`);
      }
      if (options.duplex === true) args.push('-dDuplex');
      if (options.duplex === false) args.push('-dSimplex');
      if (options.colorMode === 'grayscale') {
        args.push(
          '-sColorConversionStrategy=Gray',
          '-dProcessColorModel=/DeviceGray',
        );
      }
      const range = parseSimplePageRange(options.pageRange);
      if (range) {
        args.push(`-dFirstPage=${range.firstPage}`, `-dLastPage=${range.lastPage}`);
      }
      args.push(filePath);
      const runResult = await this.executeCommand(
        executablePath,
        args,
        PRINT_DISPATCH_TIMEOUT_MS,
      );
      const endedAt = new Date().toISOString();
      return {
        engine,
        executablePath,
        success: runResult.success,
        skipped: false,
        skipReason: null,
        exitCode: runResult.exitCode,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        stderrHash: hashOrNull(runResult.stderr),
        durationMs: Date.now() - startedMs,
        startedAt,
        endedAt,
        timedOut: runResult.timedOut,
      };
    }

    if (engine === 'libreoffice') {
      const executablePath = this.resolveLibreOfficePath();
      if (!executablePath) return skip('libreoffice_missing');
      const printerName = options.printerName?.trim();
      if (!printerName) return skip('libreoffice_missing_printer_name');
      // LibreOffice --pt does not expose robust per-job advanced controls here.
      if (
        options.copies > 1 ||
        Boolean(options.pageRange?.trim()) ||
        options.duplex === true
      ) {
        return skip('libreoffice_unsupported_advanced_options');
      }
      const args = [
        '--headless',
        '--nologo',
        '--nodefault',
        '--norestore',
        '--nolockcheck',
        '--pt',
        printerName,
        filePath,
      ];
      const runResult = await this.executeCommand(
        executablePath,
        args,
        PRINT_DISPATCH_LIBREOFFICE_TIMEOUT_MS,
      );
      const endedAt = new Date().toISOString();
      return {
        engine,
        executablePath,
        success: runResult.success,
        skipped: false,
        skipReason: null,
        exitCode: runResult.exitCode,
        stdout: runResult.stdout,
        stderr: runResult.stderr,
        stderrHash: hashOrNull(runResult.stderr),
        durationMs: Date.now() - startedMs,
        startedAt,
        endedAt,
        timedOut: runResult.timedOut,
      };
    }

    const executablePath = this.resolveSumatraPath();
    if (!executablePath) return skip('sumatra_missing');
    const settings = buildSumatraSettings(options);
    const args = options.printerName?.trim()
      ? [
          '-silent',
          '-print-to',
          options.printerName.trim(),
          '-print-settings',
          settings,
          filePath,
        ]
      : ['-silent', '-print-to-default', '-print-settings', settings, filePath];
    const runResult = await this.executeCommand(
      executablePath,
      args,
      PRINT_DISPATCH_TIMEOUT_MS,
    );
    const endedAt = new Date().toISOString();
    return {
      engine,
      executablePath,
      success: runResult.success,
      skipped: false,
      skipReason: null,
      exitCode: runResult.exitCode,
      stdout: runResult.stdout,
      stderr: runResult.stderr,
      stderrHash: hashOrNull(runResult.stderr),
      durationMs: Date.now() - startedMs,
      startedAt,
      endedAt,
      timedOut: runResult.timedOut,
    };
  }

  async dispatchFile(
    filePath: string,
    options: PrintJobOptions,
    context: PrintDispatchContext = {},
  ): Promise<PrintDispatchResult> {
    const requestedMode = PRINT_DISPATCH_MODE;
    const mode = this.getActiveMode();
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = this.resolveMimeFromExtension(extension);
    const engineChain = this.resolveEngineChain(extension, mode);
    const overallStartMs = Date.now();
    const attempts: PrintDispatchAttemptResult[] = [];

    for (const engine of engineChain) {
      const attempt = await this.runAttempt(engine, filePath, options);
      attempts.push(attempt);
      await this.logAttempt(attempt, extension, mimeType, context).catch(
        (error) => {
          console.error('[PRINT_DISPATCH] Failed to write dispatch attempt log.', {
            engine,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      );
      if (attempt.success) {
        const result: PrintDispatchResult = {
          success: true,
          selectedEngine: engine,
          mode,
          requestedMode,
          fileExtension: extension,
          mimeType,
          attempts,
          durationMs: Date.now() - overallStartMs,
        };
        await adminService
          .appendAdminLog(
            'print_dispatch_summary',
            `Print dispatch succeeded via ${engine}.`,
            {
              transactionId: normalizeOptional(context.transactionId),
              sessionId: normalizeOptional(context.sessionId),
              documentId: normalizeOptional(context.documentId),
              spoolerCorrelationKey: normalizeOptional(
                context.spoolerCorrelationKey,
              ),
              mode: context.mode ?? null,
              source: normalizeOptional(context.source),
              dispatchMode: mode,
              requestedDispatchMode: requestedMode,
              selectedEngine: engine,
              attempts: attempts.length,
              durationMs: result.durationMs,
              fileExtension: extension,
              mimeType,
              fallbackUsed: attempts.length > 1,
            },
          )
          .catch((error) => {
            console.error('[PRINT_DISPATCH] Failed to write dispatch summary log.', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        return result;
      }
    }

    const result: PrintDispatchResult = {
      success: false,
      selectedEngine: null,
      mode,
      requestedMode,
      fileExtension: extension,
      mimeType,
      attempts,
      durationMs: Date.now() - overallStartMs,
    };
    await adminService
      .appendAdminLog('print_dispatch_summary', 'Print dispatch failed.', {
        transactionId: normalizeOptional(context.transactionId),
        sessionId: normalizeOptional(context.sessionId),
        documentId: normalizeOptional(context.documentId),
        spoolerCorrelationKey: normalizeOptional(context.spoolerCorrelationKey),
        mode: context.mode ?? null,
        source: normalizeOptional(context.source),
        dispatchMode: mode,
        requestedDispatchMode: requestedMode,
        selectedEngine: null,
        attempts: attempts.length,
        durationMs: result.durationMs,
        fileExtension: extension,
        mimeType,
      })
      .catch((error) => {
        console.error('[PRINT_DISPATCH] Failed to write dispatch failure summary.', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    throw new PrintDispatchError('Print dispatch failed across all engines.', result);
  }
}

export const printDispatcher = new PrintDispatcher();

export const assertPrintDispatcherReady =
  printDispatcher.assertReady.bind(printDispatcher);

export const warmPrintDispatcherProfile =
  printDispatcher.warmLibreOfficeProfile.bind(printDispatcher);
