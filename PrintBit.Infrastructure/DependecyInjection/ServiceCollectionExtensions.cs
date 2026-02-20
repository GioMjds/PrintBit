using System;
using System.IO.Ports;
using System.Linq;
using Microsoft.Extensions.DependencyInjection;
using PrintBit.Application.Interfaces;
using PrintBit.Infrastructure.Coin;
using PrintBit.Infrastructure.Wireless;

namespace PrintBit.Infrastructure.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string connectionString)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(connectionString);

        var wirelessBaseUrl = Environment.GetEnvironmentVariable("PRINTBIT_WIRELESS_BASE_URL");
        if (string.IsNullOrWhiteSpace(wirelessBaseUrl))
        {
            wirelessBaseUrl = "http://localhost:5058";
        }

        services.AddSingleton<IWirelessKioskClient>(_ => new WirelessGatewayClient(wirelessBaseUrl));

        // If set, skip serial/Arduino detection so UI can run standalone.
        var disableSerialRaw = Environment.GetEnvironmentVariable("PRINTBIT_DISABLE_SERIAL");
        var disableSerial = !string.IsNullOrWhiteSpace(disableSerialRaw) &&
                            (disableSerialRaw.Equals("1", StringComparison.OrdinalIgnoreCase)
                             || disableSerialRaw.Equals("true", StringComparison.OrdinalIgnoreCase)
                             || disableSerialRaw.Equals("yes", StringComparison.OrdinalIgnoreCase));

        if (disableSerial)
        {
            // Serial is disabled by environment variable. Return without registering SerialService.
            return services;
        }

        // Configure COM port via PRINTBIT_SERIAL_PORT; otherwise use first detected port.
        var serialPortName = Environment.GetEnvironmentVariable("PRINTBIT_SERIAL_PORT");
        var resolvedPort = string.IsNullOrWhiteSpace(serialPortName)
            ? SerialPort.GetPortNames().OrderBy(port => port, StringComparer.OrdinalIgnoreCase).FirstOrDefault()
            : serialPortName.Trim();

        if (string.IsNullOrWhiteSpace(resolvedPort))
        {
            // No ports detected - skip SerialService registration so the UI can start without hardware.
            return services;
        }

        services.AddSingleton(new SerialService(resolvedPort, 9600));
        return services;
    }
}
