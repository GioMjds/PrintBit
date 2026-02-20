using PrintBit.WirelessGateway.Hubs;
using PrintBit.WirelessGateway.Pages;
using PrintBit.WirelessGateway.Services;
using Microsoft.AspNetCore.SignalR;
using System.Net;
using System.Net.Sockets;

var builder = WebApplication.CreateBuilder(args);

var listenUrl = builder.Configuration["WirelessGateway:ListenUrl"];
if (string.IsNullOrWhiteSpace(listenUrl))
{
    listenUrl = Environment.GetEnvironmentVariable("PRINTBIT_WIRELESS_LISTEN_URL");
}

builder.WebHost.UseUrls(string.IsNullOrWhiteSpace(listenUrl) ? "http://0.0.0.0:5058" : listenUrl);

builder.Services.AddSignalR();
builder.Services.AddSingleton<WirelessSessionStore>();
builder.Services.AddHostedService<WirelessSessionExpiryNotifier>();

var app = builder.Build();

app.MapGet("/", () => Results.Text("PrintBit Wireless Gateway is running."));

app.MapGet("/upload/{token}", (string token) =>
{
    return Results.Content(UploadPortalPage.Render(token), "text/html");
});

app.MapPost("/api/wireless/sessions", (HttpContext context, WirelessSessionStore sessionStore) =>
{
    var publicBaseUrl = ResolvePublicBaseUrl(context);
    var session = sessionStore.CreateSession(publicBaseUrl, TimeSpan.FromMinutes(5));
    return Results.Ok(session);
});

app.MapGet("/api/wireless/sessions/{sessionId:guid}", (Guid sessionId, HttpContext context, WirelessSessionStore sessionStore) =>
{
    var publicBaseUrl = ResolvePublicBaseUrl(context);
    return sessionStore.TryGetSession(sessionId, publicBaseUrl, out var session)
        ? Results.Ok(session)
        : Results.NotFound(new { error = "Session not found." });
});

app.MapGet("/api/wireless/sessions/by-token/{token}", (string token, HttpContext context, WirelessSessionStore sessionStore) =>
{
    var publicBaseUrl = ResolvePublicBaseUrl(context);
    return sessionStore.TryGetSessionByToken(token, publicBaseUrl, out var session)
        ? Results.Ok(session)
        : Results.NotFound(new { error = "Session not found or token expired." });
});

app.MapPost(
    "/api/wireless/sessions/{sessionId:guid}/upload",
    async (Guid sessionId, string token, IFormFile file, HttpContext context, WirelessSessionStore sessionStore, IHubContext<WirelessHub> hubContext, CancellationToken cancellationToken) =>
    {
        var publicBaseUrl = ResolvePublicBaseUrl(context);
        await hubContext.Clients.Group(WirelessHub.SessionGroup(sessionId))
            .SendAsync("UploadStarted", file.FileName, cancellationToken);

        var storeResult = await sessionStore.StoreUploadAsync(sessionId, token, file, publicBaseUrl, cancellationToken);
        if (!storeResult.IsSuccess || storeResult.Document is null)
        {
            var errorMessage = storeResult.ErrorMessage ?? "Upload failed.";
            await hubContext.Clients.Group(WirelessHub.SessionGroup(sessionId))
                .SendAsync("UploadFailed", errorMessage, cancellationToken);
            return Results.BadRequest(new { error = errorMessage });
        }

        await hubContext.Clients.Group(WirelessHub.SessionGroup(sessionId))
            .SendAsync("UploadCompleted", storeResult.Document, cancellationToken);

        return Results.Ok(new
        {
            storeResult.Document.DocumentId,
            storeResult.Document.SessionId,
            storeResult.Document.FileName,
            storeResult.Document.ContentType,
            storeResult.Document.SizeBytes,
            storeResult.Document.UploadedAt
        });
    })
    .DisableAntiforgery();

app.MapHub<WirelessHub>("/hubs/wireless");

app.Run();

static Uri ResolvePublicBaseUrl(HttpContext context)
{
    var configuredPublicBaseUrl = Environment.GetEnvironmentVariable("PRINTBIT_WIRELESS_PUBLIC_BASE_URL");
    if (!string.IsNullOrWhiteSpace(configuredPublicBaseUrl)
        && Uri.TryCreate(configuredPublicBaseUrl, UriKind.Absolute, out var configuredUri))
    {
        return configuredUri;
    }

    var requestUri = new Uri($"{context.Request.Scheme}://{context.Request.Host}");
    if (!requestUri.IsLoopback)
    {
        return requestUri;
    }

    var lanAddress = Dns
        .GetHostAddresses(Dns.GetHostName())
        .FirstOrDefault(address => address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(address));

    if (lanAddress is null)
    {
        return requestUri;
    }

    var publicUriBuilder = new UriBuilder(requestUri)
    {
        Host = lanAddress.ToString()
    };
    return publicUriBuilder.Uri;
}
