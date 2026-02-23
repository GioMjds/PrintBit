export {};

declare global {
  interface Window {
    uploadToken?: string;
    io?: () => SocketClient;
  }
}

interface SocketClient {
  on: (event: string, callback: (...args: unknown[]) => void) => void;
  emit: (event: string, ...args: unknown[]) => void;
}

type UploadState =
  | "session-loading"
  | "session-ready"
  | "session-used"
  | "uploading"
  | "uploaded"
  | "error";

type StatusClass = "info" | "error" | "ok";

const tokenFromPath = window.location.pathname.split("/")[2];
const token = window.uploadToken || tokenFromPath;

interface SessionResponse {
  sessionId: string;
  uploadUrl: string;
  status: "pending" | "uploaded";
}

interface UploadSuccessResponse {
  documentId: string;
  sessionId: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

interface UploadErrorResponse {
  code?: string;
  error?: string;
}

const statusBox = document.getElementById("statusBox") as HTMLDivElement | null;
const wirelessStatus = document.getElementById(
  "wirelessStatus",
) as HTMLParagraphElement | null;
const uploadButton = document.getElementById(
  "uploadButton",
) as HTMLButtonElement | null;
const retrySessionButton = document.getElementById(
  "retrySessionButton",
) as HTMLButtonElement | null;
const uploadForm = document.getElementById(
  "uploadForm",
) as HTMLFormElement | null;
const fileInput = document.getElementById(
  "fileInput",
) as HTMLInputElement | null;
const selectedFileName = document.getElementById(
  "selectedFileName",
) as HTMLParagraphElement | null;
const sessionMeta = document.getElementById(
  "sessionMeta",
) as HTMLParagraphElement | null;
const dropZone = document.getElementById("dropZone") as HTMLDivElement | null;

let sessionId: string | null = null;
let socket: SocketClient | null = null;
let state: UploadState = "session-loading";

// ── UI helpers ────────────────────────────────────────────────

function setStatus(message: string, css: StatusClass): void {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = `status-bar ${css}`;
}

function clearStatus(): void {
  if (!statusBox) return;
  statusBox.textContent = "";
  statusBox.className = "status-bar";
}

function setWirelessStatus(message: string): void {
  if (wirelessStatus) wirelessStatus.textContent = message;
}

function setSessionMeta(message: string): void {
  if (sessionMeta) sessionMeta.textContent = message;
}

function setState(next: UploadState): void {
  state = next;

  const canUpload = state === "session-ready";
  if (uploadButton) uploadButton.disabled = !canUpload;
}

function mapError(result: UploadErrorResponse): string {
  if (!result?.code) return result?.error ?? "Upload failed.";

  switch (result.code) {
    case "ALREADY_UPLOADED":
      return "This QR session already has a file. Ask the kiosk to refresh the QR session.";
    case "INVALID_TOKEN":
      return "Invalid upload token. Please scan a fresh kiosk QR.";
    case "UNSUPPORTED_TYPE":
      return "Unsupported file type. Use PDF, DOC, or DOCX.";
    case "FILE_TOO_LARGE":
      return result.error ?? "File exceeds the 25 MB limit.";
    case "SESSION_NOT_FOUND":
      return "Session not found. Please scan a fresh kiosk QR.";
    case "no_file":
      return "No file selected. Please choose a file first.";
    default:
      return result.error ?? "Upload failed.";
  }
}

function updateSelectedFileName(): void {
  if (!selectedFileName || !fileInput) return;
  if (fileInput.files && fileInput.files.length > 0) {
    selectedFileName.textContent = `Selected: ${fileInput.files[0].name}`;
    if (state === "session-ready") clearStatus();
  } else {
    selectedFileName.textContent = "No file selected";
  }
}

// ── Drag-and-drop ─────────────────────────────────────────────

function setupDropZone(): void {
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener("dragover", (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e: DragEvent) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      // Transfer files to the input
      const dt = new DataTransfer();
      dt.items.add(files[0]);
      fileInput.files = dt.files;
      updateSelectedFileName();
    }
  });

  dropZone.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      fileInput.click();
    }
  });
}

// ── Real-time socket ──────────────────────────────────────────

