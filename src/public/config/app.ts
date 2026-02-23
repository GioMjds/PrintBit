export {};

type PrintConfig = {
  mode: "print" | "copy";
  sessionId: string | null;
  colorMode: "colored" | "grayscale";
  copies: number;
  orientation: "portrait" | "landscape";
  paperSize: "A4" | "Letter" | "Legal";
};

const params = new URLSearchParams(window.location.search);
const mode =
  (params.get("mode") as "print" | "copy" | null) ??
  (sessionStorage.getItem("printbit.mode") as "print" | "copy" | null) ??
  "print";
const sessionId =
  params.get("sessionId") ?? sessionStorage.getItem("printbit.sessionId");

const modeInfo = document.getElementById(
  "modeInfo",
) as HTMLParagraphElement | null;
const backLink = document.getElementById(
  "backLink",
) as HTMLAnchorElement | null;
const continueBtn = document.getElementById(
  "continueBtn",
) as HTMLButtonElement | null;
const previewSection = document.getElementById("previewSection") as HTMLElement | null;
const previewHint = document.getElementById("previewHint") as HTMLParagraphElement | null;
const previewFrame = document.getElementById("previewFrame") as HTMLIFrameElement | null;

const colorMode = document.getElementById(
  "colorMode",
) as HTMLSelectElement | null;
const copies = document.getElementById("copies") as HTMLInputElement | null;
const orientationSelect = document.getElementById(
  "orientation",
) as HTMLSelectElement | null;
const paperSize = document.getElementById(
  "paperSize",
) as HTMLSelectElement | null;

const uploadedFile = sessionStorage.getItem("printbit.uploadedFile");
if (modeInfo) {
  modeInfo.textContent =
    mode === "print"
      ? `Print mode. Uploaded file: ${uploadedFile ?? "not found"}.`
      : "Copy mode. Insert your physical document before confirming.";
}

if (backLink) {
  backLink.href = mode === "copy" ? "/copy" : "/print";
}

if (mode === "print" && continueBtn) {
  continueBtn.disabled = true;
}

async function loadPreview(): Promise<void> {
  if (mode !== "print") {
    if (previewSection) previewSection.style.display = "none";
    return;
  }

  if (!sessionId) {
    if (previewHint) previewHint.textContent = "No print session found. Go back to /print and upload a file.";
    if (previewFrame) previewFrame.style.display = "none";
    if (continueBtn) continueBtn.disabled = true;
    return;
  }

  const response = await fetch(`/api/wireless/sessions/${encodeURIComponent(sessionId)}`);
  if (!response.ok) {
    if (previewHint) previewHint.textContent = "Session not found. Please return to /print and create a new upload session.";
    if (previewFrame) previewFrame.style.display = "none";
    if (continueBtn) continueBtn.disabled = true;
    return;
  }

  const session = (await response.json()) as {
    status: "pending" | "uploaded";
    document?: { filename: string };
  };

  if (session.status !== "uploaded" || !session.document) {
    if (previewHint) previewHint.textContent = "No uploaded file yet. Upload first from /print.";
    if (previewFrame) previewFrame.style.display = "none";
    if (continueBtn) continueBtn.disabled = true;
    return;
  }

  if (previewHint) previewHint.textContent = `Previewing: ${session.document.filename}`;
  if (previewFrame) {
    previewFrame.style.display = "block";
    previewFrame.src = `/api/wireless/sessions/${encodeURIComponent(sessionId)}/preview`;
  }
  if (continueBtn) continueBtn.disabled = false;
}

continueBtn?.addEventListener("click", () => {
  if (mode === "print" && !sessionId) {
    if (modeInfo) modeInfo.textContent = "Upload a file in /print before continuing.";
    return;
  }

  const config: PrintConfig = {
    mode,
    sessionId,
    colorMode: (colorMode?.value as "colored" | "grayscale") ?? "colored",
    copies: Number(copies?.value ?? "1"),
    orientation:
      (orientationSelect?.value as "portrait" | "landscape") ?? "portrait",
    paperSize: (paperSize?.value as "A4" | "Letter" | "Legal") ?? "A4",
  };

  sessionStorage.setItem("printbit.mode", mode);
  if (sessionId) sessionStorage.setItem("printbit.sessionId", sessionId);
  sessionStorage.setItem("printbit.config", JSON.stringify(config));

  window.location.href = "/confirm";
});

void loadPreview();
