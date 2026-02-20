using PrintBit.Domain.Enums;

namespace PrintBit.Application.DTOs;

public sealed class WirelessUploadSessionDto
{
    public required Guid SessionId { get; init; }
    public required string Token { get; init; }
    public required string UploadUrl { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public UploadSessionStatus Status { get; init; } = UploadSessionStatus.WaitingForUpload;
    public IReadOnlyList<UploadedDocumentDto> Documents { get; init; } = Array.Empty<UploadedDocumentDto>();
}
