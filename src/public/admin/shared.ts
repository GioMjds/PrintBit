export type InkTankEstimate = {
  pagesUsed: number;
  maxPages: number;
  remainingPercent: number;
  alertTriggered: boolean;
};

export type SummaryResponse = {
  balance: number;
  earnings: {
    today: number;
    week: number;
    allTime: number;
  };
  coinStats: {
    one: number;
    five: number;
    ten: number;
    twenty: number;
  };
  jobStats: {
    total: number;
    print: number;
    copy: number;
    scan: number;
  };
  hopperStats: {
    dispenseAttempts: number;
    dispenseSuccess: number;
    dispenseFailures: number;
    totalDispensed: number;
    lastDispensedAt: string | null;
    lastError: string | null;
    selfTestPassed: boolean | null;
    lastSelfTestAt: string | null;
  };
  owedChangeOpenCount: number;
  pendingRefundOpenCount: number;
  refundStats: {
    totalCount: number;
    openCount: number;
    refundedCount: number;
    dismissedCount: number;
    autoRefundedCount: number;
  };
  anomalyStats: {
    totalCount: number;
    openCount: number;
  };
  recoveryStats?: {
    bootCount: number;
    unexpectedRestartCount: number;
    lastStartupAt: string | null;
    lastShutdownAt: string | null;
    inFlightCount: number;
    startupPendingCount: number;
    autoRefundedCount: number;
    pendingAdminReviewCount: number;
    voidedCount: number;
  };
  jamStats: {
    totalEvents: number;
    recent24h: number;
    lastJamAt: string | null;
  };
  consumables?: {
    generatedAt: string;
    rollingWindowDays: number;
    alertDaysThreshold: number;
    paper: {
      status: 'ok' | 'insufficient_data' | 'telemetry_unavailable';
      confidence: 'high' | 'medium' | 'low';
      currentSheets: number;
      trayCapacitySheets: number;
      avgDailyUse: number | null;
      daysRemaining: number | null;
      projectedEmptyAt: string | null;
      usageEventsConsidered: number;
    };
    inkSupplies: Array<{
      printerName: string;
      name: string;
      status: 'ok' | 'insufficient_data' | 'telemetry_unavailable';
      supplyStatus: 'ok' | 'low' | 'empty' | 'unknown';
      confidence: 'high' | 'medium' | 'low';
      level: number | null;
      avgDailyDrop: number | null;
      daysRemaining: number | null;
      projectedEmptyAt: string | null;
      snapshotsConsidered: number;
      detectionMethod:
        | 'snmp'
        | 'vendor-wmi'
        | 'printer-property'
        | 'error-state'
        | 'none';
    }>;
    alerts: {
      withinThreshold: boolean;
      reasons: string[];
    };
  };
  storage: {
    fileCount: number;
    bytes: number;
  };
  // Page counts (per-day totals and all-time totals)
  pageCounts?: {
    todayColorPages: number;
    todayBwPages: number;
    totalColorPages: number;
    totalBwPages: number;
    refillColorPages: number;
    refillBwPages: number;
    lastRefillAt: string | null;
  };
  // Page-count-based ink depletion estimation
  inkEstimation?: {
    grayscale: InkTankEstimate;
    color: InkTankEstimate;
    alertThresholdPercent: number;
    anyAlertTriggered: boolean;
  };
  status: {
    serverRunning: boolean;
    uptimeSeconds: number;
    host: string;
    wifiActive: boolean;
    serial: {
      connected: boolean;
      portPath: string | null;
      lastError: string | null;
    };
    hopper: {
      connected: boolean;
      pending: boolean;
      portPath: string | null;
      lastError: string | null;
      lastSuccessAt: string | null;
    };
    watchdog?: {
      running: boolean;
      watchdogPid: number | null;
      consecutiveFailures: number;
      recoveryAttempts: number;
      backoffDelayMs: number;
      nextRecoveryAt: string | null;
      lastAction: string;
      lastError: string | null;
      lastUpdatedAt: string;
    };
    printer: {
      connected: boolean;
      name: string | null;
      driverName: string | null;
      portName: string | null;
      connectionType?: 'usb' | 'network' | 'wsd' | 'virtual' | 'unknown';
      status: string;
      statusFlags?: string[];
      ink: Array<{
        name: string;
        level: number | null;
        status: 'ok' | 'low' | 'empty' | 'unknown';
      }>;
      inkDetectionMethod?:
        | 'snmp'
        | 'vendor-wmi'
        | 'printer-property'
        | 'error-state'
        | 'none';
      targetPrinterName?: string | null;
      targetIsDefault?: boolean;
      inkTelemetryAvailable?: boolean;
      inkTelemetryReason?: string | null;
      lastCheckedAt: string;
      lastError: string | null;
    };
  };
};

