import { presentMaintenanceError } from '../../src/public/confirm/maintenance-view';

class FakeElement {
  private readonly attributes = new Map<string, string>();
  focused = false;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  focus(): void {
    this.focused = true;
  }
}

describe('maintenance error presentation', () => {
  test('replaces an already-visible success view with the maintenance resolution', () => {
    const thankYouOverlay = new FakeElement();
    const printerErrorBlock = new FakeElement();
    const maintenanceResolution = new FakeElement();
    const doneButton = new FakeElement();

    printerErrorBlock.setAttribute('hidden', '');
    maintenanceResolution.setAttribute('hidden', '');

    presentMaintenanceError({
      thankYouOverlay,
      printerErrorBlock,
      maintenanceResolution,
      doneButton,
    });

    expect(thankYouOverlay.hasAttribute('hidden')).toBe(true);
    expect(printerErrorBlock.hasAttribute('hidden')).toBe(false);
    expect(maintenanceResolution.hasAttribute('hidden')).toBe(false);
    expect(doneButton.focused).toBe(true);
  });
});
