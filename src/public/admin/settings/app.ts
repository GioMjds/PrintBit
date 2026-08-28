import {
  SettingsResponse,
  apiFetch,
  setMessage,
  initAuth,
  setAdminPin,
} from '../shared';

const settingsForm = document.getElementById('settingsForm') as HTMLFormElement;
const settingAdminPin = document.getElementById(
  'settingAdminPin',
) as HTMLInputElement;
const settingAdminLocalOnly = document.getElementById(
  'settingAdminLocalOnly',
) as HTMLInputElement | null;
const settingConsumablesForecastingEnabled = document.getElementById(
  'settingConsumablesForecastingEnabled',
) as HTMLInputElement | null;
const settingRollingWindowDays = document.getElementById(
  'settingRollingWindowDays',
) as HTMLInputElement | null;
const settingAlertDaysThreshold = document.getElementById(
  'settingAlertDaysThreshold',
) as HTMLInputElement | null;
const settingPaperTrayCapacitySheets = document.getElementById(
  'settingPaperTrayCapacitySheets',
) as HTMLInputElement | null;
const settingPaperCurrentSheets = document.getElementById(
  'settingPaperCurrentSheets',
) as HTMLInputElement | null;

// ── Pricing Engine settings ──────────────────
const settingA4BwPrice = document.getElementById(
  'settingA4BwPrice',
) as HTMLInputElement | null;
const settingA4ColorPrice = document.getElementById(
  'settingA4ColorPrice',
) as HTMLInputElement | null;
const settingShortBondBwPrice = document.getElementById(
  'settingShortBondBwPrice',
) as HTMLInputElement | null;
const settingShortBondColorPrice = document.getElementById(
  'settingShortBondColorPrice',
) as HTMLInputElement | null;
const settingLongBondBwPrice = document.getElementById(
  'settingLongBondBwPrice',
) as HTMLInputElement | null;
const settingLongBondColorPrice = document.getElementById(
  'settingLongBondColorPrice',
) as HTMLInputElement | null;
const settingScanDocument = document.getElementById(
  'settingScanDocument',
) as HTMLInputElement | null;
const settingHighQualitySurcharge = document.getElementById(
  'settingHighQualitySurcharge',
) as HTMLInputElement | null;

// ── Optional sections (may be commented out in HTML) ─────────────────────────
const settingIdleTimeout = document.getElementById(
  'settingIdleTimeout',
) as HTMLInputElement | null;
const inkMonitoringEnabled = document.getElementById(
  'inkMonitoringEnabled',
) as HTMLInputElement | null;
const inkTargetPrinterName = document.getElementById(
  'inkTargetPrinterName',
) as HTMLInputElement | null;
const inkLowThresholdPercent = document.getElementById(
  'inkLowThresholdPercent',
) as HTMLInputElement | null;
const inkCriticalThresholdPercent = document.getElementById(
  'inkCriticalThresholdPercent',
) as HTMLInputElement | null;
const inkBlockOnLow = document.getElementById(
  'inkBlockOnLow',
) as HTMLInputElement | null;
const inkBlockOnEmpty = document.getElementById(
  'inkBlockOnEmpty',
) as HTMLInputElement | null;
const inkTelemetryUnknownPolicy = document.getElementById(
  'inkTelemetryUnknownPolicy',
) as HTMLSelectElement | null;
const alertSeverityThreshold = document.getElementById(
  'alertSeverityThreshold',
) as HTMLSelectElement | null;
const alertDashboardEnabled = document.getElementById(
  'alertDashboardEnabled',
) as HTMLInputElement | null;
const alertEmailEnabled = document.getElementById(
  'alertEmailEnabled',
) as HTMLInputElement | null;
const alertSmtpHost = document.getElementById(
  'alertSmtpHost',
) as HTMLInputElement | null;
const alertSmtpPort = document.getElementById(
  'alertSmtpPort',
) as HTMLInputElement | null;
const alertSmtpSecure = document.getElementById(
  'alertSmtpSecure',
) as HTMLInputElement | null;
const alertEmailUsername = document.getElementById(
  'alertEmailUsername',
) as HTMLInputElement | null;
const alertEmailFrom = document.getElementById(
  'alertEmailFrom',
) as HTMLInputElement | null;
const alertEmailTo = document.getElementById(
  'alertEmailTo',
) as HTMLInputElement | null;
const testEmailAlertBtn = document.getElementById(
  'testEmailAlertBtn',
) as HTMLButtonElement | null;
const openAlertBadge = document.getElementById(
  'openAlertBadge',
) as HTMLElement | null;
const openAlertBadgeMob = document.getElementById(
  'openAlertBadgeMob',
) as HTMLElement | null;

