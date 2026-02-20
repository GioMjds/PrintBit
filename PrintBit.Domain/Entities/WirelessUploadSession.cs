using PrintBit.Domain.Enums;

namespace PrintBit.Domain.Entities;

public sealed class WirelessUploadSession
{
    public required Guid SessionId { get; init; }
    public required string Token { get; init; }
    public required DateTimeOffset CreatedAt { get; init; }
    public required DateTimeOffset ExpiresAt { get; init; }
    public UploadSessionStatus Status { get; set; } = UploadSessionStatus.WaitingForUpload;
}