export type SettingsResponse = {
  pricing: {
    printPerPage: number;
    copyPerPage: number;
    scanDocument: number;
    colorSurcharge: number;
    highQualitySurcharge: number;
  };
  pricingEngine: {
    paperProfiles: {
      a4: { baseBwPrice: number; baseColorPrice: number };
      shortBond: { baseBwPrice: number; baseColorPrice: number };
      longBond: { baseBwPrice: number; baseColorPrice: number };
    };
    bulkDiscountTiers: Array<{
      minPages: number;
      maxPages?: number;
      discountPerPage: number;
    }>;
    rounding: 'whole_peso_total_only';
    highQualitySurcharge: number;
  };
  idleTimeoutSeconds: number;
  adminPin: string;
  adminLocalOnly: boolean;
  inkMonitoring: {
    enabled: boolean;
    targetPrinterName: string | null;
    lowThresholdPercent: number;
    criticalThresholdPercent: number;
    blockOnLow: boolean;
    blockOnEmpty: boolean;
    telemetryUnknownPolicy: 'warn_allow' | 'block';
  };
  consumablesForecasting: {
    enabled: boolean;
    rollingWindowDays: number;
    alertDaysThreshold: number;
    paperTrayCapacitySheets: number;
    paperCurrentSheets: number;
    paperRefillUpdatedAt: string | null;
  };
  alerts: {
    severityThreshold: 'warning' | 'critical';
    dashboard: {
      enabled: boolean;
    };
    email: {
      enabled: boolean;
      smtpHost: string;
      smtpPort: number;
      secure: boolean;
      username: string;
      from: string;
      to: string;
    };
    dedupe: {
      printerMs: number;
      spoolerMs: number;
      serialMs: number;
      hopperMs: number;
      networkMs: number;
      securityMs: number;
    };
  };
};

export type LogsResponse = {
  logs: Array<{
    id: string;
    timestamp: string;
    type: string;
    message: string;
    meta?: Record<string, string | number | boolean | null>;
  }>;
};

export type EarningsAnalyticsView = 'daily' | 'weekly' | 'monthly' | 'yearly';

export type EarningsAnalyticsResponse = {
  view: EarningsAnalyticsView;
  anchorDate: string;
  period: {
    start: string;
    end: string;
    label: string;
  };
  totals: {
    today: number;
    week: number;
    month: number;
    year: number;
    allTime: number;
    period: number;
  };
  buckets: Array<{
    key: string;
    label: string;
    start: string;
    end: string;
    amount: number;
  }>;
  methods: {
    print: number;
    copy: number;
    scan: number;
    total: number;
    topMode: 'print' | 'copy' | 'scan' | null;
  };
};

// ── PIN state via sessionStorage ─────────────────────────────────

const PIN_KEY = 'printbit.adminPin';
const TOKEN_KEY = 'adminSessionToken';

export function getAdminPin(): string {
  return sessionStorage.getItem(PIN_KEY) ?? '';
}

export function setAdminPin(pin: string): void {
  sessionStorage.setItem(PIN_KEY, pin);
}

export function clearAdminPin(): void {
  sessionStorage.removeItem(PIN_KEY);
}

export function getAdminToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export function setAdminToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

// ── Utilities ────────────────────────────────────────────────────

