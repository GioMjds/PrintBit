import { execFile, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  GHOSTSCRIPT_PATH,
  PDFTOPRINTER_PATH,
  PRINT_DISPATCH_MODE,
  PRINT_DISPATCH_TIMEOUT_MS,
  type PrintDispatchMode,
  SUMATRA_PATH,
} from '@/config';
import { adminService } from './admin';
import type { PrintJobOptions } from './printer';

const execFileAsync = promisify(execFile);

export type PrintDispatchEngine = 'sumatra' | 'pdftoprinter' | 'ghostscript';

export type PrintDispatchCapability =
  | 'copies'
  | 'grayscale'
  | 'landscape'
  | 'duplex'
  | 'page-range';

export interface PrintDispatchRequestedOptions {
  copies: number;
  colorMode: PrintJobOptions['colorMode'];
  orientation: PrintJobOptions['orientation'];
  rotationDeg: number;
  paperSize: PrintJobOptions['paperSize'];
  duplex: boolean;
  pageRange: string | null;
}

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
  capabilitySkipReason: string | null;
  missingCapabilities: PrintDispatchCapability[];
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
  requestedOptions: PrintDispatchRequestedOptions;
  requiredCapabilities: PrintDispatchCapability[];
  attempts: PrintDispatchAttemptResult[];
  durationMs: number;
  failureCode: 'no_capable_engine' | 'all_attempts_failed' | null;
}

export class PrintDispatchError extends Error {
  readonly result: PrintDispatchResult;
  readonly code: 'NO_CAPABLE_ENGINE' | 'ALL_ENGINES_FAILED';

