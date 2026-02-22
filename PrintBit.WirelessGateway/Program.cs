using PrintBit.WirelessGateway.Hubs;
using PrintBit.WirelessGateway.Pages;
using PrintBit.WirelessGateway.Services;
using Microsoft.AspNetCore.SignalR;
using System.IO;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;

LoadDotEnvIfPresent();

var builder = WebApplication.CreateBuilder(args);

var listenUrl = builder.Configuration["WirelessGateway:ListenUrl"];
if (string.IsNullOrWhiteSpace(listenUrl))
{
    listenUrl = Environment.GetEnvironmentVariable("PRINTBIT_WIRELESS_LISTEN_URL");
}

builder.WebHost.UseUrls(string.IsNullOrWhiteSpace(listenUrl) ? "http://0.0.0.0:5058" : listenUrl);

builder.Services.AddSignalR();
builder.Services.AddSingleton<WirelessSessionStore>();

var app = builder.Build();

app.MapGet("/", () => Results.Text("PrintBit Wireless Gateway is running."));

// Serve portal HTML for the token
app.MapGet("/upload/{token}", (IWebHostEnvironment env, string token) =>
{
    return Results.Content(UploadPortalPage.Render(token, env.ContentRootPath), "text/html");
});

// Serve assets referenced by the portal under the same token path:
// - /upload/{token}/styles.css
// - /upload/{token}/app.js
app.MapGet("/upload/{token}/{*asset}", (IWebHostEnvironment env, string token, string asset) =>
{
    if (string.IsNullOrWhiteSpace(asset))
        return Results.NotFound();

    // Allowlist to avoid serving arbitrary files
    var allowed = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "styles.css", "app.js" };
    var fileName = Path.GetFileName(asset);
    if (!allowed.Contains(fileName))
        return Results.NotFound();

    // Resolve from project content folder
    var filePath = Path.Combine(env.ContentRootPath, "Pages", "UploadPortal", fileName);
    if (!File.Exists(filePath))
        return Results.NotFound();

    var contentType = fileName.EndsWith(".css", StringComparison.OrdinalIgnoreCase) ? "text/css" : "application/javascript";
    return Results.File(filePath, contentType);
});

app.MapPost("/api/wireless/sessions", (HttpContext context, WirelessSessionStore sessionStore) =>
{
    var publicBaseUrl = ResolvePublicBaseUrl(context);
    var session = sessionStore.CreateSession(publicBaseUrl);
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
        : Results.NotFound(new { error = "Session not found." });
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
            return Results.BadRequest(new
            {
                code = storeResult.ErrorCode ?? "upload_failed",
                error = errorMessage
            });
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

    var lanAddress = ResolvePreferredLanAddress();

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

static IPAddress? ResolvePreferredLanAddress()
{
    var configuredLocalIp = Environment.GetEnvironmentVariable("PRINTBIT_KIOSK_LOCAL_IP");
    if (!string.IsNullOrWhiteSpace(configuredLocalIp)
        && IPAddress.TryParse(configuredLocalIp.Trim(), out var configuredIp)
        && configuredIp.AddressFamily == AddressFamily.InterNetwork)
    {
        return configuredIp;
    }

    var preferredInterface = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_INTERFACE");
    var routerMode = string.Equals(
        Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_MODE"),
        "router",
        StringComparison.OrdinalIgnoreCase);

    if (!string.IsNullOrWhiteSpace(preferredInterface))
    {
        var preferredAddress = ResolveInterfaceAddress(preferredInterface.Trim());
        if (preferredAddress is not null)
        {
            return preferredAddress;
        }
    }

    IPAddress? fallback = null;

    foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
    {
        if (networkInterface.OperationalStatus != OperationalStatus.Up)
        {
            continue;
        }

        if (networkInterface.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
        {
            continue;
        }

        foreach (var unicast in networkInterface.GetIPProperties().UnicastAddresses)
        {
            var address = unicast.Address;
            if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address))
            {
                continue;
            }

            if (!routerMode && (IsLikelyHotspotAddress(address) || IsLikelyHotspotInterface(networkInterface)))
            {
                return address;
            }

            fallback ??= address;
        }
    }

    return fallback;
}

static bool IsLikelyHotspotAddress(IPAddress address)
{
    return address.ToString().StartsWith("192.168.137.", StringComparison.Ordinal);
}

static bool IsLikelyHotspotInterface(NetworkInterface networkInterface)
{
    var descriptor = $"{networkInterface.Name} {networkInterface.Description}";
    return descriptor.Contains("Local Area Connection", StringComparison.OrdinalIgnoreCase)
        || descriptor.Contains("Hosted Network", StringComparison.OrdinalIgnoreCase)
        || descriptor.Contains("Mobile Hotspot", StringComparison.OrdinalIgnoreCase);
}

static IPAddress? ResolveInterfaceAddress(string preferredInterface)
{
    foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
    {
        if (networkInterface.OperationalStatus != OperationalStatus.Up)
        {
            continue;
        }

        var descriptor = $"{networkInterface.Name} {networkInterface.Description}";
        if (!descriptor.Contains(preferredInterface, StringComparison.OrdinalIgnoreCase))
        {
            continue;
        }

        foreach (var unicast in networkInterface.GetIPProperties().UnicastAddresses)
        {
            var address = unicast.Address;
            if (address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(address))
            {
                continue;
            }

            return address;
        }
    }

    return null;
}

static void LoadDotEnvIfPresent()
{
    var dotEnvPath = ResolveDotEnvPath();
    if (string.IsNullOrWhiteSpace(dotEnvPath) || !File.Exists(dotEnvPath))
    {
        return;
    }

    foreach (var rawLine in File.ReadLines(dotEnvPath))
    {
        var line = rawLine.Trim();
        if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#'))
        {
            continue;
        }

        var separatorIndex = line.IndexOf('=');
        if (separatorIndex <= 0)
        {
            continue;
        }

        var key = line[..separatorIndex].Trim();
        if (string.IsNullOrWhiteSpace(key) || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key)))
        {
            continue;
        }

        var value = line[(separatorIndex + 1)..].Trim();
        if (value.Length >= 2 &&
            ((value.StartsWith('"') && value.EndsWith('"')) || (value.StartsWith('\'') && value.EndsWith('\''))))
        {
            value = value[1..^1];
        }

        Environment.SetEnvironmentVariable(key, value);
    }
}

static string? ResolveDotEnvPath()
{
    var searchRoots = new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory };
    foreach (var root in searchRoots)
    {
        var current = root;
        while (!string.IsNullOrWhiteSpace(current))
        {
            var candidatePath = Path.Combine(current, ".env");
            if (File.Exists(candidatePath))
            {
                return candidatePath;
            }

            current = Directory.GetParent(current)?.FullName;
        }
    }

    return null;
}