export function peso(value: number): string {
  return `₱ ${value.toFixed(2)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function apiFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const token = getAdminToken();
  if (token) headers.set('x-admin-token', token);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(path, { ...init, headers, credentials: 'include' });
}

// ── Auth helpers ─────────────────────────────────────────────────

export async function ensureAuth(): Promise<boolean> {
  const headers = new Headers();
  const token = getAdminToken();
  if (token) headers.set('x-admin-token', token);

  const response = await fetch('/api/admin/verify', {
    method: 'POST',
    headers,
    credentials: 'include',
  });

  return response.ok;
}

let messageEl: HTMLElement | null = null;

function resolveVisibleMessageEl(): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll<HTMLElement>(
      '#adminMessage, #adminAuthError, #messageBanner, .auth-msg, .topbar__msg',
    ),
  );
  if (candidates.length === 0) return null;

  const isInsideHidden = (el: HTMLElement): boolean => {
    let curr: HTMLElement | null = el.parentElement;
    while (curr && curr !== document.body) {
      if (curr.classList.contains('hidden')) {
        return true;
      }
      curr = curr.parentElement;
    }
    return false;
  };

  const active = candidates.filter((el) => !isInsideHidden(el));
  if (active.length > 0) {
    const unhidden = active.find((el) => !el.classList.contains('hidden'));
    return unhidden ?? active[0];
  }

  return candidates[0];
}

export function setMessage(text: string): void {
  messageEl = resolveVisibleMessageEl();
  if (messageEl) {
    messageEl.textContent = text;
    if (text) {
      messageEl.classList.remove('hidden');
    } else if (
      messageEl.id === 'messageBanner' ||
      messageEl.id === 'adminAuthError'
    ) {
      messageEl.classList.add('hidden');
    }
  }
}

export type InitAuthOptions = {
  onSuccess: () => void | Promise<void>;
  formId?: string;
  errorId?: string;
  viewId?: string;
  mainId?: string;
  logoutId?: string;
};

export type InitAuthArg = (() => void | Promise<void>) | InitAuthOptions;

/**
 * Initialises the auth gate UI. Call once from each admin sub-page.
 *
 * @param arg – either an onSuccess callback or an InitAuthOptions configuration object.
 * @returns a cleanup function that stops the auto-refresh timer.
 */
export function initAuth(arg: InitAuthArg): () => void {
  const options: InitAuthOptions =
    typeof arg === 'function' ? { onSuccess: arg } : arg;

  const authView = document.getElementById(
    options.viewId ?? 'adminAuthView',
  ) as HTMLElement | null;
  const dashboard = document.getElementById(
    options.mainId ?? 'adminDashboard',
  ) as HTMLElement | null;
  const authForm = document.getElementById(
    options.formId ?? 'adminAuthForm',
  ) as HTMLFormElement | null;
  const pinInput =
    authForm?.querySelector<HTMLInputElement>(
      'input[type="password"], input[name="pin"], #adminPinInput',
    ) ??
    (document.getElementById('adminPinInput') as HTMLInputElement | null);
  const logoutBtn = document.getElementById(
    options.logoutId ?? 'logoutBtn',
  ) as HTMLButtonElement | null;

  function showDashboard(visible: boolean): void {
    if (authView) authView.classList.toggle('hidden', visible);
    if (dashboard) dashboard.classList.toggle('hidden', !visible);
  }

  async function unlock(pin: string): Promise<void> {
    const response = await fetch('/api/admin/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ pin }),
    });
    if (!response.ok) {
      let errorMessage = 'Invalid admin PIN.';
      try {
        const errorBody = (await response.json()) as unknown;
        if (
          errorBody &&
          typeof errorBody === 'object' &&
          'error' in errorBody &&
          typeof (errorBody as { error: unknown }).error === 'string' &&
          (errorBody as { error: string }).error.trim()
        ) {
          errorMessage = (errorBody as { error: string }).error;
        }
      } catch {
        // Ignore JSON parse errors and fall back to default message
      }
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as {
      ok: boolean;
      sessionToken?: string;
    };
    if (data.sessionToken) setAdminToken(data.sessionToken);

    showDashboard(true);
    await options.onSuccess();
  }

  if (authForm && pinInput) {
    authForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const pin = pinInput.value.trim();
      if (!pin) {
        setMessage('Please enter admin PIN.');
        return;
      }
      setMessage('Unlocking admin panel...');
      void unlock(pin)
        .then(() => setMessage('Admin panel unlocked.'))
        .catch((err: unknown) => {
          const msg =
            err instanceof Error ? err.message : 'Failed to unlock admin panel.';
          setMessage(msg);
          showDashboard(false);
        });
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      const token = getAdminToken();
      void fetch('/api/admin/logout', {
        method: 'POST',
        headers: { 'x-admin-token': token },
        credentials: 'include',
      }).finally(() => {
        clearAdminToken();
        showDashboard(false);
        setMessage('Admin panel locked.');
      });
    });
  }

  // On startup, check for an existing valid session (httpOnly cookie sent
  // automatically) and show the dashboard immediately if authenticated.
  void ensureAuth()
    .then((authenticated) => {
      if (authenticated) {
        showDashboard(true);
        return options.onSuccess();
      }
      showDashboard(false);
    })
    .catch(() => {
      showDashboard(false);
    });

  // Return no-op cleanup (pages manage their own timers)
  return () => {};
}
