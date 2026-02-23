import QRCode from "qrcode";

type SessionResponse = {
  sessionId: string;
  token: string;
  status: "pending" | "uploaded";
  uploadUrl: string;
  document?: {
    filename: string;
  };
};

const uploadLink = document.getElementById("uploadLink") as HTMLAnchorElement | null;
const openUploadBtn = document.getElementById("openUploadBtn") as HTMLButtonElement | null;
const refreshSessionBtn = document.getElementById("refreshSessionBtn") as HTMLButtonElement | null;
const continueBtn = document.getElementById("continueBtn") as HTMLButtonElement | null;
const sessionText = document.getElementById("sessionText") as HTMLParagraphElement | null;
const fileStatus = document.getElementById("fileStatus") as HTMLParagraphElement | null;
const uploadQrCanvas = document.getElementById("uploadQrCanvas") as HTMLCanvasElement | null;

let activeSessionId = "";
let pollHandle: number | null = null;

function setSessionText(text: string): void {
  if (sessionText) sessionText.textContent = text;
}

function setFileStatus(text: string): void {
  if (fileStatus) fileStatus.textContent = text;
}

function updateUploadLink(token: string): void {
  const href = `/upload/${encodeURIComponent(token)}`;
  const absoluteUrl = `${window.location.origin}${href}`;
  if (uploadLink) {
    uploadLink.href = href;
    uploadLink.textContent = absoluteUrl;
  }

  if (openUploadBtn) {
    openUploadBtn.onclick = () => {
    window.open(href, "_blank");
    };
  }

  if (uploadQrCanvas) {
    void QRCode.toCanvas(uploadQrCanvas, absoluteUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: "M",
    });
  }
}

async function createSession(): Promise<void> {
  if (pollHandle) {
    window.clearInterval(pollHandle);
    pollHandle = null;
  }

  if (continueBtn) continueBtn.disabled = true;
  setSessionText("Session: creating...");
  setFileStatus("Waiting for uploaded file.");

  const response = await fetch("/api/wireless/sessions");
  const session = (await response.json()) as SessionResponse;
  activeSessionId = session.sessionId;

  sessionStorage.setItem("printbit.mode", "print");
  sessionStorage.setItem("printbit.sessionId", session.sessionId);
  sessionStorage.removeItem("printbit.uploadedFile");

  setSessionText(`Session: ${session.sessionId}`);
  updateUploadLink(session.token);

  pollHandle = window.setInterval(() => {
    void checkUploadStatus();
  }, 2000);
}

async function checkUploadStatus(): Promise<void> {
  if (!activeSessionId) return;

  const response = await fetch(`/api/wireless/sessions/${encodeURIComponent(activeSessionId)}`);
  if (!response.ok) return;

  const session = (await response.json()) as SessionResponse;
  if (session.status !== "uploaded" || !session.document) return;

  sessionStorage.setItem("printbit.uploadedFile", session.document.filename);
  setFileStatus(`Uploaded file: ${session.document.filename}`);
  if (continueBtn) continueBtn.disabled = false;
}

refreshSessionBtn?.addEventListener("click", () => {
  void createSession();
});

continueBtn?.addEventListener("click", () => {
  if (!activeSessionId) return;
  window.location.href = `/config?mode=print&sessionId=${encodeURIComponent(activeSessionId)}`;
});

void createSession();
