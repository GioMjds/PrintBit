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
const settingIdleTimeout = document.getElementById(
  'settingIdleTimeout',
) as HTMLInputElement;
const settingAdminPin = document.getElementById(
  'settingAdminPin',
) as HTMLInputElement;
const settingAdminLocalOnly = document.getElementById(
  'settingAdminLocalOnly',
) as HTMLInputElement;
const alertSeverityThreshold = document.getElementById(
  'alertSeverityThreshold',
) as HTMLSelectElement;
const alertDashboardEnabled = document.getElementById(
  'alertDashboardEnabled',
) as HTMLInputElement;
const alertEmailEnabled = document.getElementById(
  'alertEmailEnabled',
) as HTMLInputElement;
const alertSmtpHost = document.getElementById('alertSmtpHost') as HTMLInputElement;
const alertSmtpPort = document.getElementById('alertSmtpPort') as HTMLInputElement;
const alertSmtpSecure = document.getElementById(
  'alertSmtpSecure',
) as HTMLInputElement;
const alertEmailUsername = document.getElementById(
  'alertEmailUsername',
) as HTMLInputElement;
const alertEmailPassword = document.getElementById(
  'alertEmailPassword',
) as HTMLInputElement;
const alertEmailFrom = document.getElementById('alertEmailFrom') as HTMLInputElement;
const alertEmailTo = document.getElementById('alertEmailTo') as HTMLInputElement;
const testEmailAlertBtn = document.getElementById(
  'testEmailAlertBtn',
) as HTMLButtonElement;
const openAlertBadge = document.getElementById('openAlertBadge') as HTMLElement;
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
  settingIdleTimeout.value = String(settings.idleTimeoutSeconds);
  settingAdminPin.value = '';
  settingAdminLocalOnly.checked = settings.adminLocalOnly;
  alertSeverityThreshold.value = settings.alerts.severityThreshold;
  alertDashboardEnabled.checked = settings.alerts.dashboard.enabled;
  alertEmailEnabled.checked = settings.alerts.email.enabled;
  alertSmtpHost.value = settings.alerts.email.smtpHost;
  alertSmtpPort.value = String(settings.alerts.email.smtpPort);
  alertSmtpSecure.checked = settings.alerts.email.secure;
  alertEmailUsername.value = settings.alerts.email.username;
  alertEmailPassword.value = settings.alerts.email.password;
  alertEmailFrom.value = settings.alerts.email.from;
  alertEmailTo.value = settings.alerts.email.to;
}

async function loadAlertStats(): Promise<void> {
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
  const payload = {
    pricing: {
      printPerPage: Number(settingPrintPerPage.value),
      copyPerPage: Number(settingCopyPerPage.value),
      scanDocument: Number(settingScanDocument.value),
      colorSurcharge: Number(settingColorSurcharge.value),
    },
    idleTimeoutSeconds: Number(settingIdleTimeout.value),
    ...(newPin ? { adminPin: newPin } : {}),
    adminLocalOnly: settingAdminLocalOnly.checked,
  };
  const alertPayload = {
    severityThreshold: alertSeverityThreshold.value,
    dashboard: {
      enabled: alertDashboardEnabled.checked,
    },
    email: {
      enabled: alertEmailEnabled.checked,
      smtpHost: alertSmtpHost.value.trim(),
      smtpPort: Number(alertSmtpPort.value),
      secure: alertSmtpSecure.checked,
      username: alertEmailUsername.value.trim(),
      password: alertEmailPassword.value,
      from: alertEmailFrom.value.trim(),
      to: alertEmailTo.value.trim(),
    },
  };

  setMessage('Saving settings...');
  void Promise.all([
    apiFetch('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
    apiFetch('/api/admin/alert-settings', {
      method: 'PUT',
      body: JSON.stringify(alertPayload),
    }),
  ])
    .then(async ([settingsResponse, alertsResponse]) => {
      if (!settingsResponse.ok) {
        const body = (await settingsResponse.json()) as { error?: string };
        throw new Error(body.error ?? 'Failed to save settings.');
      }
      if (!alertsResponse.ok) {
        const body = (await alertsResponse.json()) as { error?: string };
        throw new Error(body.error ?? 'Failed to save alert settings.');
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

testEmailAlertBtn.addEventListener('click', () => {
  setMessage('Sending test email alert...');
  void apiFetch('/api/admin/alert-settings/test', { method: 'POST' })
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
