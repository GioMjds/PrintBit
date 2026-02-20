using Microsoft.AspNetCore.SignalR;
using PrintBit.WirelessGateway.Hubs;

namespace PrintBit.WirelessGateway.Services;

public sealed class WirelessSessionExpiryNotifier : BackgroundService
{
    private readonly WirelessSessionStore _sessionStore;
    private readonly IHubContext<WirelessHub> _hubContext;

    public WirelessSessionExpiryNotifier(WirelessSessionStore sessionStore, IHubContext<WirelessHub> hubContext)
    {
        _sessionStore = sessionStore;
        _hubContext = hubContext;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            var expiredSessionIds = _sessionStore.MarkExpiredSessions();
            foreach (var sessionId in expiredSessionIds)
            {
                await _hubContext.Clients
                    .Group(WirelessHub.SessionGroup(sessionId))
                    .SendAsync("SessionExpired", "Wireless session expired. Generate a new QR code.", stoppingToken);
            }

            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        }
    }
}
