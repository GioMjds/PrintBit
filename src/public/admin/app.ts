export {};

type SummaryResponse = {
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
  };
  storage: {
    fileCount: number;
    bytes: number;
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
  };
};

type SettingsResponse = {
  pricing: {
    printPerPage: number;
    copyPerPage: number;
    colorSurcharge: number;
  };
  idleTimeoutSeconds: number;
  adminPin: string;
  adminLocalOnly: boolean;
};

type LogsResponse = {
  logs: Array<{
    id: string;
    timestamp: string;
    type: string;
    message: string;
  }>;
};

const authView = document.getElementById("adminAuthView") as HTMLElement;
const dashboard = document.getElementById("adminDashboard") as HTMLElement;
const authForm = document.getElementById("adminAuthForm") as HTMLFormElement;
const pinInput = document.getElementById("adminPinInput") as HTMLInputElement;
const messageEl = document.getElementById("adminMessage") as HTMLElement;
const logsBody = document.getElementById("logsBody") as HTMLElement;
const settingsForm = document.getElementById("settingsForm") as HTMLFormElement;

const refreshBtn = document.getElementById("refreshBtn") as HTMLButtonElement;
const exportLogsBtn = document.getElementById("exportLogsBtn") as HTMLButtonElement;
const logoutBtn = document.getElementById("logoutBtn") as HTMLButtonElement;
const resetBalanceBtn = document.getElementById("resetBalanceBtn") as HTMLButtonElement;
const clearStorageBtn = document.getElementById("clearStorageBtn") as HTMLButtonElement;

const metricBalance = document.getElementById("metricBalance") as HTMLElement;
const earningsToday = document.getElementById("earningsToday") as HTMLElement;
const earningsWeek = document.getElementById("earningsWeek") as HTMLElement;
const earningsAll = document.getElementById("earningsAll") as HTMLElement;
const jobsTotal = document.getElementById("jobsTotal") as HTMLElement;
const jobsPrint = document.getElementById("jobsPrint") as HTMLElement;
const jobsCopy = document.getElementById("jobsCopy") as HTMLElement;
const coins1 = document.getElementById("coins1") as HTMLElement;
const coins5 = document.getElementById("coins5") as HTMLElement;
const coins10 = document.getElementById("coins10") as HTMLElement;
const coins20 = document.getElementById("coins20") as HTMLElement;
const storageFiles = document.getElementById("storageFiles") as HTMLElement;
const storageBytes = document.getElementById("storageBytes") as HTMLElement;
const serverStatus = document.getElementById("serverStatus") as HTMLElement;
const hostStatus = document.getElementById("hostStatus") as HTMLElement;
const wifiStatus = document.getElementById("wifiStatus") as HTMLElement;
const serialStatus = document.getElementById("serialStatus") as HTMLElement;
const serialPortStatus = document.getElementById("serialPortStatus") as HTMLElement;

const settingPrintPerPage = document.getElementById("settingPrintPerPage") as HTMLInputElement;
const settingCopyPerPage = document.getElementById("settingCopyPerPage") as HTMLInputElement;
const settingColorSurcharge = document.getElementById("settingColorSurcharge") as HTMLInputElement;
const settingIdleTimeout = document.getElementById("settingIdleTimeout") as HTMLInputElement;
const settingAdminPin = document.getElementById("settingAdminPin") as HTMLInputElement;
const settingAdminLocalOnly = document.getElementById("settingAdminLocalOnly") as HTMLInputElement;

let adminPin = sessionStorage.getItem("printbit.adminPin") ?? "";
let refreshTimer: number | null = null;

function setMessage(text: string): void {
  messageEl.textContent = text;
}

function peso(value: number): string {
  return `₱ ${value.toFixed(2)}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  headers.set("x-admin-pin", adminPin);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  return fetch(path, { ...init, headers });
}

async function ensureAuth(): Promise<boolean> {
  if (!adminPin) return false;

  const response = await fetch("/api/admin/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: adminPin }),
  });

  return response.ok;
}

function showDashboard(isVisible: boolean): void {
  authView.classList.toggle("hidden", isVisible);
  dashboard.classList.toggle("hidden", !isVisible);
}

function applySummary(summary: SummaryResponse): void {
  metricBalance.textContent = peso(summary.balance);
  earningsToday.textContent = peso(summary.earnings.today);
  earningsWeek.textContent = peso(summary.earnings.week);
  earningsAll.textContent = peso(summary.earnings.allTime);
  jobsTotal.textContent = String(summary.jobStats.total);
  jobsPrint.textContent = String(summary.jobStats.print);
  jobsCopy.textContent = String(summary.jobStats.copy);
  coins1.textContent = String(summary.coinStats.one);
  coins5.textContent = String(summary.coinStats.five);
  coins10.textContent = String(summary.coinStats.ten);
  coins20.textContent = String(summary.coinStats.twenty);
  storageFiles.textContent = String(summary.storage.fileCount);
  storageBytes.textContent = formatBytes(summary.storage.bytes);
  serverStatus.textContent = summary.status.serverRunning ? "Running" : "Down";
  hostStatus.textContent = summary.status.host;
  wifiStatus.textContent = summary.status.wifiActive ? "Active" : "Inactive";
  serialStatus.textContent = summary.status.serial.connected ? "Connected" : "Disconnected";
  serialPortStatus.textContent = summary.status.serial.portPath ?? "-";
}

function applySettings(settings: SettingsResponse): void {
  settingPrintPerPage.value = settings.pricing.printPerPage.toFixed(2);
  settingCopyPerPage.value = settings.pricing.copyPerPage.toFixed(2);
  settingColorSurcharge.value = settings.pricing.colorSurcharge.toFixed(2);
  settingIdleTimeout.value = String(settings.idleTimeoutSeconds);
  settingAdminPin.value = settings.adminPin;
  settingAdminLocalOnly.checked = settings.adminLocalOnly;
}

function applyLogs(logs: LogsResponse["logs"]): void {
  logsBody.innerHTML = "";
  for (const log of logs) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(log.timestamp).toLocaleString()}</td>
      <td>${log.type}</td>
      <td>${log.message}</td>
    `;
    logsBody.appendChild(tr);
  }
}

