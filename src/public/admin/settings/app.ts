import {
  SettingsResponse,
  apiFetch,
  setMessage,
  initAuth,
  setAdminPin,
} from '../shared';

const settingsForm = document.getElementById('settingsForm') as HTMLFormElement;
const settingPrintPerPage = document.getElementById(
  'settingPrintPerPage',
) as HTMLInputElement;
const settingCopyPerPage = document.getElementById(
  'settingCopyPerPage',
) as HTMLInputElement;
const settingScanDocument = document.getElementById(
  'settingScanDocument',
) as HTMLInputElement;
const settingColorSurcharge = document.getElementById(
  'settingColorSurcharge',
) as HTMLInputElement;
const settingAdminPin = document.getElementById(
  'settingAdminPin',
) as HTMLInputElement;
const settingAdminLocalOnly = document.getElementById(
  'settingAdminLocalOnly',
) as HTMLInputElement;
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

function applySettings(settings: SettingsResponse): void {
  settingPrintPerPage.value = String(settings.pricing.printPerPage);
  settingCopyPerPage.value = String(settings.pricing.copyPerPage);
  settingScanDocument.value = String(settings.pricing.scanDocument);
  settingColorSurcharge.value = String(settings.pricing.colorSurcharge);
  settingAdminPin.value = '';
  settingAdminLocalOnly.checked = settings.adminLocalOnly;

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
    setMessage('Current paper must be a whole number greater than or equal to 0.');
    return;
  }
  if (
    settingPaperCurrentSheets &&
    settingPaperTrayCapacitySheets &&
    paperCurrentSheets > paperTrayCapacitySheets
  ) {
    setMessage('Current paper cannot exceed tray capacity.');
    return;
  }

  const payload: Record<string, unknown> = {
    pricing: {
      printPerPage: Number(settingPrintPerPage.value),
      copyPerPage: Number(settingCopyPerPage.value),
      scanDocument: Number(settingScanDocument.value),
      colorSurcharge: Number(settingColorSurcharge.value),
    },
    ...(newPin ? { adminPin: newPin } : {}),
    adminLocalOnly: settingAdminLocalOnly.checked,
  };

  // Only include idleTimeoutSeconds if the field is present
  if (settingIdleTimeout) {
    payload.idleTimeoutSeconds = Number(settingIdleTimeout.value);
  }

  // Only include inkMonitoring if the section is present
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

  // Only send alert settings if the section is rendered in the DOM
  const alertSectionVisible = alertSeverityThreshold !== null;
  const alertPayload = alertSectionVisible ? buildAlertPayload() : null;

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
      let settingsError: string | null = null;
      let alertsError: string | null = null;

      if (!settingsResponse.ok) {
        const body = (await settingsResponse.json()) as { error?: string };
        settingsError = body.error ?? 'Failed to save settings.';
      }
      // alertsResponse is null when the section is hidden — skip validation
      if (alertsResponse !== null && !alertsResponse.ok) {
        const body = (await alertsResponse.json()) as { error?: string };
        alertsError = body.error ?? 'Failed to save alert settings.';
      }

      if (settingsError || alertsError) {
        if (
          settingsResponse.ok ||
          (alertsResponse !== null && alertsResponse.ok)
        ) {
          try {
            await loadData();
            await loadAlertStats();
          } catch (reloadError) {
            console.error(
              '[ADMIN_SETTINGS] Failed to resync after save error.',
              {
                error:
                  reloadError instanceof Error
                    ? reloadError.message
                    : String(reloadError),
              },
            );
          }
        }
        throw new Error(
          alertsError ?? settingsError ?? 'Failed to save settings.',
        );
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
