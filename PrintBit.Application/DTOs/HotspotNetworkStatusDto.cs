namespace PrintBit.Application.DTOs;

public sealed class HotspotNetworkStatusDto
{
    public bool IsNetworkAvailable { get; init; }
    public string? LocalIpv4Address { get; init; }
    public string GuidanceMessage { get; init; } = string.Empty;
}

public sealed class PrinterNetworkValidationResult
{
    public bool IsReady { get; init; }
    public string Message { get; init; } = string.Empty;
}
