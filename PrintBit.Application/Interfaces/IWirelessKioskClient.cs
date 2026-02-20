using PrintBit.Application.DTOs;

namespace PrintBit.Application.Interfaces;

public interface IWirelessKioskClient
{
    event Action<UploadedDocumentDto>? UploadCompleted;
    event Action<string>? StatusChanged;

    Task<WirelessUploadSessionDto> CreateSessionAsync(CancellationToken cancellationToken = default);
    Task<IReadOnlyList<UploadedDocumentDto>> GetUploadedDocumentsAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task ConnectToSessionAsync(Guid sessionId, CancellationToken cancellationToken = default);
    Task DisconnectAsync(CancellationToken cancellationToken = default);
}
