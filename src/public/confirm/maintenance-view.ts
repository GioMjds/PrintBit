interface HideableElement {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

interface FocusableElement {
  focus(): void;
}

export function presentMaintenanceError(input: {
  thankYouOverlay: HideableElement | null;
  printerErrorBlock: HideableElement | null;
  maintenanceResolution: HideableElement | null;
  doneButton: FocusableElement | null;
}): void {
  input.thankYouOverlay?.setAttribute('hidden', '');
  input.printerErrorBlock?.removeAttribute('hidden');
  input.maintenanceResolution?.removeAttribute('hidden');
  input.doneButton?.focus();
}