const refreshBtn = document.getElementById('refreshBtn') as HTMLButtonElement;
let refreshTimer: number | null = null;
let loadedAdminLocalOnly: boolean = false;

function applySettings(settings: SettingsResponse): void {
  settingAdminPin.value = '';
  loadedAdminLocalOnly = settings.adminLocalOnly;
  if (settingAdminLocalOnly) {
    settingAdminLocalOnly.checked = settings.adminLocalOnly;
  }

  // Kiosk Behaviour (optional)
  if (settingIdleTimeout) {
    settingIdleTimeout.value = String(settings.idleTimeoutSeconds);
  }

  // Ink Monitoring (optional)
  if (inkMonitoringEnabled)
    inkMonitoringEnabled.checked = settings.inkMonitoring.enabled;
  if (inkTargetPrinterName)
    inkTargetPrinterName.value = settings.inkMonitoring.targetPrinterName ?? '';
  if (inkLowThresholdPercent)
    inkLowThresholdPercent.value = String(
      settings.inkMonitoring.lowThresholdPercent,
    );
  if (inkCriticalThresholdPercent)
    inkCriticalThresholdPercent.value = String(
      settings.inkMonitoring.criticalThresholdPercent,
    );
  if (inkBlockOnLow) inkBlockOnLow.checked = settings.inkMonitoring.blockOnLow;
  if (inkBlockOnEmpty)
    inkBlockOnEmpty.checked = settings.inkMonitoring.blockOnEmpty;
  if (inkTelemetryUnknownPolicy)
    inkTelemetryUnknownPolicy.value =
      settings.inkMonitoring.telemetryUnknownPolicy;

  if (settingConsumablesForecastingEnabled)
    settingConsumablesForecastingEnabled.checked =
      settings.consumablesForecasting.enabled;
  if (settingRollingWindowDays)
    settingRollingWindowDays.value = String(
      settings.consumablesForecasting.rollingWindowDays,
    );
  if (settingAlertDaysThreshold)
    settingAlertDaysThreshold.value = String(
      settings.consumablesForecasting.alertDaysThreshold,
    );
  if (settingPaperTrayCapacitySheets)
    settingPaperTrayCapacitySheets.value = String(
      settings.consumablesForecasting.paperTrayCapacitySheets,
    );
  if (settingPaperCurrentSheets)
    settingPaperCurrentSheets.value = String(
      settings.consumablesForecasting.paperCurrentSheets,
    );

  // Pricing Configuration
  if (settingA4BwPrice) {
    settingA4BwPrice.value = String(
      settings.pricingEngine.paperProfiles.a4.baseBwPrice,
    );
  }
  if (settingA4ColorPrice) {
    settingA4ColorPrice.value = String(
      settings.pricingEngine.paperProfiles.a4.baseColorPrice,
    );
  }
  if (settingShortBondBwPrice) {
    settingShortBondBwPrice.value = String(
      settings.pricingEngine.paperProfiles.shortBond.baseBwPrice,
    );
  }
  if (settingShortBondColorPrice) {
    settingShortBondColorPrice.value = String(
      settings.pricingEngine.paperProfiles.shortBond.baseColorPrice,
    );
  }
  if (settingLongBondBwPrice) {
    settingLongBondBwPrice.value = String(
      settings.pricingEngine.paperProfiles.longBond.baseBwPrice,
    );
  }
  if (settingLongBondColorPrice) {
    settingLongBondColorPrice.value = String(
      settings.pricingEngine.paperProfiles.longBond.baseColorPrice,
    );
  }
  if (settingScanDocument) {
    settingScanDocument.value = String(settings.pricing.scanDocument);
  }
  if (settingHighQualitySurcharge) {
    settingHighQualitySurcharge.value = String(
      settings.pricingEngine?.highQualitySurcharge ??
        settings.pricing?.highQualitySurcharge ??
        2,
    );
  }

  // Admin Alerts (optional)
  if (alertSeverityThreshold)
    alertSeverityThreshold.value = settings.alerts.severityThreshold;
  if (alertDashboardEnabled)
    alertDashboardEnabled.checked = settings.alerts.dashboard.enabled;
  if (alertEmailEnabled)
    alertEmailEnabled.checked = settings.alerts.email.enabled;
  if (alertSmtpHost) alertSmtpHost.value = settings.alerts.email.smtpHost;
  if (alertSmtpPort)
    alertSmtpPort.value = String(settings.alerts.email.smtpPort);
  if (alertSmtpSecure) alertSmtpSecure.checked = settings.alerts.email.secure;
  if (alertEmailUsername)
    alertEmailUsername.value = settings.alerts.email.username;
  if (alertEmailFrom) alertEmailFrom.value = settings.alerts.email.from;
  if (alertEmailTo) alertEmailTo.value = settings.alerts.email.to;
}

