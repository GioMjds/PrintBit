using PrintBit.Application.DTOs;

namespace PrintBit.Application.Interfaces;

public interface IPrintForwardingService
{
    Task<PrintForwardingResultDto> ForwardFileAsync(string filePath, CancellationToken cancellationToken = default);
}
