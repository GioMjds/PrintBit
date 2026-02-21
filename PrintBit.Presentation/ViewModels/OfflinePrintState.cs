namespace PrintBit.Presentation.ViewModels;

public enum OfflinePrintState
{
    HotspotStarting,
    HotspotReady,
    WaitingForPhoneNetworkJoin,
    SessionCreating,
    SessionReady,
    UploadInProgress,
    UploadReceived,
    NetworkJoinTimeout,
    NoLocalNetworkFallback,
    SessionExpired,
    GatewayUnavailable,
    ReconnectingRealtime
}
