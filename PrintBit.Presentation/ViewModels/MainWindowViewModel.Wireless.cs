using System;
using System.Net.Http;
using System.Threading.Tasks;
using System.Windows.Input;
using System.Windows.Threading;
using PrintBit.Application.DTOs;

namespace PrintBit.Presentation.ViewModels;

public sealed partial class MainWindowViewModel
{
    private async Task StartWirelessSessionAsync(bool forceRefresh = false)
    {
        if (_isStartingWirelessSession)
        {
            return;
        }

        if (!_phoneNetworkJoinConfirmed)
        {
            SetOfflineState(
                OfflinePrintState.WaitingForPhoneNetworkJoin,
                BuildStepOneGuidance(null));
            WirelessUploadStatus = "Step 1 required before upload QR is available.";
            NetworkDiagnosticsText = BuildDiagnosticsText(null, WirelessUploadUrl);
            return;
        }

        var hotspotStatus = _kioskNetworkService.GetHotspotStatus();
        _stepOneLocalIpv4Address ??= hotspotStatus.LocalIpv4Address;
        var stepOneNetworkIp = _stepOneLocalIpv4Address ?? hotspotStatus.LocalIpv4Address;
        if (!hotspotStatus.IsNetworkAvailable)
        {
            _phoneNetworkJoinConfirmed = false;
            SetOfflineState(OfflinePrintState.NoLocalNetworkFallback, BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
            WirelessUploadStatus = "Kiosk network unavailable. Reconnect before upload QR.";
            StatusMessage = BuildManualJoinHint();
            NetworkDiagnosticsText = BuildDiagnosticsText(stepOneNetworkIp, WirelessUploadUrl);
            _networkJoinTimer.Stop();
            _networkJoinTimer.Start();
            return;
        }

        if (!await IsWirelessGatewayReachableAsync())
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless gateway is not reachable on kiosk network.");
            WirelessUploadStatus = "Gateway pre-check failed. Verify kiosk gateway service and network IP.";
            StatusMessage = "Cannot reach upload service. Start/verify gateway and retry.";
            NetworkDiagnosticsText = BuildDiagnosticsText(stepOneNetworkIp, WirelessUploadUrl);
            return;
        }

        _isStartingWirelessSession = true;
        _networkJoinTimer.Stop();
        SetOfflineState(OfflinePrintState.SessionCreating, "Creating upload session and QR code...");
        WirelessUploadStatus = "Creating wireless session...";
        CommandManager.InvalidateRequerySuggested();

        try
        {
            if (forceRefresh && _activeWirelessSessionId.HasValue)
            {
                await _wirelessKioskClient.DisconnectAsync();
                _activeWirelessSessionId = null;
            }

            var session = await _wirelessKioskClient.CreateSessionAsync();
            _activeWirelessSessionId = session.SessionId;
            _activeSessionExpiresAt = null;
            var uploadUrl = ResolveUploadUrlForStepOneNetwork(session.UploadUrl, stepOneNetworkIp);
            WirelessUploadUrl = uploadUrl;
            WirelessQrCodeImage = BuildQrCodeImage(uploadUrl);
            NetworkDiagnosticsText = BuildDiagnosticsText(stepOneNetworkIp, uploadUrl);
            await _wirelessKioskClient.ConnectToSessionAsync(session.SessionId);

            var uploadedDocuments = await _wirelessKioskClient.GetUploadedDocumentsAsync(session.SessionId);
            foreach (var uploadedDocument in uploadedDocuments)
            {
                ApplyWirelessUploadedDocument(uploadedDocument);
            }

            SessionCountdownText = string.Empty;

            if (uploadedDocuments.Count > 0)
            {
                SetOfflineState(OfflinePrintState.UploadReceived, "Upload already detected for this session.");
            }
            else
            {
                SetOfflineState(OfflinePrintState.SessionReady, "Step 2: Scan upload QR and send file from your phone.");
            }

            WirelessUploadStatus = "Session ready. Upload page works offline when connected to kiosk network.";
            StatusMessage = "Scan the upload QR and send your file.";
        }
        catch (HttpRequestException ex)
        {
            SetOfflineState(
                OfflinePrintState.GatewayUnavailable,
                "Wireless gateway unreachable. Ensure kiosk and phone are on the same local network.");
            WirelessUploadStatus = $"Wireless server unavailable: {ex.Message}";
            StatusMessage = "Unable to reach wireless upload service.";
            NetworkDiagnosticsText = BuildDiagnosticsText(stepOneNetworkIp, WirelessUploadUrl);
        }
        catch (InvalidOperationException ex)
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless upload service returned an invalid response.");
            WirelessUploadStatus = $"Wireless session error: {ex.Message}";
            StatusMessage = "Unable to create wireless upload session.";
            NetworkDiagnosticsText = BuildDiagnosticsText(stepOneNetworkIp, WirelessUploadUrl);
        }
        catch (TaskCanceledException ex)
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless session timed out. Retry when local network is stable.");
            WirelessUploadStatus = $"Wireless session timed out: {ex.Message}";
            StatusMessage = "Wireless upload session timed out.";
            NetworkDiagnosticsText = BuildDiagnosticsText(stepOneNetworkIp, WirelessUploadUrl);
        }
        finally
        {
            _isStartingWirelessSession = false;
            CommandManager.InvalidateRequerySuggested();
        }
    }

    private string BuildManualJoinHint()
    {
        return $"If auto-connect fails, open Wi-Fi settings, select \"{_hotspotSsid}\", enter password, then tap Connected - Continue.";
    }

    private string BuildStepOneGuidance(string? baseGuidance)
    {
        var normalized = string.IsNullOrWhiteSpace(baseGuidance)
            ? $"Scan Wi-Fi QR and connect to \"{_hotspotSsid}\"."
            : baseGuidance.Trim();
        return $"{normalized} {BuildManualJoinHint()}";
    }

    private string BuildDiagnosticsText(string? hotspotIp, string? uploadUrl)
    {
        var resolvedHotspotIp = string.IsNullOrWhiteSpace(hotspotIp) ? "not detected" : hotspotIp;
        var resolvedUploadUrl = string.IsNullOrWhiteSpace(uploadUrl) ? "not generated yet" : uploadUrl;
        return $"Diagnostics - Network SSID: {_hotspotSsid} | Kiosk IP: {resolvedHotspotIp} | Upload URL: {resolvedUploadUrl}";
    }

    private static async Task<bool> IsWirelessGatewayReachableAsync()
    {
        var wirelessBaseUrl = Environment.GetEnvironmentVariable("PRINTBIT_WIRELESS_BASE_URL");
        if (string.IsNullOrWhiteSpace(wirelessBaseUrl))
        {
            wirelessBaseUrl = "http://127.0.0.1:5058";
        }

        try
        {
            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(3)
            };
            var gatewayHealthUrl = new Uri(new Uri(wirelessBaseUrl, UriKind.Absolute), "/");
            using var response = await httpClient.GetAsync(gatewayHealthUrl);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private void StartSessionCountdown()
    {
        _sessionCountdownTimer.Stop();
        HandleSessionCountdown(this, EventArgs.Empty);
        _sessionCountdownTimer.Start();
    }

    private void HandleSessionCountdown(object? sender, EventArgs e)
    {
        if (!_activeSessionExpiresAt.HasValue)
        {
            SessionCountdownText = string.Empty;
            return;
        }

        var remaining = _activeSessionExpiresAt.Value - DateTimeOffset.UtcNow;
        if (remaining <= TimeSpan.Zero)
        {
            _sessionCountdownTimer.Stop();
            SessionCountdownText = "Session expired. Refresh QR session.";
            SetOfflineState(OfflinePrintState.SessionExpired, "Session expired. Refresh QR session and upload again.");
            WirelessUploadStatus = "Upload session expired.";
            return;
        }

        SessionCountdownText = $"Session expires in {remaining:mm\\:ss}";
    }

    private void HandleWirelessUploadCompleted(UploadedDocumentDto document)
    {
        var dispatcher = System.Windows.Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            ApplyWirelessUploadedDocument(document);
            return;
        }

        _ = dispatcher.BeginInvoke(new Action(() => ApplyWirelessUploadedDocument(document)));
    }

    private void HandleWirelessStatusChanged(string statusMessage)
    {
        var dispatcher = System.Windows.Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            ApplyWirelessStatus(statusMessage);
            return;
        }

        _ = dispatcher.BeginInvoke(new Action(() => ApplyWirelessStatus(statusMessage)));
    }

    private void ApplyWirelessStatus(string statusMessage)
    {
        WirelessUploadStatus = statusMessage;

        if (statusMessage.Contains("reconnecting", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.ReconnectingRealtime, "Realtime channel reconnecting. Keep phone connected to kiosk network.");
            return;
        }

        if (statusMessage.Contains("Upload in progress", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.UploadInProgress, "Upload in progress from phone...");
            return;
        }

        if (statusMessage.Contains("reconnected", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(SelectedUploadedFile is null ? OfflinePrintState.SessionReady : OfflinePrintState.UploadReceived,
                "Realtime channel restored.");
            return;
        }

        if (statusMessage.Contains("expired", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.SessionExpired, "Session expired. Refresh QR session.");
            return;
        }

        if (statusMessage.Contains("closed", StringComparison.OrdinalIgnoreCase)
            || statusMessage.Contains("failed", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable,
                "Realtime channel unavailable. Retry session or use fallback transfer.");
        }
    }

    private void ApplyWirelessUploadedDocument(UploadedDocumentDto document)
    {
        _uploadedDocumentsByName[document.FileName] = document;

        if (!UploadedFiles.Any(existingFileName =>
                string.Equals(existingFileName, document.FileName, StringComparison.OrdinalIgnoreCase)))
        {
            UploadedFiles.Add(document.FileName);
        }

        SelectedUploadedFile = document.FileName;
        SetOfflineState(OfflinePrintState.UploadReceived, "Upload received. Continue to print configuration.");
        WirelessUploadStatus = $"Upload received: {document.FileName}";
        StatusMessage = $"Wireless file ready: {document.FileName}. Continue to print configuration.";
    }

    private void SetOfflineState(OfflinePrintState state, string guidanceMessage)
    {
        OfflineState = state;
        OfflineGuidanceMessage = guidanceMessage;
    }
}
