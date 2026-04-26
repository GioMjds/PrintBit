import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { SUMATRA_PATH } from '@/config';
import {
  assertPrintDispatcherReady,
  printDispatcher,
  warmPrintDispatcherProfile,
  type PrintDispatchContext,
  type PrintDispatchResult,
} from './print-dispatcher';
import {
  normalizeRotationDeg,
  preparePrintRotationArtifact,
  type RotationDeg,
} from './document-rotation';

export type ColorMode = 'colored' | 'grayscale';
export type Orientation = 'portrait' | 'landscape';
export type PaperSize = 'A4' | 'Letter' | 'Legal';

export interface PrintJobOptions {
  copies: number;
  colorMode: ColorMode;
  orientation: Orientation;
  rotationDeg?: RotationDeg;
  paperSize: PaperSize;
  pageRange?: string;
  duplex?: boolean;
  printerName?: string;
}

export class PrinterService {
  private readonly sumatraPath: string;

  constructor() {
    this.sumatraPath = SUMATRA_PATH;
  }

  async detectDefaultPrinter(): Promise<void> {
    console.log('[PRINTER] -- Detecting default printer ------------------------');

    const sumatraExists = fs.existsSync(this.sumatraPath);
    console.log(
      `[PRINTER] Sumatra fallback: ${this.sumatraPath} (exists: ${sumatraExists})`,
    );

    try {
      const json = await new Promise<string>((resolve, reject) => {
        execFile(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            'Get-CimInstance -ClassName Win32_Printer | Where-Object {$_.Default -eq $true} | Select-Object Name, DriverName, PortName, PrinterStatus | ConvertTo-Json',
          ],
          { timeout: 10_000, windowsHide: true },
          (error, stdout) => {
            if (error) return reject(error);
            resolve(stdout.trim());
          },
        );
      });

      if (!json) {
        console.log('[PRINTER] No default printer set; printing will fail.');
        return;
      }

      const printer = JSON.parse(json) as {
        Name: string;
        DriverName: string;
        PortName: string;
        PrinterStatus: number;
      };

      console.log('[PRINTER] Default printer queue found in Windows:');
      console.log(`[PRINTER]   Name: ${printer.Name}`);
      console.log(`[PRINTER]   Driver: ${printer.DriverName}`);
      console.log(`[PRINTER]   Port: ${printer.PortName}`);
      console.log(`[PRINTER]   Status code: ${printer.PrinterStatus}`);
      console.log(
        '[PRINTER]   Physical readiness is still validated by runtime printer telemetry.',
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[PRINTER] Could not detect default printer: ${msg}`);
    }
  }

  async printFile(
    filename: string,
    options: PrintJobOptions,
    context: PrintDispatchContext = {},
  ): Promise<PrintDispatchResult> {
    const uploadsDir = path.resolve('uploads');
    const normalizedFilename = filename.trim();
    if (!normalizedFilename) {
      throw new Error('Invalid filename');
    }

    const filePath = path.resolve(uploadsDir, normalizedFilename);
    const relativePath = path.relative(uploadsDir, filePath);
    const outsideUploads =
      relativePath === '..' ||
      relativePath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativePath);
    if (outsideUploads) {
      throw new Error('Invalid filename');
    }

    const fileExists = fs.existsSync(filePath);
    if (fileExists && !fs.statSync(filePath).isFile()) {
      throw new Error('Invalid filename');
    }
    if (fileExists) {
      const realUploadsDir = fs.realpathSync(uploadsDir);
      const realFilePath = fs.realpathSync(filePath);
      const realRelative = path.relative(realUploadsDir, realFilePath);
      const realOutsideUploads =
        realRelative === '..' ||
        realRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(realRelative);
      if (realOutsideUploads) {
        throw new Error('Invalid filename');
      }
    }
    if (!fileExists) {
      throw new Error(`File not found: ${filePath}`);
    }

    const rotationDeg = normalizeRotationDeg(options.rotationDeg, 0);
    // Bake rotation AND target orientation physically into the PDF artifact.
    // This ensures the page geometry in the output file already matches the
    // requested orientation before the print engine sees it, making landscape
    // work correctly for every engine (Sumatra, GhostScript, PDFtoPrinter).
    const prepared = await preparePrintRotationArtifact({
      sourcePath: filePath,
      rotationDeg,
      targetOrientation: options.orientation,
    });
    const dispatchOptions: PrintJobOptions = {
      ...options,
      rotationDeg: 0, // Already applied in artifact step
    };
    try {
      return await printDispatcher.dispatchFile(
        prepared.printPath,
        dispatchOptions,
        context,
      );
    } finally {
      for (const cleanupPath of prepared.cleanupPaths) {
        try {
          await fs.promises.unlink(cleanupPath);
        } catch (error) {
          console.warn('[PRINTER] Failed to clean up rotated artifact.', {
            cleanupPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }
}

export const printerService = new PrinterService();
export const detectDefaultPrinter =
  printerService.detectDefaultPrinter.bind(printerService);
export const printFile = printerService.printFile.bind(printerService);
export { assertPrintDispatcherReady, warmPrintDispatcherProfile };
export type { PrintDispatchContext, PrintDispatchResult };
