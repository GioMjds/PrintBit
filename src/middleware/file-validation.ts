import path from 'node:path';
import multer from 'multer';
import type { Request, Response, NextFunction } from 'express';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  MAGIC_SIGNATURES,
  EXTENSION_MIME_MAP,
  OOXML_DIRECTORY_MARKERS,
  REPORT_ATTACHMENT_ALLOWED_EXTENSIONS,
  REPORT_ATTACHMENT_ALLOWED_MIME_TYPES,
  REPORT_ATTACHMENT_EXTENSION_MIME_MAP,
  REPORT_ATTACHMENT_MAGIC_SIGNATURES,
} from '@/utils/file-types';
import { adminService } from '@/services';
import { scanBuffer, isClamdReachable } from '@/services/clamd';
import { quarantineBuffer } from '@/services/quarantine';
import { anomalyService, buildAnomalyFingerprint } from '@/services/anomaly';

type UploadSurface =
  | 'wireless-session-upload'
  | 'legacy-upload'
  | 'report-issue-attachment';

interface ValidationPolicy {
  readonly allowedExtensions: Set<string>;
  readonly allowedMimeTypes: Set<string>;
  readonly extensionMimeMap: Record<string, string>;
  readonly magicSignatures: Record<
    string,
    Array<{ bytes: number[]; offset?: number }>
  >;
  readonly surface: UploadSurface;
}

const DANGEROUS_SCRIPT_OR_EXECUTABLE_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.scr',
  '.pif',
  '.cpl',
  '.msi',
  '.msp',
  '.dll',
  '.sys',
  '.ps1',
  '.vbs',
  '.vbe',
  '.js',
  '.jse',
  '.wsf',
  '.wsh',
  '.hta',
  '.sh',
  '.bash',
  '.zsh',
  '.ksh',
  '.jar',
  '.apk',
  '.gadget',
]);

const DOCUMENT_UPLOAD_POLICY: ValidationPolicy = {
  allowedExtensions: ALLOWED_EXTENSIONS,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  extensionMimeMap: EXTENSION_MIME_MAP,
  magicSignatures: MAGIC_SIGNATURES,
  surface: 'wireless-session-upload',
};

const LEGACY_UPLOAD_POLICY: ValidationPolicy = {
  allowedExtensions: ALLOWED_EXTENSIONS,
  allowedMimeTypes: ALLOWED_MIME_TYPES,
  extensionMimeMap: EXTENSION_MIME_MAP,
  magicSignatures: MAGIC_SIGNATURES,
  surface: 'legacy-upload',
};

const REPORT_ATTACHMENT_POLICY: ValidationPolicy = {
  allowedExtensions: REPORT_ATTACHMENT_ALLOWED_EXTENSIONS,
  allowedMimeTypes: REPORT_ATTACHMENT_ALLOWED_MIME_TYPES,
  extensionMimeMap: REPORT_ATTACHMENT_EXTENSION_MIME_MAP,
  magicSignatures: REPORT_ATTACHMENT_MAGIC_SIGNATURES,
  surface: 'report-issue-attachment',
};

function classifyDetectedMime(
  buffer: Buffer,
  signatures: ValidationPolicy['magicSignatures'],
): string | null {
  for (const [mime, mimeSignatures] of Object.entries(signatures)) {
    if (mime === 'image/webp' && !hasValidWebpSignature(buffer)) {
      continue;
    }
    const matched = mimeSignatures.some(({ bytes, offset = 0 }) => {
      if (buffer.length < offset + bytes.length) return false;
      return bytes.every((byte, index) => buffer[offset + index] === byte);
    });
    if (matched) return mime;
  }
  return null;
}

function detectDisguisedExecutableName(originalName: string): {
  flagged: boolean;
  matchedExtension: string | null;
} {
  const filename = path.basename(originalName).toLowerCase();
  const parts = filename
    .split('.')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (parts.length <= 1) {
    return { flagged: false, matchedExtension: null };
  }

  for (let idx = 1; idx < parts.length - 1; idx += 1) {
    const ext = `.${parts[idx]}`;
    if (DANGEROUS_SCRIPT_OR_EXECUTABLE_EXTENSIONS.has(ext)) {
      return { flagged: true, matchedExtension: ext };
    }
  }

  const finalExt = `.${parts[parts.length - 1]}`;
  if (DANGEROUS_SCRIPT_OR_EXECUTABLE_EXTENSIONS.has(finalExt)) {
    return { flagged: true, matchedExtension: finalExt };
  }

  return { flagged: false, matchedExtension: null };
}

function getRequestClientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    return (
      forwarded
        .split(',')
        .map((part) => part.trim())
        .find((part) => part.length > 0) ??
      (req.ip || '')
    );
  }
  return req.ip || '';
}

function extractRequestContext(
  req: Request,
): Record<string, string | number | boolean | null> {
  return {
    route: req.route?.path?.toString() ?? null,
    method: req.method,
    ipAddress: getRequestClientIp(req) || null,
    sessionId:
      typeof req.params?.sessionId === 'string' ? req.params.sessionId : null,
    uploadToken: typeof req.query?.token === 'string' ? req.query.token : null,
    uploadClientId:
      req.header('x-upload-client-id') ??
      req.header('x-session-client-id') ??
      null,
  };
}

async function reportUploadSecurityAnomaly(input: {
  type: string;
  source: UploadSurface;
  severity: 'warning' | 'critical';
  message: string;
  fingerprintParts: Array<string | null>;
  context?: Record<string, string | number | boolean | null>;
}): Promise<void> {
  try {
    await anomalyService.report({
      type: input.type,
      source: input.source,
      category: 'security',
      severity: input.severity,
      message: input.message,
      fingerprint: buildAnomalyFingerprint(input.fingerprintParts),
      context: input.context,
    });
  } catch (error) {
    console.error('[UPLOAD_SECURITY] Failed to report anomaly incident.', {
      type: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function appendSecurityLog(
  type: string,
  message: string,
  meta: Record<string, string | number | boolean | null>,
): void {
  void adminService.appendAdminLog(type, message, meta).catch((error) => {
    console.error('[UPLOAD_SECURITY] Failed to append admin security log.', {
      type,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function quarantineUploadBuffer(
  file: Express.Multer.File,
  reason:
    | 'UNSUPPORTED_TYPE'
    | 'MAGIC_BYTE_MISMATCH'
    | 'FILE_INFECTED'
    | 'SCAN_ERROR',
  virusName?: string,
): void {
  void quarantineBuffer(
    file.buffer,
    file.originalname,
    file.size,
    reason,
    virusName,
  ).catch((error) => {
    console.error('[UPLOAD_SECURITY] Failed to quarantine upload buffer.', {
      reason,
      filename: file.originalname,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  validateIncomingFileType(_req, file, cb, DOCUMENT_UPLOAD_POLICY);
}

function validateIncomingFileType(
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
  policy: ValidationPolicy,
): void {
  const ext = path.extname(file.originalname).toLowerCase();
  const incomingMime = file.mimetype.toLowerCase();
  const requestContext = extractRequestContext(req);

  const disguised = detectDisguisedExecutableName(file.originalname);
  if (disguised.flagged) {
    const meta = {
      ...requestContext,
      originalFilename: file.originalname,
      declaredMimeType: incomingMime,
      detectedMimeType: null,
      detectedExecutableExtension: disguised.matchedExtension,
      validationReason: 'DISGUISED_EXECUTABLE_NAME',
      uploadSurface: policy.surface,
    };
    appendSecurityLog(
      'upload_security_violation',
      'Rejected upload with disguised executable filename pattern.',
      meta,
    );
    void reportUploadSecurityAnomaly({
      type: 'upload_disguised_executable_rejected',
      source: policy.surface,
      severity: 'critical',
      message:
        'Upload rejected because filename contains a dangerous executable extension pattern.',
      fingerprintParts: [
        policy.surface,
        'disguised-filename',
        disguised.matchedExtension,
      ],
      context: meta,
    });
    cb(
      Object.assign(new Error('Disguised executable filename detected'), {
        code: 'DISGUISED_EXECUTABLE',
      }),
    );
    return;
  }

  if (
    !policy.allowedExtensions.has(ext) ||
    !policy.allowedMimeTypes.has(incomingMime)
  ) {
    const meta = {
      ...requestContext,
      originalFilename: file.originalname,
      declaredMimeType: incomingMime,
      detectedMimeType: null,
      detectedExecutableExtension: null,
      validationReason: 'UNSUPPORTED_TYPE',
      uploadSurface: policy.surface,
    };
    appendSecurityLog(
      'upload_security_violation',
      'Rejected upload because extension or declared MIME type is not allowed.',
      meta,
    );
    cb(
      Object.assign(new Error('Invalid file type'), {
        code: 'UNSUPPORTED_TYPE',
      }),
    );
    return;
  }

  const expectedMime = policy.extensionMimeMap[ext];
  const normalizedMime =
    incomingMime === 'application/octet-stream' ? expectedMime : incomingMime;
  if (!normalizedMime || (expectedMime && expectedMime !== normalizedMime)) {
    const meta = {
      ...requestContext,
      originalFilename: file.originalname,
      declaredMimeType: incomingMime,
      detectedMimeType: null,
      detectedExecutableExtension: null,
      validationReason: 'EXTENSION_MIME_MISMATCH',
      expectedMimeType: expectedMime ?? null,
      uploadSurface: policy.surface,
    };
    appendSecurityLog(
      'upload_security_violation',
      'Rejected upload because extension does not match declared MIME type.',
      meta,
    );
    cb(
      Object.assign(new Error('File extension does not match content type'), {
        code: 'UNSUPPORTED_TYPE',
      }),
    );
    return;
  }

  file.mimetype = normalizedMime;
  cb(null, true);
}

export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
});

function legacyUploadFileFilter(
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  validateIncomingFileType(req, file, cb, LEGACY_UPLOAD_POLICY);
}

export const legacyUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: legacyUploadFileFilter,
});

function reportIssueAttachmentFileFilter(
  req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
): void {
  validateIncomingFileType(req, file, cb, REPORT_ATTACHMENT_POLICY);
}

export const reportIssueAttachmentUploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: reportIssueAttachmentFileFilter,
});

export function handleMulterError(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({
        code: 'FILE_TOO_LARGE',
        error: `File size exceeds the limit of ${MAX_FILE_SIZE_LABEL}.`,
      });
      return;
    }
    res.status(400).json({
      code: 'UPLOAD_ERROR',
      error: error.message,
    });
    return;
  }
  if (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'UNSUPPORTED_TYPE'
  ) {
    res.status(415).json({
      code: 'UNSUPPORTED_FILE_TYPE',
      error: error.message,
    });
    return;
  }
  if (
    error instanceof Error &&
    (error as Error & { code?: string }).code === 'DISGUISED_EXECUTABLE'
  ) {
    res.status(422).json({
      code: 'DISGUISED_EXECUTABLE',
      error: error.message,
    });
    return;
  }
  next(error);
}

function matchesMagicBytes(
  buffer: Buffer,
  mime: string,
  signaturesByMime: ValidationPolicy['magicSignatures'],
): boolean {
  const signatures = signaturesByMime[mime];
  if (!signatures) return false;

  return signatures.some(({ bytes, offset = 0 }) => {
    if (buffer.length < offset + bytes.length) return false;
    return bytes.every((byte, index) => buffer[offset + index] === byte);
  });
}

function hasValidWebpSignature(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  const riff = buffer.toString('ascii', 0, 4);
  const webp = buffer.toString('ascii', 8, 12);
  return riff === 'RIFF' && webp === 'WEBP';
}

function findEndOfCentralDirectoryOffset(buffer: Buffer): number {
  const eocdSignature = 0x06054b50;
  const minEocdLength = 22;
  const maxCommentLength = 0xffff;

  if (buffer.length < minEocdLength) return -1;

  const searchStart = Math.max(
    0,
    buffer.length - minEocdLength - maxCommentLength,
  );

  for (
    let offset = buffer.length - minEocdLength;
    offset >= searchStart;
    offset -= 1
  ) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      return offset;
    }
  }

  return -1;
}

function validateOoxmlStructure(
  buffer: Buffer,
  directoryMarker: string,
): boolean {
  const centralDirectoryHeaderSignature = 0x02014b50;
  const eocdOffset = findEndOfCentralDirectoryOffset(buffer);

  if (eocdOffset === -1) return false;

  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (
    centralDirectoryOffset < 0 ||
    centralDirectorySize <= 0 ||
    centralDirectoryEnd > buffer.length
  ) {
    return false;
  }

  let cursor = centralDirectoryOffset;
  let hasContentTypes = false;
  let hasDirectoryEntry = false;

  while (cursor + 46 <= centralDirectoryEnd) {
    if (buffer.readUInt32LE(cursor) !== centralDirectoryHeaderSignature) {
      return false;
    }

    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraFieldLength = buffer.readUInt16LE(cursor + 30);
    const fileCommentLength = buffer.readUInt16LE(cursor + 32);
    const fileNameStart = cursor + 46;
    const fileNameEnd = fileNameStart + fileNameLength;

    if (fileNameEnd > centralDirectoryEnd) return false;

    const entryName = buffer.toString('utf8', fileNameStart, fileNameEnd);

    if (entryName === '[Content_Types].xml') {
      hasContentTypes = true;
    }

    if (
      entryName.startsWith(directoryMarker) &&
      entryName.length > directoryMarker.length
    ) {
      hasDirectoryEntry = true;
    }

    if (hasContentTypes && hasDirectoryEntry) {
      return true;
    }

    cursor = fileNameEnd + extraFieldLength + fileCommentLength;
  }

  return false;
}

export async function validateMagicBytes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const file = req.file;

  if (!file) {
    next();
    return;
  }

  const mime = file.mimetype.toLowerCase();
  const hasValidMagicBytes = matchesMagicBytes(
    file.buffer,
    mime,
    MAGIC_SIGNATURES,
  );

  // For OOXML formats, also validate internal ZIP structure
  const ooxmlMarker = OOXML_DIRECTORY_MARKERS[mime];
  const isOoxmlFormat = !!ooxmlMarker;
  const magicBytesFailed = !hasValidMagicBytes;
  
  // Compute OOXML structure validation once to avoid duplicate parsing
  const ooxmlStructureIsValid = 
    isOoxmlFormat && hasValidMagicBytes
      ? validateOoxmlStructure(file.buffer, ooxmlMarker)
      : false;
  
  const ooxmlStructureFailed =
    isOoxmlFormat && hasValidMagicBytes && !ooxmlStructureIsValid;
  const isValidOoxml =
    !isOoxmlFormat || (hasValidMagicBytes && ooxmlStructureIsValid);

  if (!hasValidMagicBytes || !isValidOoxml) {
    const detectedMime = classifyDetectedMime(file.buffer, MAGIC_SIGNATURES);
    const validationReason = magicBytesFailed
      ? 'MAGIC_BYTE_MISMATCH'
      : 'OOXML_STRUCTURE_INVALID';
    const meta = {
      ...extractRequestContext(req),
      originalFilename: file.originalname,
      declaredMimeType: mime,
      detectedMimeType: detectedMime,
      detectedExecutableExtension: null,
      validationReason,
      uploadSurface: 'wireless-session-upload' as UploadSurface,
      sizeBytes: file.size,
    };
    quarantineUploadBuffer(file, 'MAGIC_BYTE_MISMATCH');
    appendSecurityLog(
      'upload_security_violation',
      'Rejected upload because file signature or OOXML structure is invalid.',
      meta,
    );
    void reportUploadSecurityAnomaly({
      type: isValidOoxml
        ? 'upload_magic_byte_mismatch'
        : 'upload_ooxml_structure_invalid',
      source: 'wireless-session-upload',
      severity: 'critical',
      message:
        'Upload rejected because file content validation failed against declared document type.',
      fingerprintParts: [
        'wireless-session-upload',
        isValidOoxml ? 'magic-byte-mismatch' : 'ooxml-structure-invalid',
        mime,
        detectedMime,
      ],
      context: meta,
    });

    res.status(422).json({
      code: 'UNSUPPORTED_TYPE',
      error: 'File content does not match its declared type.',
    });
    return;
  }

  next();
}

async function validateMagicBytesWithPolicy(
  req: Request,
  res: Response,
  next: NextFunction,
  policy: ValidationPolicy,
): Promise<void> {
  const file = req.file;

  if (!file) {
    next();
    return;
  }

  const mime = file.mimetype.toLowerCase();
  const hasKnownHeader = matchesMagicBytes(
    file.buffer,
    mime,
    policy.magicSignatures,
  );
  const webpValid = mime !== 'image/webp' || hasValidWebpSignature(file.buffer);
  const hasValidMagicBytes = hasKnownHeader && webpValid;

  if (!hasValidMagicBytes) {
    const detectedMime = classifyDetectedMime(
      file.buffer,
      policy.magicSignatures,
    );
    const meta = {
      ...extractRequestContext(req),
      originalFilename: file.originalname,
      declaredMimeType: mime,
      detectedMimeType: detectedMime,
      detectedExecutableExtension: null,
      validationReason: 'MAGIC_BYTE_MISMATCH',
      uploadSurface: policy.surface,
      sizeBytes: file.size,
    };

    quarantineUploadBuffer(file, 'MAGIC_BYTE_MISMATCH');

    appendSecurityLog(
      'upload_security_violation',
      'Rejected upload because file signature does not match declared type.',
      meta,
    );
    void reportUploadSecurityAnomaly({
      type: 'upload_magic_byte_mismatch',
      source: policy.surface,
      severity: 'critical',
      message:
        'Upload rejected because binary signature does not match declared MIME type.',
      fingerprintParts: [
        policy.surface,
        'magic-byte-mismatch',
        mime,
        detectedMime,
      ],
      context: meta,
    });

    res.status(422).json({
      code: 'UNSUPPORTED_TYPE',
      error: 'File content does not match its declared type.',
    });
    return;
  }

  next();
}

export async function validateLegacyUploadMagicBytes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return validateMagicBytesWithPolicy(req, res, next, LEGACY_UPLOAD_POLICY);
}

export async function validateReportIssueAttachmentMagicBytes(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return validateMagicBytesWithPolicy(req, res, next, REPORT_ATTACHMENT_POLICY);
}

export async function scanForMalware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return scanForMalwareWithSurface(req, res, next, 'wireless-session-upload');
}