async function loadDashboardData(): Promise<void> {
  const [summaryRes, settingsRes, logsRes] = await Promise.all([
    apiFetch("/api/admin/summary"),
    apiFetch("/api/admin/settings"),
    apiFetch("/api/admin/logs?limit=120"),
  ]);

  if (!summaryRes.ok || !settingsRes.ok || !logsRes.ok) {
    if (summaryRes.status === 401 || settingsRes.status === 401 || logsRes.status === 401) {
      throw new Error("Invalid admin PIN.");
    }
    throw new Error("Failed to load admin data.");
  }

  const summary = (await summaryRes.json()) as SummaryResponse;
  const settings = (await settingsRes.json()) as SettingsResponse;
  const logs = (await logsRes.json()) as LogsResponse;
  applySummary(summary);
  applySettings(settings);
  applyLogs(logs.logs);
}

async function unlockDashboard(pin: string): Promise<void> {
  adminPin = pin;
  const ok = await ensureAuth();
  if (!ok) {
    throw new Error("Invalid admin PIN.");
  }

  sessionStorage.setItem("printbit.adminPin", adminPin);
  showDashboard(true);
  await loadDashboardData();

  if (refreshTimer !== null) window.clearInterval(refreshTimer);
  refreshTimer = window.setInterval(() => {
    void loadDashboardData();
  }, 10000);
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const pin = pinInput.value.trim();
  if (!pin) {
    setMessage("Please enter admin PIN.");
    return;
  }

  setMessage("Unlocking admin panel...");
  void unlockDashboard(pin)
    .then(() => setMessage("Admin panel unlocked."))
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed to unlock admin panel.";
      setMessage(msg);
      showDashboard(false);
    });
});

refreshBtn.addEventListener("click", () => {
  setMessage("Refreshing dashboard...");
  void loadDashboardData()
    .then(() => setMessage("Dashboard refreshed."))
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "Refresh failed.";
      setMessage(msg);
    });
});

settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const payload = {
    pricing: {
      printPerPage: Number(settingPrintPerPage.value),
      copyPerPage: Number(settingCopyPerPage.value),
      colorSurcharge: Number(settingColorSurcharge.value),
    },
    idleTimeoutSeconds: Number(settingIdleTimeout.value),
    adminPin: settingAdminPin.value.trim(),
    adminLocalOnly: settingAdminLocalOnly.checked,
  };

  setMessage("Saving settings...");
  void apiFetch("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  })
    .then(async (response) => {
      if (!response.ok) {
        const body = (await response.json()) as { error?: string };
        throw new Error(body.error ?? "Failed to save settings.");
      }
      adminPin = payload.adminPin;
      sessionStorage.setItem("printbit.adminPin", adminPin);
      await loadDashboardData();
      setMessage("Settings saved.");
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed to save settings.";
      setMessage(msg);
    });
});

resetBalanceBtn.addEventListener("click", () => {
  if (!window.confirm("Reset machine balance to 0?")) return;
  setMessage("Resetting balance...");
  void apiFetch("/api/admin/balance/reset", { method: "POST" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Failed to reset balance.");
      await loadDashboardData();
      setMessage("Balance reset.");
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed to reset balance.";
      setMessage(msg);
    });
});

clearStorageBtn.addEventListener("click", () => {
  if (!window.confirm("Clear uploaded files in storage?")) return;
  setMessage("Clearing storage...");
  void apiFetch("/api/admin/storage/clear", { method: "POST" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Failed to clear storage.");
      await loadDashboardData();
      setMessage("Storage cleared.");
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed to clear storage.";
      setMessage(msg);
    });
});

exportLogsBtn.addEventListener("click", () => {
  setMessage("Preparing logs export...");
  void apiFetch("/api/admin/logs/export.csv")
    .then(async (response) => {
      if (!response.ok) throw new Error("Failed to export logs.");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `printbit-admin-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage("Logs exported.");
    })
    .catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : "Failed to export logs.";
      setMessage(msg);
    });
});

logoutBtn.addEventListener("click", () => {
  sessionStorage.removeItem("printbit.adminPin");
  adminPin = "";
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  showDashboard(false);
  setMessage("Admin panel locked.");
});

void (async () => {
  if (!adminPin) {
    showDashboard(false);
    return;
  }

  try {
    await unlockDashboard(adminPin);
    setMessage("Admin panel unlocked.");
  } catch {
    sessionStorage.removeItem("printbit.adminPin");
    adminPin = "";
    showDashboard(false);
  }
})();
