using System.Net.Http.Json;
using Microsoft.AspNetCore.SignalR.Client;
using PrintBit.Application.DTOs;
using PrintBit.Application.Interfaces;

namespace PrintBit.Infrastructure.Wireless;

public sealed class WirelessGatewayClient : IWirelessKioskClient, IDisposable
{
    private readonly Uri _baseUri;
    private readonly HttpClient _httpClient;
    private readonly SemaphoreSlim _connectionLock = new(1, 1);

    private HubConnection? _hubConnection;
    private Guid? _connectedSessionId;
    private bool _disposed;

    public WirelessGatewayClient(string baseUrl)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseUrl);
        _baseUri = new Uri(baseUrl, UriKind.Absolute);
        _httpClient = new HttpClient
        {
            BaseAddress = _baseUri
        };
    }

    public event Action<UploadedDocumentDto>? UploadCompleted;
    public event Action<string>? StatusChanged;

    public async Task<WirelessUploadSessionDto> CreateSessionAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();

        using var response = await _httpClient.PostAsJsonAsync(
            "/api/wireless/sessions",
            new CreateSessionRequest { Source = "kiosk-wpf" },
            cancellationToken);
        response.EnsureSuccessStatusCode();

        var session = await response.Content.ReadFromJsonAsync<WirelessUploadSessionDto>(cancellationToken: cancellationToken);
        return session ?? throw new InvalidOperationException("Wireless session response was empty.");
    }

    public async Task<IReadOnlyList<UploadedDocumentDto>> GetUploadedDocumentsAsync(
        Guid sessionId,
        CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();

        var response = await _httpClient.GetFromJsonAsync<WirelessUploadSessionDto>(
            $"/api/wireless/sessions/{sessionId}",
            cancellationToken);

        return response?.Documents ?? Array.Empty<UploadedDocumentDto>();
    }

    public async Task ConnectToSessionAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();

        await _connectionLock.WaitAsync(cancellationToken);
        try
        {
            var connection = await EnsureHubConnectionAsync(cancellationToken);

            if (_connectedSessionId.HasValue && _connectedSessionId.Value != sessionId)
            {
                await connection.InvokeAsync("LeaveSession", _connectedSessionId.Value.ToString(), cancellationToken);
            }

            if (_connectedSessionId != sessionId)
            {
                await connection.InvokeAsync("JoinSession", sessionId.ToString(), cancellationToken);
                _connectedSessionId = sessionId;
            }
        }
        finally
        {
            _connectionLock.Release();
        }
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();

        await _connectionLock.WaitAsync(cancellationToken);
        try
        {
            if (_hubConnection is null)
            {
                return;
            }

            if (_connectedSessionId.HasValue)
            {
                await _hubConnection.InvokeAsync("LeaveSession", _connectedSessionId.Value.ToString(), cancellationToken);
                _connectedSessionId = null;
            }

            if (_hubConnection.State != HubConnectionState.Disconnected)
            {
                await _hubConnection.StopAsync(cancellationToken);
            }
        }
        finally
        {
            _connectionLock.Release();
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        _connectionLock.Wait();
        try
        {
            _connectedSessionId = null;
            if (_hubConnection is not null)
            {
                _hubConnection.DisposeAsync().AsTask().GetAwaiter().GetResult();
                _hubConnection = null;
            }
        }
        finally
        {
            _connectionLock.Release();
            _connectionLock.Dispose();
        }

        _httpClient.Dispose();
        GC.SuppressFinalize(this);
    }

    private async Task<HubConnection> EnsureHubConnectionAsync(CancellationToken cancellationToken)
    {
        if (_hubConnection is null)
        {
            _hubConnection = BuildHubConnection();
        }

        if (_hubConnection.State == HubConnectionState.Disconnected)
        {
            await _hubConnection.StartAsync(cancellationToken);
            StatusChanged?.Invoke("Wireless real-time channel connected.");
        }

        return _hubConnection;
    }

    private HubConnection BuildHubConnection()
    {
        var hubUrl = new Uri(_baseUri, "/hubs/wireless");
        var connection = new HubConnectionBuilder()
            .WithUrl(hubUrl)
            .WithAutomaticReconnect()
            .Build();

        connection.On<UploadedDocumentDto>("UploadCompleted", document =>
        {
            UploadCompleted?.Invoke(document);
            StatusChanged?.Invoke($"Upload completed: {document.FileName}");
        });

        connection.On<string>("UploadFailed", message =>
        {
            StatusChanged?.Invoke($"Upload failed: {message}");
        });

        connection.On<string>("SessionExpired", message =>
        {
            StatusChanged?.Invoke(message);
        });

        connection.Reconnecting += error =>
        {
            StatusChanged?.Invoke($"Wireless channel reconnecting: {error?.Message ?? "network interruption"}");
            return Task.CompletedTask;
        };

        connection.Reconnected += _ =>
        {
            StatusChanged?.Invoke("Wireless real-time channel reconnected.");
            return Task.CompletedTask;
        };

        connection.Closed += error =>
        {
            StatusChanged?.Invoke($"Wireless channel closed: {error?.Message ?? "closed"}");
            return Task.CompletedTask;
        };

        return connection;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(WirelessGatewayClient));
        }
    }

    private sealed class CreateSessionRequest
    {
        public required string Source { get; init; }
    }
}