  constructor(message: string, result: PrintDispatchResult) {
    super(message);
    this.name = 'PrintDispatchError';
    this.result = result;
    this.code =
      result.failureCode === 'no_capable_engine'
        ? 'NO_CAPABLE_ENGINE'
        : 'ALL_ENGINES_FAILED';
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
const CAPABILITY_SKIP_REASON = 'capability_missing';

type MimeMap = object & Record<string, string>;

const MIME_BY_EXTENSION = {
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
} satisfies MimeMap;

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

const ENGINE_CAPABILITIES = {
  // Lightweight handoff utility; cannot guarantee per-job setting fidelity.
  pdftoprinter: new Set<PrintDispatchCapability>(),
  // GhostScript supports copies, grayscale conversion, duplex, and simple page ranges.
  ghostscript: new Set<PrintDispatchCapability>([
    'copies',
    'grayscale',
    'landscape',
    'duplex',
    'page-range',
  ]),
  // Sumatra can enforce orientation and broad print settings for eligible formats.
  sumatra: new Set<PrintDispatchCapability>([
    'copies',
    'grayscale',
    'landscape',
    'duplex',
    'page-range',
  ]),
} satisfies Record<PrintDispatchEngine, ReadonlySet<PrintDispatchCapability>>;

function normalizeRequestedOptions(
  options: PrintJobOptions,
): PrintDispatchRequestedOptions {
  const copies = Math.max(1, Math.floor(options.copies));
  const pageRange = options.pageRange?.trim() ?? '';
  return {
    copies,
    colorMode: options.colorMode,
    orientation: options.orientation,
    rotationDeg: options.rotationDeg ?? 0,
    paperSize: options.paperSize,
    duplex: options.duplex === true,
    pageRange: pageRange.length > 0 ? pageRange : null,
  };
}

function deriveRequiredCapabilities(
  options: PrintDispatchRequestedOptions,
): PrintDispatchCapability[] {
  const required = new Set<PrintDispatchCapability>();
  if (options.copies > 1) required.add('copies');
  if (options.colorMode === 'grayscale') required.add('grayscale');
  if (options.orientation === 'landscape') required.add('landscape');
  if (options.duplex) required.add('duplex');
  if (options.pageRange) required.add('page-range');
  return [...required];
}

function getMissingCapabilities(
  engine: PrintDispatchEngine,
  requiredCapabilities: PrintDispatchCapability[],
): PrintDispatchCapability[] {
  const supported = ENGINE_CAPABILITIES[engine];
  return requiredCapabilities.filter(
    (capability) => !supported.has(capability),
  );
}

function describeCapability(capability: PrintDispatchCapability): string {
  switch (capability) {
    case 'copies':
      return 'multiple copies';
    case 'grayscale':
      return 'grayscale mode';
    case 'landscape':
      return 'landscape orientation';
    case 'duplex':
      return 'duplex printing';
    case 'page-range':
      return 'page range selection';
    default:
      return capability;
  }
}

function formatCapabilityList(
  capabilities: PrintDispatchCapability[],
): string | null {
  if (capabilities.length === 0) return null;
  return capabilities
    .map((capability) => describeCapability(capability))
    .join(', ');
}

function serializeCapabilities(
  capabilities: PrintDispatchCapability[],
): string | null {
  if (capabilities.length === 0) return null;
  return capabilities.join(',');
}

function serializeRequestedOptions(
  options: PrintDispatchRequestedOptions,
): string {
  return JSON.stringify(options);
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
        `[PRINT_DISPATCH] ${details} Set paths for PDFtoPrinter and GhostScript, before startup.`,
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

  private resolveMimeFromExtension(extension: string): string {
    return (
      (MIME_BY_EXTENSION as MimeMap)[extension] ?? 'application/octet-stream'
    );
  }

  private resolveEngineChain(
    extension: string,
    mode: PrintDispatchMode,
  ): PrintDispatchEngine[] {
    if (mode === 'legacy') return ['sumatra'];
    if (PDF_EXTENSIONS.has(extension)) {
      return mode === 'phased'
        ? ['pdftoprinter', 'ghostscript', 'sumatra']
        : ['pdftoprinter', 'ghostscript'];
    }
    if (OFFICE_EXTENSIONS.has(extension) || IMAGE_EXTENSIONS.has(extension)) {
      if (
        mode === 'phased' &&
        SUMATRA_FALLBACK_COMPATIBLE_EXTENSIONS.has(extension)
      ) {
        return ['sumatra'];
      }
      return ['sumatra'];
    }
    return mode === 'phased' ? ['sumatra'] : ['ghostscript'];
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
    requestedOptions: PrintDispatchRequestedOptions,
    requiredCapabilities: PrintDispatchCapability[],
  ): Promise<void> {
    const requiredCapabilitiesText =
      serializeCapabilities(requiredCapabilities);
    const missingCapabilitiesText = serializeCapabilities(
      attempt.missingCapabilities,
    );
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
        requestedOptions: serializeRequestedOptions(requestedOptions),
        requiredCapabilities: requiredCapabilitiesText,
        capabilitySkipReason: attempt.capabilitySkipReason,
        missingCapabilities: missingCapabilitiesText,
      },
    );
  }

