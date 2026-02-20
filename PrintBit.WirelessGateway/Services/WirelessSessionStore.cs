using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;
using PrintBit.Application.DTOs;
using PrintBit.Domain.Entities;
using PrintBit.Domain.Enums;

namespace PrintBit.WirelessGateway.Services;

public sealed class WirelessSessionStore
{
    private static readonly HashSet<string> AllowedFileExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf",
        ".doc",
        ".docx",
        ".png",
        ".jpg",
        ".jpeg"
    };

    private const long MaxUploadBytes = 25 * 1024 * 1024;

    private readonly ConcurrentDictionary<Guid, SessionEntry> _sessions = new();
    private readonly ConcurrentDictionary<string, Guid> _tokenToSession = new(StringComparer.Ordinal);
    private readonly JsonSerializerOptions _jsonOptions = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true
    };

    private readonly string _uploadsRoot;

    public WirelessSessionStore(IWebHostEnvironment hostEnvironment)
    {
        _uploadsRoot = Path.Combine(hostEnvironment.ContentRootPath, "wireless-uploads");
        Directory.CreateDirectory(_uploadsRoot);
    }

    public WirelessUploadSessionDto CreateSession(Uri publicBaseUrl, TimeSpan timeToLive)
    {
        var now = DateTimeOffset.UtcNow;
        var sessionId = Guid.NewGuid();
        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

        var session = new WirelessUploadSession
        {
            SessionId = sessionId,
            Token = token,
            CreatedAt = now,
            ExpiresAt = now.Add(timeToLive),
            Status = UploadSessionStatus.WaitingForUpload
        };

        var entry = new SessionEntry(session);
        _sessions[sessionId] = entry;
        _tokenToSession[token] = sessionId;

        PersistSessionMetadata(entry, publicBaseUrl);
        return ToDto(entry, publicBaseUrl);
    }

    public bool TryGetSession(Guid sessionId, Uri publicBaseUrl, out WirelessUploadSessionDto? session)
    {
        session = null;
        if (!_sessions.TryGetValue(sessionId, out var entry))
        {
            return false;
        }

        lock (entry.SyncRoot)
        {
            session = ToDto(entry, publicBaseUrl);
            return true;
        }
    }

    public bool TryGetSessionByToken(string token, Uri publicBaseUrl, out WirelessUploadSessionDto? session)
    {
        session = null;
        if (!_tokenToSession.TryGetValue(token, out var sessionId))
        {
            return false;
        }

        return TryGetSession(sessionId, publicBaseUrl, out session);
    }

    public async Task<StoreUploadResult> StoreUploadAsync(
        Guid sessionId,
        string token,
        IFormFile file,
        Uri publicBaseUrl,
        CancellationToken cancellationToken)
    {
        if (!_sessions.TryGetValue(sessionId, out var entry))
        {
            return StoreUploadResult.Failed("Session not found.");
        }

        if (file.Length <= 0)
        {
            return StoreUploadResult.Failed("Uploaded file is empty.");
        }

        if (file.Length > MaxUploadBytes)
        {
            return StoreUploadResult.Failed($"File is too large. Maximum allowed is {MaxUploadBytes / (1024 * 1024)} MB.");
        }

        var extension = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(extension) || !AllowedFileExtensions.Contains(extension))
        {
            return StoreUploadResult.Failed("Unsupported file type.");
        }

        lock (entry.SyncRoot)
        {
            if (!string.Equals(entry.Session.Token, token, StringComparison.Ordinal))
            {
                return StoreUploadResult.Failed("Invalid session token.");
            }

            if (entry.Session.ExpiresAt <= DateTimeOffset.UtcNow)
            {
                entry.Session.Status = UploadSessionStatus.Expired;
                PersistSessionMetadata(entry, publicBaseUrl);
                return StoreUploadResult.Failed("Session expired. Please scan a new QR code.");
            }

            if (entry.Session.Status is UploadSessionStatus.Cancelled or UploadSessionStatus.Expired)
            {
                return StoreUploadResult.Failed("Session is no longer active.");
            }
        }

        var safeFileName = SanitizeFileName(file.FileName);
        var storedFileName = $"{Guid.NewGuid():N}_{safeFileName}";
        var sessionFolder = Path.Combine(_uploadsRoot, DateTime.UtcNow.ToString("yyyyMMdd"), sessionId.ToString("N"));
        Directory.CreateDirectory(sessionFolder);

        var absoluteStoredPath = Path.Combine(sessionFolder, storedFileName);
        await using (var fileStream = File.Create(absoluteStoredPath))
        {
            await file.CopyToAsync(fileStream, cancellationToken);
        }

        var document = new UploadedDocumentDto
        {
            DocumentId = Guid.NewGuid(),
            SessionId = sessionId,
            FileName = safeFileName,
            ContentType = string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType,
            SizeBytes = file.Length,
            StoredPath = absoluteStoredPath,
            UploadedAt = DateTimeOffset.UtcNow
        };

        lock (entry.SyncRoot)
        {
            entry.Documents.Add(document);
            entry.Session.Status = UploadSessionStatus.Uploaded;
            PersistSessionMetadata(entry, publicBaseUrl);
        }

        return StoreUploadResult.Success(document);
    }

    public IReadOnlyList<Guid> MarkExpiredSessions()
    {
        var now = DateTimeOffset.UtcNow;
        var expiredSessionIds = new List<Guid>();

        foreach (var entry in _sessions.Values)
        {
            lock (entry.SyncRoot)
            {
                if (entry.Session.Status == UploadSessionStatus.WaitingForUpload && entry.Session.ExpiresAt <= now)
                {
                    entry.Session.Status = UploadSessionStatus.Expired;
                    expiredSessionIds.Add(entry.Session.SessionId);
                }
            }
        }

        return expiredSessionIds;
    }

    private WirelessUploadSessionDto ToDto(SessionEntry entry, Uri publicBaseUrl)
    {
        return new WirelessUploadSessionDto
        {
            SessionId = entry.Session.SessionId,
            Token = entry.Session.Token,
            UploadUrl = BuildUploadUrl(publicBaseUrl, entry.Session.Token),
            CreatedAt = entry.Session.CreatedAt,
            ExpiresAt = entry.Session.ExpiresAt,
            Status = entry.Session.Status,
            Documents = entry.Documents.ToArray()
        };
    }

    private void PersistSessionMetadata(SessionEntry entry, Uri publicBaseUrl)
    {
        var metadataFolder = Path.Combine(_uploadsRoot, "metadata");
        Directory.CreateDirectory(metadataFolder);

        var metadataFile = Path.Combine(metadataFolder, $"{entry.Session.SessionId:N}.json");
        var dto = ToDto(entry, publicBaseUrl);
        var json = JsonSerializer.Serialize(dto, _jsonOptions);
        File.WriteAllText(metadataFile, json);
    }

    private static string BuildUploadUrl(Uri publicBaseUrl, string token)
    {
        return new Uri(publicBaseUrl, $"/upload/{token}").ToString();
    }

    private static string SanitizeFileName(string fileName)
    {
        var baseName = Path.GetFileName(fileName);
        foreach (var invalidCharacter in Path.GetInvalidFileNameChars())
        {
            baseName = baseName.Replace(invalidCharacter, '_');
        }

        return baseName;
    }

    private sealed class SessionEntry
    {
        public SessionEntry(WirelessUploadSession session)
        {
            Session = session;
        }

        public WirelessUploadSession Session { get; }
        public List<UploadedDocumentDto> Documents { get; } = [];
        public object SyncRoot { get; } = new();
    }
}

public sealed class StoreUploadResult
{
    private StoreUploadResult(bool isSuccess, UploadedDocumentDto? document, string? errorMessage)
    {
        IsSuccess = isSuccess;
        Document = document;
        ErrorMessage = errorMessage;
    }

    public bool IsSuccess { get; }
    public UploadedDocumentDto? Document { get; }
    public string? ErrorMessage { get; }

    public static StoreUploadResult Success(UploadedDocumentDto document) => new(true, document, null);

    public static StoreUploadResult Failed(string message) => new(false, null, message);
}
