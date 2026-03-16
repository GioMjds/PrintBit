import type { PricingSettings } from '@/state';
import { stateRepository } from './state-repository';

class SettingsRepository {
  getPricingSettings(): PricingSettings {
    return stateRepository.read((state) => state.settings.pricing);
  }

  getIdleTimeoutSeconds(): number {
    return stateRepository.read((state) => state.settings.idleTimeoutSeconds);
  }

  isAdminLocalOnly(): boolean {
    return stateRepository.read((state) => state.settings.adminLocalOnly);
  }

  getAdminPin(): string {
    return stateRepository.read((state) => state.settings.adminPin);
  }
}

export const settingsRepository = new SettingsRepository();