  private async runAttempt(
    engine: PrintDispatchEngine,
    filePath: string,
    options: PrintJobOptions,
    requiredCapabilities: PrintDispatchCapability[],
  ): Promise<PrintDispatchAttemptResult> {
    const startedAt = new Date().toISOString();
    const startedMs = Date.now();
    const skip = (
      skipReason: string,
      missingCapabilities: PrintDispatchCapability[] = [],
    ): PrintDispatchAttemptResult => ({
      engine,
      executablePath: null,
      success: false,
      skipped: true,
      skipReason,
      capabilitySkipReason:
        missingCapabilities.length > 0 ? CAPABILITY_SKIP_REASON : null,
      missingCapabilities,
      exitCode: null,
      stdout: '',
      stderr: '',
      stderrHash: null,
      durationMs: 0,
      startedAt,
      endedAt: new Date().toISOString(),
      timedOut: false,
    });

    const missingCapabilities = getMissingCapabilities(
      engine,
      requiredCapabilities,
    );
    if (missingCapabilities.length > 0) {
      return skip(
        `${CAPABILITY_SKIP_REASON}:${missingCapabilities.join(',')}`,
        missingCapabilities,
      );
    }

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
        capabilitySkipReason: null,
        missingCapabilities: [],
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
        args.push(
          `-dFirstPage=${range.firstPage}`,
          `-dLastPage=${range.lastPage}`,
        );
      }
      // For landscape, instruct GhostScript to use a rotated media orientation.
      // Combined with the pre-rotated PDF artifact this gives robust landscape output.
      if (options.orientation === 'landscape') {
        args.push('-dFIXEDMEDIA', '-dPDFFitPage', '-r600');
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
        capabilitySkipReason: null,
        missingCapabilities: [],
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
      capabilitySkipReason: null,
      missingCapabilities: [],
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
    const requestedOptions = normalizeRequestedOptions(options);
    const requiredCapabilities = deriveRequiredCapabilities(requestedOptions);
    const overallStartMs = Date.now();
    const attempts: PrintDispatchAttemptResult[] = [];

    for (const engine of engineChain) {
      const attempt = await this.runAttempt(
        engine,
        filePath,
        options,
        requiredCapabilities,
      );
      attempts.push(attempt);
      await this.logAttempt(
        attempt,
        extension,
        mimeType,
        context,
        requestedOptions,
        requiredCapabilities,
      ).catch((error) => {
        console.error(
          '[PRINT_DISPATCH] Failed to write dispatch attempt log.',
          {
            engine,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
      if (attempt.success) {
        const result: PrintDispatchResult = {
          success: true,
          selectedEngine: engine,
          mode,
          requestedMode,
          fileExtension: extension,
          mimeType,
          requestedOptions,
          requiredCapabilities,
          attempts,
          durationMs: Date.now() - overallStartMs,
          failureCode: null,
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
              requestedOptions: serializeRequestedOptions(requestedOptions),
              requiredCapabilities: serializeCapabilities(requiredCapabilities),
              failureCode: null,
            },
          )
          .catch((error) => {
            console.error(
              '[PRINT_DISPATCH] Failed to write dispatch summary log.',
              {
                error: error instanceof Error ? error.message : String(error),
              },
            );
          });
        return result;
      }
    }

    const allAttemptsSkipped =
      attempts.length > 0 && attempts.every((attempt) => attempt.skipped);
    const allSkippedForCapabilityMismatch =
      requiredCapabilities.length > 0 &&
      attempts.length > 0 &&
      attempts.every(
        (attempt) =>
          attempt.skipped &&
          attempt.capabilitySkipReason === CAPABILITY_SKIP_REASON,
      );
    const failureCode =
      requiredCapabilities.length > 0 &&
      (allSkippedForCapabilityMismatch || allAttemptsSkipped)
        ? 'no_capable_engine'
        : 'all_attempts_failed';
    const capabilityList = formatCapabilityList(requiredCapabilities);
    const failureMessage =
      failureCode === 'no_capable_engine'
        ? capabilityList
          ? `Selected print settings cannot be honored by available dispatch engines (${capabilityList}).`
          : 'Selected print settings cannot be honored by available dispatch engines.'
        : 'Print dispatch failed across all engines.';

    const result: PrintDispatchResult = {
      success: false,
      selectedEngine: null,
      mode,
      requestedMode,
      fileExtension: extension,
      mimeType,
      requestedOptions,
      requiredCapabilities,
      attempts,
      durationMs: Date.now() - overallStartMs,
      failureCode,
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
        requestedOptions: serializeRequestedOptions(requestedOptions),
        requiredCapabilities: serializeCapabilities(requiredCapabilities),
        failureCode,
      })
      .catch((error) => {
        console.error(
          '[PRINT_DISPATCH] Failed to write dispatch failure summary.',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    throw new PrintDispatchError(failureMessage, result);
  }
}

export const printDispatcher = new PrintDispatcher();

export const assertPrintDispatcherReady =
  printDispatcher.assertReady.bind(printDispatcher);