async function scanForMalwareWithSurface(
  req: Request,
  res: Response,
  next: NextFunction,
  surface: UploadSurface,
): Promise<void> {
  const file = req.file;
  if (!file) {
    next();
    return;
  }

  const daemonUp = await isClamdReachable();
  if (!daemonUp) {
    const meta = {
      ...extractRequestContext(req),
      originalFilename: file.originalname,
      declaredMimeType: file.mimetype.toLowerCase(),
      detectedMimeType: null,
      detectedExecutableExtension: null,
      validationReason: 'SCAN_UNAVAILABLE',
      uploadSurface: surface,
      sizeBytes: file.size,
    };
    appendSecurityLog(
      'scan_unavailable',
      'ClamAV daemon unreachable — upload blocked.',
      meta,
    );
    void reportUploadSecurityAnomaly({
      type: 'upload_scan_unavailable',
      source: surface,
      severity: 'critical',
      message: 'Upload blocked because ClamAV scanner is unavailable.',
      fingerprintParts: [surface, 'scan-unavailable'],
      context: meta,
    });
    res.status(503).json({
      code: 'SCAN_UNAVAILABLE',
      error:
        'File scanning is currently unavailable. Please try again shortly.',
    });
    return;
  }

  try {
    const result = await scanBuffer(file.buffer);
    if (!result.isClean) {
      const meta = {
        ...extractRequestContext(req),
        originalFilename: file.originalname,
        declaredMimeType: file.mimetype.toLowerCase(),
        detectedMimeType: null,
        detectedExecutableExtension: null,
        validationReason: 'FILE_INFECTED',
        uploadSurface: surface,
        sizeBytes: file.size,
        virusName: result.virusName ?? null,
      };
      quarantineUploadBuffer(
        file,
        'FILE_INFECTED',
        result.virusName ?? undefined,
      );
      appendSecurityLog(
        'upload_security_violation',
        'Rejected upload because malware was detected.',
        meta,
      );
      void reportUploadSecurityAnomaly({
        type: 'upload_malware_detected',
        source: surface,
        severity: 'critical',
        message: 'Upload rejected because malware scanner flagged the file.',
        fingerprintParts: [
          surface,
          'malware-detected',
          result.virusName ?? 'unknown',
        ],
        context: meta,
      });
      res.status(422).json({
        code: 'FILE_INFECTED',
        error:
          'This file was flagged by our security scanner and cannot be accepted.',
      });
      return;
    }

    next();
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Unknown scan error';
    const meta = {
      ...extractRequestContext(req),
      originalFilename: file.originalname,
      declaredMimeType: file.mimetype.toLowerCase(),
      detectedMimeType: null,
      detectedExecutableExtension: null,
      validationReason: 'SCAN_ERROR',
      uploadSurface: surface,
      sizeBytes: file.size,
      scanError: reason,
    };
    quarantineUploadBuffer(file, 'SCAN_ERROR');
    appendSecurityLog(
      'upload_security_violation',
      'Upload scan failed due to scanner processing error.',
      meta,
    );
    void reportUploadSecurityAnomaly({
      type: 'upload_scan_error',
      source: surface,
      severity: 'warning',
      message: 'Upload scanner returned an unexpected processing error.',
      fingerprintParts: [surface, 'scan-error'],
      context: meta,
    });
    res.status(500).json({
      code: 'SCAN_ERROR',
      error: 'An error occurred while scanning the file. Please try again.',
    });
  }
}

export async function scanLegacyUploadForMalware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return scanForMalwareWithSurface(req, res, next, 'legacy-upload');
}

export async function scanReportIssueAttachmentForMalware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  return scanForMalwareWithSurface(req, res, next, 'report-issue-attachment');
}
