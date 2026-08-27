export interface PrinterSelectionInput {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
  printerStatus: number;
  printerState: number;
}

export interface PrinterSelectionOption {
  value: string;
  label: string;
  details: string;
  isAutomatic: boolean;
  isDefault: boolean;
  available: boolean;
  selected: boolean;
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function printerDetails(printer: PrinterSelectionInput): string {
  const details = [printer.isDefault ? 'Windows default' : '', printer.portName]
    .filter(Boolean)
    .join(' · ');
  return details || 'Installed printer';
}

export function buildPrinterSelectionOptions(
  printers: PrinterSelectionInput[],
  targetPrinterName: string | null,
): PrinterSelectionOption[] {
  const normalizedTarget = normalizeName(targetPrinterName) || null;
  const uniquePrinters = new Map<string, PrinterSelectionInput>();

  for (const printer of printers) {
    const name = printer.name.trim();
    const key = normalizeName(name);
    if (!key) continue;

    const existing = uniquePrinters.get(key);
    if (!existing || (!existing.isDefault && printer.isDefault)) {
      uniquePrinters.set(key, { ...printer, name });
    }
  }

  const installedOptions = [...uniquePrinters.values()]
    .sort((left, right) => {
      if (left.isDefault !== right.isDefault) {
        return left.isDefault ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, {
        sensitivity: 'base',
      });
    })
    .map((printer) => ({
      value: printer.name,
      label: printer.name,
      details: printerDetails(printer),
      isAutomatic: false,
      isDefault: printer.isDefault,
      available: true,
      selected: normalizeName(printer.name) === normalizedTarget,
    }));

  const missingTargetOption =
    normalizedTarget &&
    !installedOptions.some((option) => option.selected)
      ? {
          value: targetPrinterName!.trim(),
          label: `${targetPrinterName!.trim()} (configured, not detected)`,
          details: 'Replace this target or choose Automatic',
          isAutomatic: false,
          isDefault: false,
          available: false,
          selected: true,
        }
      : null;

  const options: PrinterSelectionOption[] = [
    {
      value: '',
      label: 'Automatic (Windows default)',
      details: 'Uses the Windows default or the only physical printer',
      isAutomatic: true,
      isDefault: false,
      available: true,
      selected: normalizedTarget === null,
    },
    ...(missingTargetOption ? [missingTargetOption] : []),
    ...installedOptions,
  ];

  return options;
}
