export {};
import { initKioskLocalization } from '../shared/kiosk-i18n';

void initKioskLocalization();

declare global {
  interface Window {
    uploadToken?: string;
    io?: (options?: {
      auth?: { token?: string };
      transports?: string[];
      reconnectionDelay?: number;
    }) => SocketClient;
  }
}

interface SocketClient {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
  disconnect?: () => void;
}

type UploadState =
  | 'session-loading'
  | 'session-ready'
  | 'session-error'
  | 'uploading'
  | 'all-done';
type ItemStatus = 'pending' | 'uploading' | 'done' | 'error';
type SessionMode = 'PRINT' | 'SCAN' | 'COPY' | 'IDLE';

interface SessionResponse {
  sessionId: string;
  uploadUrl: string;
  status: 'pending' | 'uploaded';
  remainingSeconds?: number;
  warningThresholdSeconds?: number;
  ttlSeconds?: number;
  mode?: SessionMode;
  balance?: number;
}

interface UploadErrorResponse {
  code?: string;
  error?: string;
}

// ── DOM refs ──────────────────────────────────────────────────────────────────

const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;
const dropZone = document.getElementById('dropZone') as HTMLDivElement | null;
const fileQueue = document.getElementById('fileQueue') as HTMLDivElement | null;
const uploadButton = document.getElementById('uploadButton') as HTMLButtonElement | null;
const uploadBtnLabel = document.getElementById('uploadBtnLabel') as HTMLSpanElement | null;
const statusBox = document.getElementById('statusBox') as HTMLDivElement | null;
const sessionMetaUpload = document.getElementById('sessionMetaUpload') as HTMLSpanElement | null;
const sessionDotUpload = document.getElementById('sessionDotUpload') as HTMLSpanElement | null;
const sessionCountdownUpload = document.getElementById('sessionCountdownUpload') as HTMLSpanElement | null;
const retrySessionButton = document.getElementById('retrySessionButton') as HTMLButtonElement | null;
const uploadForm = document.getElementById('uploadForm') as HTMLFormElement | null;

// Badges
const portalBalanceText = document.getElementById('portalBalanceText') as HTMLSpanElement | null;
const portalModeText = document.getElementById('portalModeText') as HTMLSpanElement | null;

// Mode Views
const viewPrintMode = document.getElementById('viewPrintMode') as HTMLElement | null;
const viewScanMode = document.getElementById('viewScanMode') as HTMLElement | null;
const viewCopyMode = document.getElementById('viewCopyMode') as HTMLElement | null;
const viewIdleMode = document.getElementById('viewIdleMode') as HTMLElement | null;

// Scan Ready Card
const viewScanReady = document.getElementById('viewScanReady') as HTMLElement | null;
const scanReadyFilename = document.getElementById('scanReadyFilename') as HTMLElement | null;
const scanDownloadButton = document.getElementById('scanDownloadButton') as HTMLAnchorElement | null;

// Session Ended Card
const viewSessionEnded = document.getElementById('viewSessionEnded') as HTMLElement | null;
const sessionEndedChange = document.getElementById('sessionEndedChange') as HTMLElement | null;
const sessionEndedChangeText = document.getElementById('sessionEndedChangeText') as HTMLElement | null;

// ── State ─────────────────────────────────────────────────────────────────────

function extractToken(): string {
  if (
    typeof window.uploadToken === 'string' &&
    window.uploadToken !== '{{token}}' &&
    window.uploadToken.trim().length > 0
  ) {
    return window.uploadToken.trim();
  }

  const urlParams = new URLSearchParams(window.location.search);
  const queryToken = urlParams.get('token');
  if (queryToken && queryToken.trim().length > 0) {
    return queryToken.trim();
  }

  const parts = window.location.pathname.split('/').filter(Boolean);
  if (parts.length >= 2 && (parts[0] === 'upload' || parts[0] === 'portal')) {
    return parts[1].trim();
  }

  return '';
}