function attachRealtimeHandlers(currentSessionId: string): void {
  if (typeof window.io !== "function") return;

  socket = window.io();
  socket.emit("joinSession", currentSessionId);

  socket.on("UploadStarted", (fileName: unknown) => {
    if (typeof fileName === "string") {
      setState("uploading");
      setStatus(`Uploading ${fileName} to kiosk…`, "info");
      setWirelessStatus("Wireless upload in progress.");
    }
  });

  socket.on("UploadCompleted", (documentInfo: unknown) => {
    const fileName =
      typeof documentInfo === "object" &&
      documentInfo !== null &&
      "filename" in documentInfo &&
      typeof (documentInfo as { filename: unknown }).filename === "string"
        ? (documentInfo as { filename: string }).filename
        : "document";

    setState("uploaded");
    setStatus(
      `✓ Upload complete: ${fileName}. You can now continue at the kiosk.`,
      "ok",
    );
    setWirelessStatus("Upload completed.");
    if (selectedFileName)
      selectedFileName.textContent = `Uploaded: ${fileName}`;
  });

  socket.on("UploadFailed", () => {
    if (state === "uploaded" || state === "session-used") return;

    setState("session-ready");
    setStatus("Upload failed on kiosk side. Please retry.", "error");
    setWirelessStatus("Wireless upload failed.");
  });
}

// ── Session init ──────────────────────────────────────────────

async function initializeSession(): Promise<void> {
  setState("session-loading");
  setStatus("Loading upload session…", "info");
  setWirelessStatus("Preparing upload channel.");
  setSessionMeta("Session: checking…");

  if (!token) {
    setState("error");
    setStatus("No upload token found. Please scan a fresh kiosk QR.", "error");
    setWirelessStatus("");
    setSessionMeta("Session: token missing");
    return;
  }

  try {
    const response = await fetch(
      `/api/wireless/sessions/by-token/${encodeURIComponent(token)}`,
    );

    if (!response.ok) {
      setState("error");
      setStatus(
        "This QR session is invalid or has expired. Please scan a new QR code from the kiosk.",
        "error",
      );
      setWirelessStatus("");
      setSessionMeta("Session: unavailable");
      return;
    }

    const session = (await response.json()) as SessionResponse;
    sessionId = session.sessionId;
    attachRealtimeHandlers(session.sessionId);

    if (session.status === "uploaded") {
      setState("session-used");
      setStatus("A file has already been uploaded in this session.", "ok");
      setWirelessStatus("Upload already completed.");
      setSessionMeta("Session: already used");
      return;
    }

    setState("session-ready");
    setSessionMeta(`Session: ${session.sessionId.slice(0, 8)}…`);
    setStatus("Session ready. Select your file and tap Upload.", "info");
    setWirelessStatus("Waiting for your document.");
  } catch {
    setState("error");
    setStatus(
      "Could not reach the kiosk. Make sure your phone is on the kiosk Wi-Fi.",
      "error",
    );
    setWirelessStatus("Connection failed.");
    setSessionMeta("Session: connection error");
  }
}

// ── Event listeners ───────────────────────────────────────────

fileInput?.addEventListener("change", updateSelectedFileName);

retrySessionButton?.addEventListener("click", () => {
  void initializeSession();
});

uploadForm?.addEventListener("submit", async (event: SubmitEvent) => {
  event.preventDefault();

  if (!sessionId || state !== "session-ready") {
    setStatus("Session is not ready. Please wait or retry.", "error");
    return;
  }

  if (!fileInput?.files?.length) {
    setStatus("Please select a file first.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  setState("uploading");
  setStatus("Uploading to kiosk…", "info");
  setWirelessStatus("Wireless upload in progress.");

  try {
    const response = await fetch(
      `/api/wireless/sessions/${sessionId}/upload?token=${encodeURIComponent(token)}`,
      { method: "POST", body: formData },
    );

    if (!response.ok) {
      const result = (await response.json()) as UploadErrorResponse;
      setStatus(mapError(result), "error");
      setWirelessStatus("Upload failed. Please retry.");
      if (result.code === "ALREADY_UPLOADED") {
        setState("session-used");
        setSessionMeta("Session: already used");
      } else {
        setState("session-ready");
      }
      return;
    }

    const result = (await response.json()) as UploadSuccessResponse;

    if (selectedFileName) {
      selectedFileName.textContent = `Uploaded: ${result.fileName}`;
    }

    setState("uploaded");
    setSessionMeta("Session: upload completed");
    setStatus(
      `✓ Upload complete: ${result.fileName}. You can now continue at the kiosk.`,
      "ok",
    );
    setWirelessStatus("Upload completed.");
  } catch {
    setState("session-ready");
    setStatus(
      "Upload failed due to a network error. Please try again.",
      "error",
    );
    setWirelessStatus("Network error during upload.");
  }
});

// ── Bootstrap ─────────────────────────────────────────────────

setupDropZone();
void initializeSession();
