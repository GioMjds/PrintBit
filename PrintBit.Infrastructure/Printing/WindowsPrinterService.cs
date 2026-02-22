using System.ComponentModel;
using System.Diagnostics;
using PrintBit.Application.DTOs;
using PrintBit.Application.Interfaces;

namespace PrintBit.Infrastructure.Printing;

public sealed class WindowsPrinterService : IPrintForwardingService
{
    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".pdf",
        ".doc",
        ".docx"
    };

    private readonly string? _printerName;

    public WindowsPrinterService()
    {
        var configuredPrinterName = Environment.GetEnvironmentVariable("PRINTBIT_PRINTER_NAME");
        _printerName = string.IsNullOrWhiteSpace(configuredPrinterName) ? null : configuredPrinterName.Trim();
    }

    public async Task<PrintForwardingResultDto> ForwardFileAsync(string filePath, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            return PrintForwardingResultDto.Failed("No file path provided for printing.");
        }

        if (!File.Exists(filePath))
        {
            return PrintForwardingResultDto.Failed($"File not found for printing: {filePath}");
        }

        var extension = Path.GetExtension(filePath);
        if (!SupportedExtensions.Contains(extension))
        {
            return PrintForwardingResultDto.Failed($"Unsupported file type for print forwarding: {extension}");
        }

        var processStartInfo = new ProcessStartInfo
        {
            FileName = filePath,
            Verb = string.IsNullOrWhiteSpace(_printerName) ? "print" : "printto",
            UseShellExecute = true,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden
        };

        if (!string.IsNullOrWhiteSpace(_printerName))
        {
            processStartInfo.Arguments = $"\"{_printerName}\"";
        }

        try
        {
            using var process = Process.Start(processStartInfo);
            if (process is null)
            {
                return PrintForwardingResultDto.Failed("Unable to start print process.");
            }

            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            var target = string.IsNullOrWhiteSpace(_printerName) ? "default printer" : _printerName;
            return PrintForwardingResultDto.Success($"Print job sent to {target}.");
        }
        catch (Win32Exception ex)
        {
            return PrintForwardingResultDto.Failed($"Print forwarding failed: {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            return PrintForwardingResultDto.Failed($"Print forwarding failed: {ex.Message}");
        }
        catch (PlatformNotSupportedException ex)
        {
            return PrintForwardingResultDto.Failed($"Print forwarding unsupported on this platform: {ex.Message}");
        }
    }
}