const token = extractToken();
const CLIENT_ID_STORAGE_KEY = 'printbit.uploadClientId';
const SESSION_MONITOR_INTERVAL_MS = 5000;
const DEFAULT_WARNING_SECONDS = 60;

let sessionId: string | null = null;
let currentMode: SessionMode = 'PRINT';
let appState: UploadState = 'session-loading';
let sessionWarningThresholdSeconds = DEFAULT_WARNING_SECONDS;
let monitorHandle: number | null = null;
let countdownBaselineSeconds: number | null = null;
let countdownSyncedAtMs: number | null = null;
let countdownHandle: number | null = null;
let isSessionUnavailable = false;
let socket: SocketClient | null = null;

function getOrCreateUploadClientId(): string {
  const generated =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing && existing.trim().length > 0) return existing;
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, generated);
  } catch {
    return generated;
  }
  return generated;
}

const uploadClientId = getOrCreateUploadClientId();

/** Files staged for upload — keyed by a local id */
interface QueuedFile {
  id: string;
  file: File;
  status: ItemStatus;
  el: HTMLElement;
}

const queue: QueuedFile[] = [];
let nextId = 0;

// ── UI View Helpers ───────────────────────────────────────────────────────────

function setSessionModeView(mode: SessionMode | string): void {
  const normalized = (mode ?? 'PRINT').toString().toUpperCase() as SessionMode;
  currentMode = normalized;

  if (portalModeText) {
    portalModeText.textContent = normalized;
  }

  if (viewPrintMode) viewPrintMode.classList.toggle('hidden', normalized !== 'PRINT');
  if (viewScanMode) viewScanMode.classList.toggle('hidden', normalized !== 'SCAN');
  if (viewCopyMode) viewCopyMode.classList.toggle('hidden', normalized !== 'COPY');
  if (viewIdleMode) viewIdleMode.classList.toggle('hidden', normalized !== 'IDLE');
}

function showScanReady(filename?: string): void {
  const safeFilename = filename && filename.trim() ? filename.trim() : 'PrintBit_Scan.pdf';
  if (scanReadyFilename) {
    scanReadyFilename.textContent = safeFilename;
  }

  if (scanDownloadButton) {
    const downloadUrl = `/session/download?token=${encodeURIComponent(token)}&filename=${encodeURIComponent(safeFilename)}`;
    scanDownloadButton.href = downloadUrl;
  }

  if (viewScanReady) {
    viewScanReady.classList.remove('hidden');
  }
}

function showSessionEnded(dispensedChange?: number, _reason?: string): void {
  if (viewPrintMode) viewPrintMode.classList.add('hidden');
  if (viewScanMode) viewScanMode.classList.add('hidden');
  if (viewCopyMode) viewCopyMode.classList.add('hidden');
  if (viewIdleMode) viewIdleMode.classList.add('hidden');

  if (viewSessionEnded) {
    viewSessionEnded.classList.remove('hidden');
  }

  if (portalBalanceText) {
    portalBalanceText.textContent = '0.00';
  }

  if (typeof dispensedChange === 'number' && dispensedChange > 0) {
    if (sessionEndedChangeText) {
      sessionEndedChangeText.textContent = `₱${dispensedChange.toFixed(2)} change dispensed at the kiosk. Please collect your coins.`;
    }
    if (sessionEndedChange) {
      sessionEndedChange.classList.remove('hidden');
    }
  } else if (sessionEndedChange) {
    sessionEndedChange.classList.add('hidden');
  }

  setSessionUI('Session ended', 'idle');
  stopSessionMonitor();
  stopSessionCountdownTicker();
}

function setAppState(s: UploadState): void {
  appState = s;
  const canUpload =
    s === 'session-ready' && queue.some((q) => q.status === 'pending');
  if (uploadButton) {
    uploadButton.disabled = !canUpload;
  }
}

function setStatus(msg: string, cls: 'info' | 'ok' | 'error' | ''): void {
  if (!statusBox) return;
  statusBox.textContent = msg;
  statusBox.className = cls ? `status-box ${cls}` : 'status-box';
}

function clearStatus(): void {
  setStatus('', '');
}

