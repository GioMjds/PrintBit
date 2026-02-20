namespace PrintBit.Domain.Entities;

public sealed class UploadedDocument
{
    public required Guid DocumentId { get; init; }
    public required Guid SessionId { get; init; }
    public required string FileName { get; init; }
    public required string ContentType { get; init; }
    public required long SizeBytes { get; init; }
    public required string StoredPath { get; init; }
    public required DateTimeOffset UploadedAt { get; init; }
}
