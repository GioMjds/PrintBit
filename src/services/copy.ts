import fs from 'node:fs';
import path from 'node:path';
import { adminService } from './admin';

const VALID_COLOR_MODES = new Set(['colored', 'grayscale']);
const VALID_ORIENTATIONS = new Set(['portrait', 'landscape']);
const VALID_PAPER_SIZES = new Set(['A4', 'Letter', 'Legal']);

export interface NormalizedCopyJobRequest {
  copies: number;
  colorMode: 'colored' | 'grayscale';
  orientation: 'portrait' | 'landscape';
  paperSize: 'A4' | 'Letter' | 'Legal';
  previewPath: string;
}

export type CopyPreviewValidationResult =
  | { ok: true; previewFilename: string }
  | { ok: false; status: number; error: string };

class CopyService {
  normalizeJobRequest(payload: unknown): NormalizedCopyJobRequest {
    const body = (payload ?? {}) as {
      copies?: number;
      colorMode?: string;
      orientation?: string;
      paperSize?: string;
      previewPath?: string;
    };

    const copies =
      typeof body.copies === 'number' && Number.isFinite(body.copies)
        ? Math.max(1, Math.floor(body.copies))
        : 1;
    const colorMode =
      body.colorMode && VALID_COLOR_MODES.has(body.colorMode)
        ? (body.colorMode as 'colored' | 'grayscale')
        : 'grayscale';
    const orientation =
      body.orientation && VALID_ORIENTATIONS.has(body.orientation)
        ? (body.orientation as 'portrait' | 'landscape')
        : 'portrait';
    const paperSize =
      body.paperSize && VALID_PAPER_SIZES.has(body.paperSize)
        ? (body.paperSize as 'A4' | 'Letter' | 'Legal')
        : 'A4';
    const previewPath =
      typeof body.previewPath === 'string' ? body.previewPath.trim() : '';

    return {
      copies,
      colorMode,
      orientation,
      paperSize,
      previewPath,
    };
  }

  validatePreviewPath(previewPath: string): CopyPreviewValidationResult {
    if (!previewPath) {
      return {
        ok: false,
        status: 400,
        error:
          'Missing checked document. Please go back to /copy and tap Check for Document again.',
      };
    }

    const previewFilename = path.basename(previewPath);
    if (previewFilename !== previewPath) {
      return {
        ok: false,
        status: 400,
        error: 'Invalid preview path. Please check your document again.',
      };
    }

    const previewAbsPath = path.resolve('uploads', 'scans', previewFilename);
    if (!fs.existsSync(previewAbsPath)) {
      return {
        ok: false,
        status: 409,
        error: 'Checked document not found. Please go back to /copy and scan again.',
      };
    }

    return { ok: true, previewFilename };
  }

  calculateRequiredAmount(
    colorMode: 'colored' | 'grayscale',
    copies: number,
  ): number {
    return adminService.calculateJobAmount('copy', colorMode, copies);
  }
}

export const copyService = new CopyService();