function setSessionUI(text: string, dot: 'idle' | 'active' | 'error'): void {
  if (sessionMetaUpload) sessionMetaUpload.textContent = text;
  if (sessionDotUpload) {
    sessionDotUpload.classList.remove('active', 'error');
    if (dot !== 'idle') sessionDotUpload.classList.add(dot);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? 'file';
}

function normalizeMimeByExtension(
  fileName: string,
  mimeType: string,
): string | null {
  const normalizedMime = mimeType.trim().toLowerCase();
  const ext = extOf(fileName);
  const extensionMimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  };

  if (normalizedMime !== '' && normalizedMime !== 'application/octet-stream') {
    return normalizedMime;
  }

  return extensionMimeMap[ext] ?? null;
}

function collectUnsupportedFiles(files: File[]): string[] {
  const allowedMimeTypes = new Set<string>([
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'image/jpeg',
    'image/png',
  ]);

  return files
    .filter((file) => {
      const normalized = normalizeMimeByExtension(file.name, file.type);
      return !normalized || !allowedMimeTypes.has(normalized);
    })
    .map((file) => file.name);
}

function mapError(r: UploadErrorResponse): string {
  switch (r.code) {
    case 'DUPLICATE_FILE':
      return 'This file was already sent in this session.';
    case 'INVALID_TOKEN':
      return 'Invalid session token. Please scan the QR code again.';
    case 'UNSUPPORTED_TYPE':
    case 'UNSUPPORTED_FILE_TYPE':
      return 'Unsupported file type. Please upload PDF, Word, Excel, PowerPoint, or image files.';
    case 'FILE_TOO_LARGE':
      return r.error ?? 'File exceeds the 25 MB limit.';
    case 'SESSION_NOT_FOUND':
      return 'Session not found. Please start a new session on the kiosk.';
    case 'SESSION_EXPIRED':
      return 'Session expired. Please start a new session on the kiosk.';
    case 'SESSION_OWNED':
      return 'This session is currently active on another device.';
    default:
      return r.error ?? 'Upload failed. Please try again.';
  }
}

function formatCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function stopSessionMonitor(): void {
  if (monitorHandle !== null) {
    window.clearInterval(monitorHandle);
    monitorHandle = null;
  }
}

function stopSessionCountdownTicker(): void {
  if (countdownHandle !== null) {
    window.clearInterval(countdownHandle);
    countdownHandle = null;
  }
}

function resetSessionCountdown(): void {
  stopSessionCountdownTicker();
  countdownBaselineSeconds = null;
  countdownSyncedAtMs = null;
  if (sessionCountdownUpload) {
    sessionCountdownUpload.classList.add('hidden');
    sessionCountdownUpload.textContent = '';
  }
}

function getCurrentRemainingSeconds(): number | null {
  if (countdownBaselineSeconds === null || countdownSyncedAtMs === null) {
    return null;
  }
  const elapsedSeconds = Math.floor((Date.now() - countdownSyncedAtMs) / 1000);
  return Math.max(0, countdownBaselineSeconds - elapsedSeconds);
}

function renderSessionRemainingTime(): void {
  const remainingSeconds = getCurrentRemainingSeconds();
  if (remainingSeconds === null) {
    if (sessionCountdownUpload) sessionCountdownUpload.classList.add('hidden');
    return;
  }

  if (sessionCountdownUpload) {
    sessionCountdownUpload.textContent = formatCountdown(remainingSeconds);
    sessionCountdownUpload.classList.remove('hidden');
  }

  if (remainingSeconds <= 0 && !isSessionUnavailable) {
    handleSessionExpired();
  }
}

function startSessionCountdownTicker(): void {
  stopSessionCountdownTicker();
  countdownHandle = window.setInterval(() => {
    renderSessionRemainingTime();
  }, 1000);
}

function updateSessionCountdown(remainingSeconds?: number): void {
  if (
    typeof remainingSeconds !== 'number' ||
    !Number.isFinite(remainingSeconds) ||
    remainingSeconds < 0
  ) {
    resetSessionCountdown();
    return;
  }

  countdownBaselineSeconds = Math.floor(remainingSeconds);
  countdownSyncedAtMs = Date.now();
  renderSessionRemainingTime();
  startSessionCountdownTicker();
}

