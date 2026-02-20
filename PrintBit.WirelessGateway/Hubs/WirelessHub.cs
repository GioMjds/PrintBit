using Microsoft.AspNetCore.SignalR;

namespace PrintBit.WirelessGateway.Hubs;

public sealed class WirelessHub : Hub
{
    public static string SessionGroup(Guid sessionId) => $"session:{sessionId:N}";

    public Task JoinSession(string sessionId)
    {
        if (!Guid.TryParse(sessionId, out var parsedSessionId))
        {
            throw new HubException("Invalid session id.");
        }

        return Groups.AddToGroupAsync(Context.ConnectionId, SessionGroup(parsedSessionId));
    }

    public Task LeaveSession(string sessionId)
    {
        if (!Guid.TryParse(sessionId, out var parsedSessionId))
        {
            throw new HubException("Invalid session id.");
        }

        return Groups.RemoveFromGroupAsync(Context.ConnectionId, SessionGroup(parsedSessionId));
    }
}
