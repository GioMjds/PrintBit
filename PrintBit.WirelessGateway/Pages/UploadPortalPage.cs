using System.Net;

namespace PrintBit.WirelessGateway.Pages;

public static class UploadPortalPage
{
    public static string Render(string token)
    {
        var safeToken = WebUtility.HtmlEncode(token);
        return $$"""
                 <!doctype html>
                 <html lang="en">
                 <head>
                   <meta charset="utf-8" />
                   <meta name="viewport" content="width=device-width, initial-scale=1" />
                   <title>PrintBit Wireless Upload</title>
                   <style>
                     body { font-family: Arial, sans-serif; margin: 0; background: #f6f7fb; color: #1f2937; }
                     .wrap { max-width: 560px; margin: 24px auto; padding: 20px; background: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.08); }
                     h1 { margin: 0 0 8px; font-size: 22px; }
                     p { margin: 8px 0; }
                     label { display: block; margin: 16px 0 6px; font-weight: 600; }
                     input[type=file] { width: 100%; padding: 8px; }
                     button { margin-top: 14px; width: 100%; padding: 12px; border: 0; border-radius: 8px; background: #4f46e5; color: #fff; font-size: 15px; cursor: pointer; }
                     button:disabled { opacity: .6; cursor: wait; }
                     .status { margin-top: 14px; padding: 10px; border-radius: 8px; background: #eef2ff; }
                     .error { background: #fee2e2; color: #7f1d1d; }
                     .ok { background: #dcfce7; color: #14532d; }
                     .muted { color: #6b7280; font-size: 13px; }
                   </style>
                 </head>
                 <body>
                   <main class="wrap">
                     <h1>PrintBit Wireless Upload</h1>
                     <p>Upload your file and it will appear on the kiosk automatically.</p>
                     <p class="muted" id="sessionMeta">Checking session...</p>
                     <form id="uploadForm">
                       <label for="fileInput">Choose file</label>
                       <input id="fileInput" name="file" type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" required />
                       <button id="uploadButton" type="submit" disabled>Upload to Kiosk</button>
                     </form>
                     <div id="statusBox" class="status">Waiting for session validation...</div>
                   </main>
                   <script>
                     const token = "{{safeToken}}";
                     let sessionId = null;
                     const statusBox = document.getElementById('statusBox');
                     const uploadButton = document.getElementById('uploadButton');
                     const uploadForm = document.getElementById('uploadForm');
                     const sessionMeta = document.getElementById('sessionMeta');

                     function setStatus(message, css) {
                       statusBox.textContent = message;
                       statusBox.className = 'status' + (css ? ' ' + css : '');
                     }

                     async function initializeSession() {
                       try {
                         const response = await fetch(`/api/wireless/sessions/by-token/${encodeURIComponent(token)}`);
                         if (!response.ok) {
                           setStatus('This QR session is invalid or expired. Please scan a new QR code from the kiosk.', 'error');
                           sessionMeta.textContent = 'Session unavailable';
                           return;
                         }

                         const session = await response.json();
                         sessionId = session.sessionId;
                         uploadButton.disabled = false;
                         sessionMeta.textContent = `Session active until ${new Date(session.expiresAt).toLocaleString()}`;
                         setStatus('Session ready. Select your file and tap Upload.', null);
                       } catch (error) {
                         setStatus('Could not reach the kiosk upload server. Ensure phone and kiosk are on the same network.', 'error');
                         sessionMeta.textContent = 'Connection error';
                       }
                     }

                     uploadForm.addEventListener('submit', async (event) => {
                       event.preventDefault();
                       if (!sessionId) {
                         setStatus('Session is not ready yet.', 'error');
                         return;
                       }

                       const fileInput = document.getElementById('fileInput');
                       if (!fileInput.files || fileInput.files.length === 0) {
                         setStatus('Please select a file first.', 'error');
                         return;
                       }

                       const formData = new FormData();
                       formData.append('file', fileInput.files[0]);

                       uploadButton.disabled = true;
                       setStatus('Uploading file to kiosk...', null);

                       try {
                         const response = await fetch(`/api/wireless/sessions/${sessionId}/upload?token=${encodeURIComponent(token)}`, {
                           method: 'POST',
                           body: formData
                         });

                         const result = await response.json();
                         if (!response.ok) {
                           setStatus(result.error || 'Upload failed.', 'error');
                           uploadButton.disabled = false;
                           return;
                         }

                         setStatus(`Upload complete: ${result.fileName}. You can now continue on the kiosk.`, 'ok');
                       } catch (error) {
                         setStatus('Upload failed due to network error. Try again.', 'error');
                         uploadButton.disabled = false;
                       }
                     });

                     initializeSession();
                   </script>
                 </body>
                 </html>
                 """;
    }
}