function handleSessionExpired(): void {
  isSessionUnavailable = true;
  stopSessionMonitor();
  resetSessionCountdown();
  setAppState('session-error');
  setSessionUI('Session expired', 'error');
  setStatus(
    'Session expired. Please pair again on the kiosk.',
    'error',
  );
}

// ── Socket.IO Real-Time Sync ─────────────────────────────────────────────────

function initSocket(): void {
  if (!token || typeof window.io !== 'function') return;

  try {
    socket = window.io({
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnectionDelay: 2000,
    });

    socket.on('connect', () => {
      setSessionUI('Connected to kiosk', 'active');
      if (sessionId) {
        socket?.emit('joinSession', sessionId);
      }
    });

    socket.on('disconnect', () => {
      setSessionUI('Disconnected from kiosk', 'error');
    });

    socket.on('session:mode_changed', (payload: unknown) => {
      const data = payload as { mode?: string };
      if (data?.mode) {
        setSessionModeView(data.mode);
      }
    });

    socket.on('session:scan_ready', (payload: unknown) => {
      const data = payload as { filename?: string; downloadUrl?: string };
      showScanReady(data?.filename);
    });

    socket.on('session:ended', (payload: unknown) => {
      const data = payload as { dispensedChange?: number; reason?: string };
      showSessionEnded(data?.dispensedChange, data?.reason);
    });

    socket.on('session:balance_updated', (payload: unknown) => {
      const data = payload as { balance?: number };
      if (typeof data?.balance === 'number' && portalBalanceText) {
        portalBalanceText.textContent = data.balance.toFixed(2);
      }
    });

    socket.on('balance', (amount: unknown) => {
      if (typeof amount === 'number' && portalBalanceText) {
        portalBalanceText.textContent = amount.toFixed(2);
      }
    });

    socket.on('coinAccepted', (payload: unknown) => {
      const data = payload as { balance?: number };
      if (typeof data?.balance === 'number' && portalBalanceText) {
        portalBalanceText.textContent = data.balance.toFixed(2);
      }
    });

    socket.on('session:state_changed', (payload: unknown) => {
      const data = payload as { state?: string; reason?: string };
      if (data?.state === 'ENDING' || data?.state === 'IDLE') {
        if (data.state === 'IDLE') {
          setSessionModeView('IDLE');
        }
      }
    });
  } catch (err) {
    console.warn('[PORTAL] Socket initialization error:', err);
  }
}

// ── Session Polling & Initialization ─────────────────────────────────────────

async function checkSessionStatus(): Promise<void> {
  if (isSessionUnavailable || !token) return;

  try {
    const res = await fetch(
      `/api/wireless/sessions/by-token/${encodeURIComponent(token)}?clientId=${encodeURIComponent(uploadClientId)}`,
      { cache: 'no-store' },
    );

    if (!res.ok) {
      if (res.status === 404 || res.status === 410) {
        handleSessionExpired();
      }
      return;
    }

    const data = (await res.json()) as SessionResponse;
    sessionId = data.sessionId;
    if (typeof data.warningThresholdSeconds === 'number') {
      sessionWarningThresholdSeconds = data.warningThresholdSeconds;
    }
    updateSessionCountdown(data.remainingSeconds);

    if (data.mode) {
      setSessionModeView(data.mode);
    }
    if (typeof data.balance === 'number' && portalBalanceText) {
      portalBalanceText.textContent = data.balance.toFixed(2);
    }
  } catch {
    // Network retry will handle
  }
}

