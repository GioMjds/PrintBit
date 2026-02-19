using System.IO.Ports;
using Microsoft.Extensions.DependencyInjection;
using PrintBit.Infrastructure.Coin;

namespace PrintBit.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);
        // Configure COM port via PRINTBIT_SERIAL_PORT; otherwise use first detected port.
        var serialPortName = Environment.GetEnvironmentVariable("PRINTBIT_SERIAL_PORT");
        var resolvedPort = string.IsNullOrWhiteSpace(serialPortName)
            ? SerialPort.GetPortNames().OrderBy(port => port, StringComparer.OrdinalIgnoreCase).FirstOrDefault()
            : serialPortName.Trim();

        if (string.IsNullOrWhiteSpace(resolvedPort))
        {
            throw new InvalidOperationException("No serial COM ports detected. Connect Arduino or set PRINTBIT_SERIAL_PORT.");
        }

        services.AddSingleton(new SerialService(resolvedPort, 9600));
        return services;
    }
}
