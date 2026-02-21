const tokenFromPath = window.location.pathname.split('/')[2] || '';
const token = window.uploadToken || tokenFromPath;

let sessionId = null;
const statusBox = document.getElementById('statusBox');
const uploadButton = document.getElementById('uploadButton');
const uploadForm = document.getElementById('uploadForm');
const fileInput = document.getElementById('fileInput');
const selectedFileName = document.getElementById('selectedFileName');
const sessionMeta = document.getElementById('sessionMeta');

function setStatus(message, css) {
  if (!statusBox) return;
  statusBox.textContent = message;
  statusBox.className = 'status' + (css ? ' ' + css : '');
}

function mapError(result) {
  if (!result || !result.code) return result?.error || 'Upload failed.';
  if (result.code === 'session_already_used') return 'This QR session already has a file. Ask kiosk to refresh QR session.';
  if (result.code === 'invalid_token') return 'Invalid upload token. Please scan a fresh kiosk QR.';
  if (result.code === 'unsupported_file_type') return 'Unsupported file type. Use PDF, DOC/DOCX, PNG, JPG, or JPEG.';
  if (result.code === 'file_too_large') return result.error;
  if (result.code === 'session_not_found') return 'Session not found. Please scan a fresh kiosk QR.';
  return result.error || 'Upload failed.';
}

function updateSelectedFileName() {
  if (!selectedFileName || !fileInput) return;
  selectedFileName.textContent = fileInput.files && fileInput.files.length > 0
    ? `Selected file: ${fileInput.files[0].name}`
    : 'No file selected';
}

if (fileInput) {
  fileInput.addEventListener('change', updateSelectedFileName);
}

async function initializeSession() {
  try {
    const response = await fetch(`/api/wireless/sessions/by-token/${encodeURIComponent(token)}`);
    if (!response.ok) {
      setStatus('This QR session is invalid. Please scan a new QR code from the kiosk.', 'error');
      if (sessionMeta) sessionMeta.textContent = 'Session unavailable';
      return;
    }

    const session = await response.json();
    sessionId = session.sessionId;
    if (uploadButton) uploadButton.disabled = false;
    if (sessionMeta) sessionMeta.textContent = 'Session active';
    setStatus('Session ready. Select your file and tap Upload.', null);
  } catch (error) {
    setStatus('Could not reach kiosk server. Connect phone to kiosk Wi-Fi (internet is not required).', 'error');
    if (sessionMeta) sessionMeta.textContent = 'Connection error';
  }
}

if (uploadForm) {
  uploadForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!sessionId) {
      setStatus('Session is not ready yet.', 'error');
      return;
    }

    if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
      setStatus('Please select a file first.', 'error');
      return;
    }

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    if (uploadButton) uploadButton.disabled = true;
    setStatus('Uploading file to kiosk...', null);

    try {
      const response = await fetch(`/api/wireless/sessions/${sessionId}/upload?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        body: formData
      });

      const result = await response.json();
      if (!response.ok) {
        setStatus(mapError(result), 'error');
        if (uploadButton) uploadButton.disabled = false;
        return;
      }

      if (selectedFileName) {
        selectedFileName.textContent = `Uploaded file: ${result.fileName}`;
      }
      setStatus(`Upload complete: ${result.fileName}. You can now continue on the kiosk.`, 'ok');
    } catch (error) {
      setStatus('Upload failed due to network error. Try again.', 'error');
      if (uploadButton) uploadButton.disabled = false;
    }
  });
}

initializeSession();