function buildAlertPayload(): {
  severityThreshold: string;
  dashboard: { enabled: boolean };
  email: {
    enabled: boolean;
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    username: string;
    from: string;
    to: string;
  };
} {
  return {
    severityThreshold: alertSeverityThreshold?.value ?? 'warning',
    dashboard: {
      enabled: alertDashboardEnabled?.checked ?? false,
    },
    email: {
      enabled: alertEmailEnabled?.checked ?? false,
      smtpHost: alertSmtpHost?.value.trim() ?? '',
      smtpPort: Number(alertSmtpPort?.value ?? 0),
      secure: alertSmtpSecure?.checked ?? false,
      username: alertEmailUsername?.value.trim() ?? '',
      from: alertEmailFrom?.value.trim() ?? '',
      to: alertEmailTo?.value.trim() ?? '',
    },
  };
}

async function loadAlertStats(): Promise<void> {
  if (!openAlertBadge) return; // section is hidden, skip entirely
  const res = await apiFetch('/api/admin/anomaly-incidents?limit=1');
  if (!res.ok) return;
  const payload = (await res.json()) as { openCount?: number };
  const openCount =
    typeof payload.openCount === 'number' && payload.openCount > 0
      ? String(payload.openCount)
      : '';
  openAlertBadge.textContent = openCount;
  if (openAlertBadgeMob) openAlertBadgeMob.textContent = openCount;
}

async function loadData(): Promise<void> {
  const res = await apiFetch('/api/admin/settings');
  if (!res.ok) {
    if (res.status === 401) throw new Error('Invalid admin PIN.');
    throw new Error('Failed to load settings.');
  }
  const settings = (await res.json()) as SettingsResponse;
  applySettings(settings);
}

settingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const newPin = settingAdminPin.value.trim();

  // Ink monitoring validation — only when the section is present
  const lowThreshold = Number(inkLowThresholdPercent?.value ?? 0);
  const criticalThreshold = Number(inkCriticalThresholdPercent?.value ?? 0);

  if (inkLowThresholdPercent && inkCriticalThresholdPercent) {
    const isValidPercent = (n: number): boolean =>
      Number.isInteger(n) && n >= 0 && n <= 100;

    if (!isValidPercent(lowThreshold) || !isValidPercent(criticalThreshold)) {
      setMessage('Ink thresholds must be whole numbers from 0 to 100.');
      return;
    }
    if (criticalThreshold > lowThreshold) {
      setMessage(
        'Critical threshold must be less than or equal to low threshold.',
      );
      return;
    }
  }

  const rollingWindowDays = Number(settingRollingWindowDays?.value ?? 0);
  const alertDaysThreshold = Number(settingAlertDaysThreshold?.value ?? 0);
  const paperTrayCapacitySheets = Number(
    settingPaperTrayCapacitySheets?.value ?? 0,
  );
  const paperCurrentSheets = Number(settingPaperCurrentSheets?.value ?? 0);

  if (
    settingRollingWindowDays &&
    (!Number.isInteger(rollingWindowDays) ||
      rollingWindowDays < 1 ||
      rollingWindowDays > 90)
  ) {
    setMessage('Rolling window must be a whole number between 1 and 90.');
    return;
  }
  if (
    settingAlertDaysThreshold &&
    (!Number.isInteger(alertDaysThreshold) ||
      alertDaysThreshold < 1 ||
      alertDaysThreshold > 60)
  ) {
    setMessage('Alert threshold must be a whole number between 1 and 60.');
    return;
  }
  if (
    settingPaperTrayCapacitySheets &&
    (!Number.isInteger(paperTrayCapacitySheets) || paperTrayCapacitySheets < 1)
  ) {
    setMessage('Tray capacity must be a whole number greater than 0.');
    return;
  }
  if (
    settingPaperCurrentSheets &&
    (!Number.isInteger(paperCurrentSheets) || paperCurrentSheets < 0)
  ) {
    setMessage(
      'Current paper must be a whole number greater than or equal to 0.',
    );
    return;
  }

  // Pricing configuration values
  const a4BwPrice = Number(settingA4BwPrice?.value ?? 0);
  const a4ColorPrice = Number(settingA4ColorPrice?.value ?? 0);
  const shortBondBwPrice = Number(settingShortBondBwPrice?.value ?? 0);
  const shortBondColorPrice = Number(settingShortBondColorPrice?.value ?? 0);
  const longBondBwPrice = Number(settingLongBondBwPrice?.value ?? 0);
  const longBondColorPrice = Number(settingLongBondColorPrice?.value ?? 0);
  const scanDocumentPrice = Number(settingScanDocument?.value ?? 0);
  const highQualitySurcharge = Number(settingHighQualitySurcharge?.value ?? 0);

  if (
    settingHighQualitySurcharge &&
    (!Number.isFinite(highQualitySurcharge) || highQualitySurcharge < 0)
  ) {
    setMessage(
      'High quality surcharge must be a number greater than or equal to 0.',
    );
    return;
  }

  const payload: Record<string, unknown> = {
    pricing: {
      printPerPage: shortBondBwPrice,
      scanDocument: scanDocumentPrice,
      colorSurcharge: shortBondColorPrice - shortBondBwPrice,
      highQualitySurcharge,
    },
    pricingEngine: {
      paperProfiles: {
        a4: {
          baseBwPrice: a4BwPrice,
          baseColorPrice: a4ColorPrice,
        },
        shortBond: {
          baseBwPrice: shortBondBwPrice,
          baseColorPrice: shortBondColorPrice,
        },
        longBond: {
          baseBwPrice: longBondBwPrice,
          baseColorPrice: longBondColorPrice,
        },
      },
      highQualitySurcharge,
    },
    adminLocalOnly: settingAdminLocalOnly
      ? settingAdminLocalOnly.checked
      : loadedAdminLocalOnly,
    ...(newPin ? { adminPin: newPin } : {}),
  };

  if (settingIdleTimeout) {
    const idleTimeoutValue = Number(settingIdleTimeout.value);
    if (
      !Number.isInteger(idleTimeoutValue) ||
      idleTimeoutValue < 60 ||
      idleTimeoutValue > 3600
    ) {
      setMessage('Idle timeout must be a whole number between 60 and 3600 seconds.');
      return;
    }
    payload.idleTimeoutSeconds = idleTimeoutValue;
  }

  if (inkMonitoringEnabled) {
    payload.inkMonitoring = {
      enabled: inkMonitoringEnabled.checked,
      targetPrinterName: inkTargetPrinterName?.value.trim() || null,
      lowThresholdPercent: lowThreshold,
      criticalThresholdPercent: criticalThreshold,
      blockOnLow: inkBlockOnLow?.checked ?? false,
      blockOnEmpty: inkBlockOnEmpty?.checked ?? false,
      telemetryUnknownPolicy:
        inkTelemetryUnknownPolicy?.value === 'block' ? 'block' : 'warn_allow',
    };
  }

  if (settingConsumablesForecastingEnabled) {
    payload.consumablesForecasting = {
      enabled: settingConsumablesForecastingEnabled.checked,
      rollingWindowDays,
      alertDaysThreshold,
      paperTrayCapacitySheets,
      paperCurrentSheets,
    };
  }

  const alertPayload =
    alertSeverityThreshold !== null ? buildAlertPayload() : null;

  setMessage('Saving settings...');

  const settingsFetch = apiFetch('/api/admin/settings', {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  const alertsFetch = alertPayload
    ? apiFetch('/api/admin/alert-settings', {
        method: 'PUT',
        body: JSON.stringify(alertPayload),
      })
    : Promise.resolve(null);

  void Promise.all([settingsFetch, alertsFetch])
    .then(async ([settingsResponse, alertsResponse]) => {
      if (
        !settingsResponse.ok ||
        (alertsResponse !== null && !alertsResponse.ok)
      ) {
        throw new Error('Failed to save settings.');
      }
      if (newPin) setAdminPin(newPin);
      await loadData();
      await loadAlertStats();
      setMessage('Settings saved.');
    })
    .catch((error: unknown) => {
      const msg =
        error instanceof Error ? error.message : 'Failed to save settings.';
      setMessage(msg);
    });
});

refreshBtn.addEventListener('click', () => {
  setMessage('Refreshing...');
  void Promise.all([loadData(), loadAlertStats()])
    .then(() => setMessage('Settings refreshed.'))
    .catch((e: unknown) =>
      setMessage(e instanceof Error ? e.message : 'Refresh failed.'),
    );
});

testEmailAlertBtn?.addEventListener('click', () => {
  setMessage('Sending test email alert...');
  void apiFetch('/api/admin/alert-settings/test', {
    method: 'POST',
    body: JSON.stringify(buildAlertPayload()),
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? 'Failed to send test email alert.');
      }
      setMessage('Test email alert sent.');
    })
    .catch((error: unknown) => {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Failed to send test email alert.',
      );
    });
});

initAuth(async () => {
  await loadData();
  await loadAlertStats();
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void loadData();
    void loadAlertStats();
  }, 10_000);
});