async function initSession(): Promise<void> {
  if (!token) {
    setAppState('session-error');
    setSessionUI('Missing token', 'error');
    setStatus('No session token provided. Please scan the kiosk QR code.', 'error');
    return;
  }

  setAppState('session-loading');
  setSessionUI('Connecting to session…', 'idle');
  clearStatus();

  try {
    const res = await fetch(
      `/api/wireless/sessions/by-token/${encodeURIComponent(token)}?clientId=${encodeURIComponent(uploadClientId)}`,
      { cache: 'no-store' },
    );

    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as UploadErrorResponse;
      setAppState('session-error');
      setSessionUI('Session unavailable', 'error');
      setStatus(mapError(errData), 'error');
      return;
    }

    const data = (await res.json()) as SessionResponse;
    sessionId = data.sessionId;
    isSessionUnavailable = false;

    if (typeof data.warningThresholdSeconds === 'number') {
      sessionWarningThresholdSeconds = data.warningThresholdSeconds;
    }
    updateSessionCountdown(data.remainingSeconds);

    if (data.mode) {
      setSessionModeView(data.mode);
    }
    if (typeof data.balance === 'number' && portalBalanceText) {
      portalBalanceText.textContent = data.balance.toFixed(2);
    }

    setAppState('session-ready');
    setSessionUI('Ready', 'active');
    initSocket();

    stopSessionMonitor();
    monitorHandle = window.setInterval(() => {
      void checkSessionStatus();
    }, SESSION_MONITOR_INTERVAL_MS);
  } catch {
    setAppState('session-error');
    setSessionUI('Connection error', 'error');
    setStatus('Could not connect to kiosk. Please verify Wi-Fi connection.', 'error');
  }
}

// ── File Queue & Upload Implementation ───────────────────────────────────────

function renderQueueItem(q: QueuedFile): void {
  const ext = extOf(q.file.name);
  const sizeStr = formatBytes(q.file.size);

  q.el.className = 'queue-item';
  q.el.innerHTML = `
    <div class="queue-item__icon" data-ext="${ext}">${ext.toUpperCase().slice(0, 4)}</div>
    <div class="queue-item__info">
      <div class="queue-item__name" title="${q.file.name}">${q.file.name}</div>
      <div class="queue-item__size">${sizeStr}</div>
      <div class="queue-item__progress-bar hidden"><div class="queue-item__progress-fill"></div></div>
    </div>
    <div class="queue-item__actions">
      <span class="queue-item__status">Ready</span>
      <button type="button" class="queue-item__remove" aria-label="Remove ${q.file.name}">
        <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
      </button>
    </div>
  `;

  const removeBtn = q.el.querySelector('.queue-item__remove') as HTMLButtonElement | null;
  removeBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    removeQueueItem(q.id);
  });

  if (fileQueue) {
    fileQueue.appendChild(q.el);
  }
}

function removeQueueItem(id: string): void {
  const idx = queue.findIndex((item) => item.id === id);
  if (idx !== -1) {
    const [removed] = queue.splice(idx, 1);
    removed.el.remove();
  }

  if (dropZone) {
    dropZone.classList.toggle('has-files', queue.length > 0);
  }
  setAppState(appState);
}

function addFiles(files: FileList | File[]): void {
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return;

  const unsupported = collectUnsupportedFiles(fileArray);
  if (unsupported.length > 0) {
    setStatus(
      `Unsupported file type: ${unsupported.join(', ')}. Please select PDF, Office, or image files.`,
      'error',
    );
    return;
  }

  for (const file of fileArray) {
    if (file.size > 25 * 1024 * 1024) {
      setStatus(`File "${file.name}" exceeds 25 MB limit.`, 'error');
      continue;
    }

    const alreadyInQueue = queue.some(
      (q) => q.file.name === file.name && q.file.size === file.size,
    );
    if (alreadyInQueue) continue;

    const id = `q_${++nextId}`;
    const el = document.createElement('div');
    const queuedFile: QueuedFile = { id, file, status: 'pending', el };
    queue.push(queuedFile);
    renderQueueItem(queuedFile);
  }

  if (dropZone) {
    dropZone.classList.toggle('has-files', queue.length > 0);
  }
  setAppState(appState);
}

