import { db } from './db';
import type {
  InkPreflightEvaluation,
  PrinterTelemetry,
} from './printer-status';
import type { PrintJobOptions } from './printer';
import { printErrorClassifier } from './print-error-classifier';
import type { PrintError } from '../utils/print-error-types';
import {
  getWindowsDiagnosticsSnapshot,
  type WindowsDiagnosticsPrinter,
  type WindowsDiagnosticsSnapshot,
} from './windows-diagnostics';

export interface PrintPreflightInput {
  telemetry: PrinterTelemetry;
  inkPreflight: InkPreflightEvaluation;
  printOptions: PrintJobOptions;
  selectedPages: number;
  copies: number;
  transactionId: string;
  sessionId: string | null;
  documentId: string | null;
  printerName: string | null;
}

export interface PrintPreflightResult {
  blocker: PrintError | null;
  warnings: PrintError[];
  diagnostics: WindowsDiagnosticsSnapshot | null;
  estimatedSheets: number;
}

function normalizeComparable(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function paperAliases(paperSize: PrintJobOptions['paperSize']): string[] {
  switch (paperSize) {
    case 'Legal':
      return ['legal', 'long bond', 'long'];
    case 'Letter':
      return ['letter', 'short bond', 'short'];
    case 'A4':
    default:
      return ['a4', 'short bond', 'short'];
  }
}

function printerSupportsPaper(
  printer: WindowsDiagnosticsPrinter,
  paperSize: PrintJobOptions['paperSize'],
): boolean | null {
  if (printer.capabilities.paperSizes.length === 0) return null;
  const aliases = paperAliases(paperSize);
  return printer.capabilities.paperSizes.some((paper) => {
    const normalized = normalizeComparable(paper);
    return aliases.some((alias) => normalized.includes(alias));
  });
}

function findSelectedPrinter(
  diagnostics: WindowsDiagnosticsSnapshot,
  printerName: string | null,
): WindowsDiagnosticsPrinter | null {
  if (printerName) {
    const target = normalizeComparable(printerName);
    const exact = diagnostics.printers.find(
      (printer) => normalizeComparable(printer.name) === target,
    );
    if (exact) return exact;
  }
  return diagnostics.printers.find((printer) => printer.isDefault) ?? null;
}

function sameNamedPrinters(
  diagnostics: WindowsDiagnosticsSnapshot,
  printerName: string | null,
): WindowsDiagnosticsPrinter[] {
  const target = normalizeComparable(printerName);
  if (!target) return [];
  return diagnostics.printers.filter(
    (printer) => normalizeComparable(printer.name) === target,
  );
}

function getConfiguredPrinterName(): string | null {
  const value = db.data?.settings?.inkMonitoring?.targetPrinterName;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function validatePrintPreflight(
  input: PrintPreflightInput,
): Promise<PrintPreflightResult> {
  const selectedPages = Math.max(1, Math.floor(input.selectedPages));
  const copies = Math.max(1, Math.floor(input.copies));
  const estimatedSheets =
    copies * Math.ceil(selectedPages / (input.printOptions.duplex ? 2 : 1));
  const baseContext = {
    transactionId: input.transactionId,
    sessionId: input.sessionId,
    jobId: input.documentId,
    printerName: input.printerName,
  };
  const warnings: PrintError[] = [];

  const telemetryError = printErrorClassifier.classifyPrinterTelemetry(
    input.telemetry,
    {
      ...baseContext,
      source: 'confirm-payment-preflight',
    },
  );
  if (telemetryError) {
    return {
      blocker: telemetryError,
      warnings,
      diagnostics: null,
      estimatedSheets,
    };
  }

  const paperCurrentSheets =
    db.data?.settings?.consumablesForecasting?.paperCurrentSheets;
  if (
    typeof paperCurrentSheets === 'number' &&
    Number.isFinite(paperCurrentSheets)
  ) {
    if (paperCurrentSheets <= 0) {
      return {
        blocker: printErrorClassifier.create('PAPER_TRAY_EMPTY', {
          ...baseContext,
          source: 'confirm-payment-preflight',
          raw: {
            paperCurrentSheets,
            estimatedSheets,
          },
        }),
        warnings,
        diagnostics: null,
        estimatedSheets,
      };
    }
    if (paperCurrentSheets < estimatedSheets) {
      return {
        blocker: printErrorClassifier.create(
          'PAPER_INSUFFICIENT_PRE_DISPATCH',
          {
            ...baseContext,
            source: 'confirm-payment-preflight',
            raw: {
              paperCurrentSheets,
              estimatedSheets,
              selectedPages,
              copies,
              duplex: input.printOptions.duplex === true,
            },
          },
        ),
        warnings,
        diagnostics: null,
        estimatedSheets,
      };
    }
  }

  const inkError = printErrorClassifier.classifyInkPreflight(
    input.inkPreflight,
    {
      ...baseContext,
      source: 'confirm-payment-preflight',
    },
  );
  if (inkError?.severity === 'FATAL') {
    return {
      blocker: inkError,
      warnings,
      diagnostics: null,
      estimatedSheets,
    };
  }
  if (inkError) warnings.push(inkError);

  let diagnostics: WindowsDiagnosticsSnapshot | null = null;
  try {
    diagnostics = await getWindowsDiagnosticsSnapshot(input.printerName);
  } catch (error) {
    warnings.push(
      printErrorClassifier.create('DIAGNOSTICS_BRIDGE_FAILED', {
        ...baseContext,
        source: 'windows-diagnostics',
        raw: {
          message: error instanceof Error ? error.message : String(error),
        },
      }),
    );
    return {
      blocker: null,
      warnings,
      diagnostics: null,
      estimatedSheets,
    };
  }
  if (diagnostics.bridgeFailure) {
    warnings.push(
      printErrorClassifier.create('DIAGNOSTICS_BRIDGE_FAILED', {
        ...baseContext,
        source: 'windows-diagnostics',
        raw: {
          failedProvider: diagnostics.bridgeFailure.provider,
          message: diagnostics.bridgeFailure.message,
          fallbackProvider: diagnostics.provider,
        },
      }),
    );
  }
  if (!diagnostics.ok && diagnostics.error) {
    warnings.push(
      printErrorClassifier.create('DIAGNOSTICS_BRIDGE_FAILED', {
        ...baseContext,
        source: 'windows-diagnostics',
        raw: {
          provider: diagnostics.provider,
          message: diagnostics.error,
        },
      }),
    );
  }

  if (
    diagnostics.spooler.status &&
    diagnostics.spooler.status.toLowerCase() !== 'running'
  ) {
    return {
      blocker: printErrorClassifier.create('SPOOLER_SERVICE_STOPPED', {
        ...baseContext,
        source: 'windows-diagnostics',
        raw: {
          provider: diagnostics.provider,
          spoolerStatus: diagnostics.spooler.status,
        },
      }),
      warnings,
      diagnostics,
      estimatedSheets,
    };
  }

  const configuredPrinterName = getConfiguredPrinterName();
  if (
    configuredPrinterName &&
    input.printerName &&
    normalizeComparable(configuredPrinterName) !==
      normalizeComparable(input.printerName)
  ) {
    return {
      blocker: printErrorClassifier.create('WRONG_PRINTER_SELECTED', {
        ...baseContext,
        source: 'confirm-payment-preflight',
        raw: {
          configuredPrinterName,
          selectedPrinterName: input.printerName,
        },
      }),
      warnings,
      diagnostics,
      estimatedSheets,
    };
  }

  const selectedPrinter = findSelectedPrinter(diagnostics, input.printerName);
  if (
    input.printerName &&
    !selectedPrinter &&
    diagnostics.printers.length > 0
  ) {
    return {
      blocker: printErrorClassifier.create('WRONG_PRINTER_SELECTED', {
        ...baseContext,
        source: 'windows-diagnostics',
        raw: {
          selectedPrinterName: input.printerName,
          installedPrinters: diagnostics.printers
            .map((printer) => printer.name)
            .join(','),
        },
      }),
      warnings,
      diagnostics,
      estimatedSheets,
    };
  }

  const duplicates = sameNamedPrinters(diagnostics, input.printerName);
  if (duplicates.length > 1) {
    warnings.push(
      printErrorClassifier.create('GHOST_PRINTER_DETECTED', {
        ...baseContext,
        source: 'windows-diagnostics',
        raw: {
          selectedPrinterName: input.printerName,
          duplicateCount: duplicates.length,
          duplicatePorts: duplicates
            .map((printer) => printer.portName ?? 'unknown')
            .join(','),
        },
      }),
    );
  }

  if (selectedPrinter) {
    if (
      input.printOptions.duplex === true &&
      selectedPrinter.capabilities.supportsDuplex === false
    ) {
      return {
        blocker: printErrorClassifier.create('DUPLEX_UNSUPPORTED', {
          ...baseContext,
          source: 'windows-diagnostics',
          raw: {
            printerName: selectedPrinter.name,
            supportsDuplex: false,
          },
        }),
        warnings,
        diagnostics,
        estimatedSheets,
      };
    }

    if (
      input.printOptions.colorMode === 'colored' &&
      selectedPrinter.capabilities.supportsColor === false
    ) {
      return {
        blocker: printErrorClassifier.create('COLOR_MODE_MISMATCH', {
          ...baseContext,
          source: 'windows-diagnostics',
          raw: {
            printerName: selectedPrinter.name,
            supportsColor: false,
          },
        }),
        warnings,
        diagnostics,
        estimatedSheets,
      };
    }

    const paperSupported = printerSupportsPaper(
      selectedPrinter,
      input.printOptions.paperSize,
    );
    if (paperSupported === false) {
      return {
        blocker: printErrorClassifier.create('PAPER_SIZE_UNSUPPORTED', {
          ...baseContext,
          source: 'windows-diagnostics',
          raw: {
            printerName: selectedPrinter.name,
            requestedPaperSize: input.printOptions.paperSize,
            supportedPaperSizes:
              selectedPrinter.capabilities.paperSizes.join(','),
          },
        }),
        warnings,
        diagnostics,
        estimatedSheets,
      };
    }
  }

  return {
    blocker: null,
    warnings,
    diagnostics,
    estimatedSheets,
  };
}
