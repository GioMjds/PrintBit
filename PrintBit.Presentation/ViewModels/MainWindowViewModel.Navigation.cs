using System;
using System.Windows.Input;

namespace PrintBit.Presentation.ViewModels;

public sealed partial class MainWindowViewModel
{
    private void NavigateTo(KioskScreen targetScreen)
    {
        CurrentScreen = targetScreen;

        if (targetScreen == KioskScreen.Landing)
        {
            StatusMessage = "Choose Print, Copy, or Scan.";
            _networkJoinTimer.Stop();
            _sessionCountdownTimer.Stop();
        }
        else if (targetScreen == KioskScreen.Print)
        {
            EnterOfflinePrintFlow();
        }
        else if (targetScreen == KioskScreen.PrintConfiguration)
        {
            StatusMessage = "Review print settings before confirmation.";
            _networkJoinTimer.Stop();
        }
        else if (targetScreen == KioskScreen.ConfirmPrint)
        {
            StatusMessage = "Insert coins to match the required print price.";
        }
        else if (targetScreen == KioskScreen.Copy)
        {
            StatusMessage = "Scan a physical document, then continue.";
        }
    }

    private void EnterOfflinePrintFlow()
    {
        var hotspotStatus = _kioskNetworkService.GetHotspotStatus();
        _stepOneLocalIpv4Address = hotspotStatus.LocalIpv4Address;
        _phoneNetworkJoinConfirmed = false;
        _networkJoinTimer.Stop();

        _ = _wirelessKioskClient.DisconnectAsync();
        _activeWirelessSessionId = null;
        _activeSessionExpiresAt = null;
        _uploadedDocumentsByName.Clear();
        WirelessQrCodeImage = null;
        WirelessUploadUrl = null;
        WirelessUploadStatus = "Step 1 required before upload QR is available.";
        SessionCountdownText = string.Empty;
        NetworkDiagnosticsText = BuildDiagnosticsText(_stepOneLocalIpv4Address, null);

        SetOfflineState(
            hotspotStatus.IsNetworkAvailable ? OfflinePrintState.HotspotReady : OfflinePrintState.HotspotStarting,
            BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
        StatusMessage = hotspotStatus.IsNetworkAvailable
            ? "Scan Wi-Fi QR, connect, then tap Connected - Continue."
            : BuildManualJoinHint();
        BeginWaitingForPhoneNetworkJoin(BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
    }

    private void BeginWaitingForPhoneNetworkJoin(string? guidanceMessage = null)
    {
        _phoneNetworkJoinConfirmed = false;
        SetOfflineState(
            OfflinePrintState.WaitingForPhoneNetworkJoin,
            guidanceMessage ?? "Step 1 required: scan Wi-Fi QR, connect, then tap Connected - Continue.");
        StatusMessage = "Waiting for phone and printer to join kiosk network.";

        _networkJoinTimer.Stop();
        _networkJoinTimer.Start();
    }

    private void ConfirmPhoneConnected()
    {
        var hotspotStatus = _kioskNetworkService.GetHotspotStatus();
        _stepOneLocalIpv4Address ??= hotspotStatus.LocalIpv4Address;
        NetworkDiagnosticsText = BuildDiagnosticsText(_stepOneLocalIpv4Address, WirelessUploadUrl);
        if (!hotspotStatus.IsNetworkAvailable)
        {
            _phoneNetworkJoinConfirmed = false;
            _networkJoinTimer.Stop();
            SetOfflineState(OfflinePrintState.NoLocalNetworkFallback, BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
            WirelessUploadStatus = "Step 1 incomplete. Kiosk network is not ready.";
            StatusMessage = BuildManualJoinHint();
            CommandManager.InvalidateRequerySuggested();
            return;
        }

        _phoneNetworkJoinConfirmed = true;
        _networkJoinTimer.Stop();
        StatusMessage = "Step 1 complete. Generating upload QR...";
        _ = StartWirelessSessionAsync();
    }

    private void HandleNetworkJoinTimeout(object? sender, EventArgs e)
    {
        _networkJoinTimer.Stop();
        if (_phoneNetworkJoinConfirmed)
        {
            return;
        }

            SetOfflineState(
                OfflinePrintState.NetworkJoinTimeout,
                BuildStepOneGuidance("Phone/printer not yet connected to kiosk network."));
            WirelessUploadStatus = "Network join timeout. Manual Wi-Fi join may be required.";
            StatusMessage = BuildManualJoinHint();
    }
}