async function uploadSingleFile(q: QueuedFile): Promise<boolean> {
  if (!sessionId || !token) return false;

  q.status = 'uploading';
  const statusSpan = q.el.querySelector('.queue-item__status') as HTMLSpanElement | null;
  const progressBar = q.el.querySelector('.queue-item__progress-bar') as HTMLDivElement | null;
  const progressFill = q.el.querySelector('.queue-item__progress-fill') as HTMLDivElement | null;
  const removeBtn = q.el.querySelector('.queue-item__remove') as HTMLButtonElement | null;

  if (statusSpan) statusSpan.textContent = 'Uploading…';
  if (progressBar) progressBar.classList.remove('hidden');
  if (removeBtn) removeBtn.disabled = true;

  const formData = new FormData();
  formData.append('file', q.file);

  return new Promise<boolean>((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      'POST',
      `/api/wireless/sessions/${encodeURIComponent(sessionId!)}/upload?token=${encodeURIComponent(token)}&clientId=${encodeURIComponent(uploadClientId)}`,
    );

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && progressFill) {
        const pct = Math.round((event.loaded / event.total) * 100);
        progressFill.style.width = `${pct}%`;
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        q.status = 'done';
        if (statusSpan) {
          statusSpan.textContent = 'Uploaded ✓';
          statusSpan.className = 'queue-item__status ok';
        }
        if (progressBar) progressBar.classList.add('hidden');
        resolve(true);
      } else {
        q.status = 'error';
        let errMsg = 'Failed';
        try {
          const res = JSON.parse(xhr.responseText) as UploadErrorResponse;
          errMsg = mapError(res);
        } catch {
          // ignore
        }
        if (statusSpan) {
          statusSpan.textContent = errMsg;
          statusSpan.className = 'queue-item__status error';
        }
        if (progressBar) progressBar.classList.add('hidden');
        if (removeBtn) removeBtn.disabled = false;
        resolve(false);
      }
    };

    xhr.onerror = () => {
      q.status = 'error';
      if (statusSpan) {
        statusSpan.textContent = 'Network error';
        statusSpan.className = 'queue-item__status error';
      }
      if (progressBar) progressBar.classList.add('hidden');
      if (removeBtn) removeBtn.disabled = false;
      resolve(false);
    };

    xhr.send(formData);
  });
}

async function handleUploadSubmit(event: Event): Promise<void> {
  event.preventDefault();
  const pending = queue.filter((q) => q.status === 'pending');
  if (pending.length === 0 || !sessionId) return;

  setAppState('uploading');
  if (uploadBtnLabel) uploadBtnLabel.textContent = 'Sending to Kiosk…';
  clearStatus();

  let successCount = 0;
  for (const item of pending) {
    const ok = await uploadSingleFile(item);
    if (ok) successCount++;
  }

  if (uploadBtnLabel) uploadBtnLabel.textContent = 'Send to Kiosk';

  if (successCount === pending.length) {
    setAppState('all-done');
    setStatus('All files successfully sent! Please check the kiosk screen.', 'ok');
  } else if (successCount > 0) {
    setAppState('session-ready');
    setStatus(
      `Uploaded ${successCount} of ${pending.length} files. Please check failed files.`,
      'info',
    );
  } else {
    setAppState('session-ready');
    setStatus('Upload failed. Please check connection and try again.', 'error');
  }
}

// ── Event Listeners ───────────────────────────────────────────────────────────

dropZone?.addEventListener('click', () => fileInput?.click());
fileInput?.addEventListener('change', () => {
  if (fileInput?.files) {
    addFiles(fileInput.files);
    fileInput.value = '';
  }
});

dropZone?.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});

dropZone?.addEventListener('dragleave', () => {
  dropZone?.classList.remove('drag-over');
});

dropZone?.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone?.classList.remove('drag-over');
  if (e.dataTransfer?.files) {
    addFiles(e.dataTransfer.files);
  }
});

uploadForm?.addEventListener('submit', (e) => {
  void handleUploadSubmit(e);
});

retrySessionButton?.addEventListener('click', () => {
  void initSession();
});

// ── Start ─────────────────────────────────────────────────────────────────────

void initSession();
