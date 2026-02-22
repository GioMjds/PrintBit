namespace PrintBit.Application.DTOs;

public sealed class PrintForwardingResultDto
{
    public bool IsSuccess { get; init; }
    public string Message { get; init; } = string.Empty;

    public static PrintForwardingResultDto Success(string message) => new()
    {
        IsSuccess = true,
        Message = message
    };

    public static PrintForwardingResultDto Failed(string message) => new()
    {
        IsSuccess = false,
        Message = message
    };
}
