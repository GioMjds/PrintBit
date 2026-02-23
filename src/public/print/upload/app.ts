// ─── Token resolution ─────────────────────────────────────────────────────────
//
// The token is injected by the server in two ways so the page works whether it
// is opened from a QR scan (/upload/<token>) or served directly:
//   1. window.uploadToken – set by an inline <script> tag in index.html
//   2. Fallback: third path segment of the current URL  →  /upload/<token>/…

export {};

declare global {
  interface Window {
    uploadToken: string;
  }
}

const tokenFromPath = window.location.pathname.split("/")[2];
const token: string = window.uploadToken || tokenFromPath;

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
const uploadButton = document.getElementById(
  "uploadButton",
) as HTMLButtonElement;
const uploadForm = document.getElementById(
  "uploadForm",
) as HTMLFormElement;
const fileInput = document.getElementById(
  "fileInput",
) as HTMLInputElement;
const selectedFileName = document.getElementById(
  "selectedFileName",
) as HTMLParagraphElement;
const sessionMeta = document.getElementById(
  "sessionMeta",
) as HTMLParagraphElement;

let sessionId: string | null = null;

type StatusClass = "error" | "ok" | null;

function setStatus(message: string, css: StatusClass = null): void {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = "status" + (css ? ` ${css}` : "");
}

function mapError(result: UploadErrorResponse): string {
  if (!result?.code) return result?.error ?? "Upload failed.";

  switch (result.code) {
    case "SESSION_ALREADY_USED":
      return "This QR session already has a file. Ask the kiosk to refresh the QR session.";
    case "INVALID_TOKEN":
      return "Invalid upload token. Please scan a fresh kiosk QR.";
    case "UNSUPPORTED_FILE_TYPE":
      return "Unsupported file type. Use PDF, DOC/DOCX, PNG, JPG, or JPEG.";
    case "FILE_TOO_LARGE":
      return result.error ?? "File exceeds the 25 MB limit.";
    case "SESSION_NOT_FOUND":
      return "Session not found. Please scan a fresh kiosk QR.";
    default:
      return result.error ?? "Upload failed.";
  }
}

function updateSelectedFileName(): void {
  if (!selectedFileName || !fileInput) return;
  selectedFileName.textContent =
    fileInput.files && fileInput.files.length > 0
      ? `Selected file: ${fileInput.files[0].name}`
      : "No file selected";
}

async function initializeSession(): Promise<void> {
  if (!token) {
    setStatus("No upload token found. Please scan a fresh kiosk QR.", "error");
    if (sessionMeta) sessionMeta.textContent = "Token missing";
    return;
  }

  try {
    const response = await fetch(
      `/api/wireless/sessions/by-token/${encodeURIComponent(token)}`,
    );

    if (!response.ok) {
      setStatus(
        "This QR session is invalid or has expired. Please scan a new QR code from the kiosk.",
        "error",
      );
      if (sessionMeta) sessionMeta.textContent = "Session unavailable";
      return;
    }

    const session = (await response.json()) as SessionResponse;
    sessionId = session.sessionId;

    if (session.status === "uploaded") {
      setStatus("A file has already been uploaded in this session.", "ok");
      if (sessionMeta) sessionMeta.textContent = "Session already used";
      return;
    }

    if (uploadButton) uploadButton.disabled = false;
    if (sessionMeta) sessionMeta.textContent = "Session active";
    setStatus("Session ready. Select your file and tap Upload.", null);
  } catch {
    setStatus(
      "Could not reach the kiosk server. Make sure your phone is connected to the kiosk Wi-Fi (internet is not required).",
      "error",
    );
    if (sessionMeta) sessionMeta.textContent = "Connection error";
  }
}

fileInput?.addEventListener("change", updateSelectedFileName);

uploadForm?.addEventListener("submit", async (event: SubmitEvent) => {
  event.preventDefault();

  if (!sessionId) {
    setStatus("Session is not ready yet. Please wait or refresh.", "error");
    return;
  }

  if (!fileInput?.files?.length) {
    setStatus("Please select a file first.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("file", fileInput.files[0]);

  if (uploadButton) uploadButton.disabled = true;
  setStatus("Uploading file to kiosk…", null);

  try {
    const response = await fetch(
      `/api/wireless/sessions/${sessionId}/upload?token=${encodeURIComponent(token)}`,
      { method: "POST", body: formData },
    );

    if (!response.ok) {
      const result = (await response.json()) as UploadErrorResponse;
      setStatus(mapError(result), "error");
      if (uploadButton) uploadButton.disabled = false;
      return;
    }

    const result = (await response.json()) as UploadSuccessResponse;

    if (selectedFileName) {
      selectedFileName.textContent = `Uploaded file: ${result.fileName}`;
    }

    setStatus(
      `Upload complete: ${result.fileName}. You can now continue at the kiosk.`,
      "ok",
    );
    // Leave the button disabled — one upload per session
  } catch {
    setStatus(
      "Upload failed due to a network error. Please try again.",
      "error",
    );
    if (uploadButton) uploadButton.disabled = false;
  }
});

initializeSession();
