using System.IO;
using System.Windows;
using PrintBit.Application.Services;
using Microsoft.Extensions.DependencyInjection;
using PrintBit.Application.DependencyInjection;
using PrintBit.Infrastructure.Coin;
using PrintBit.Infrastructure.DependencyInjection;
using PrintBit.Presentation.DependencyInjection;

namespace PrintBit.Presentation;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : System.Windows.Application
{
    private ServiceProvider _serviceProvider = null!;
    private SerialService? _serialService;
    private CoinManager? _coinManager;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        LoadDotEnvIfPresent();

        var services = new ServiceCollection();

        services.AddInfrastructure("Data Source=printbit.db");
        services.AddApplication();
        services.AddPresentation();

        try
        {
            _serviceProvider = services.BuildServiceProvider();

            // CoinManager is required for app logic
            _coinManager = _serviceProvider.GetRequiredService<CoinManager>();

            // Serial service is optional (allowed to be absent so UI can run without Arduino)
            _serialService = _serviceProvider.GetService<SerialService>();

            if (_serialService is not null)
            {
                try
                {
                    _serialService.OnCoinReceived += HandleCoinReceived;
                    _serialService.OnStatusReceived += HandleSerialStatusReceived;
                    _serialService.OnProtocolError += HandleSerialProtocolError;
                    _serialService.StartListening();

                    Console.WriteLine(
                        $"[Startup] Serial listening on {_serialService.PortName} @ {_serialService.BaudRate}. Protocol: READY / COIN:<value>.");
                }
                catch (Exception ex)
                {
                    var serialDetails = _serialService is null
                        ? "Serial service not initialized."
                        : $"Port={_serialService.PortName}, Baud={_serialService.BaudRate}.";

                    MessageBox.Show(
                        $"{ex.Message}\n\n{serialDetails}\n\nClose Arduino Serial Monitor/Plotter or set PRINTBIT_SERIAL_PORT correctly.",
                        "PrintBit Serial Startup Error",
                        MessageBoxButton.OK,
                        MessageBoxImage.Error);
                    Shutdown(-1);
                    return;
                }
            }
            else
            {
                Console.WriteLine("[Startup] No SerialService registered; running without Arduino.");
            }

            var mainWindow = _serviceProvider.GetRequiredService<MainWindow>();
            mainWindow.Show();
        }
        catch (Exception ex)
        {
            // If we reach here something critical failed (DI, MainWindow, etc.)
            var serialDetails = _serialService is null
                ? "Serial service not initialized."
                : $"Port={_serialService.PortName}, Baud={_serialService.BaudRate}.";

            MessageBox.Show(
                $"{ex.Message}\n\n{serialDetails}\n\nClose Arduino Serial Monitor/Plotter or set PRINTBIT_SERIAL_PORT correctly.",
                "PrintBit Serial Startup Error",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Shutdown(-1);
        }
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_serialService is not null)
        {
            _serialService.OnCoinReceived -= HandleCoinReceived;
            _serialService.OnStatusReceived -= HandleSerialStatusReceived;
            _serialService.OnProtocolError -= HandleSerialProtocolError;
            _serialService.StopListening();
        }

        _serviceProvider.Dispose();
        base.OnExit(e);
    }

    private void HandleCoinReceived(int value)
    {
        _coinManager?.AddCoin(value);
    }

    private static void HandleSerialStatusReceived(string statusLine)
    {
        Console.WriteLine($"[Serial] {statusLine}");
    }

    private static void HandleSerialProtocolError(string invalidLine)
    {
        Console.WriteLine($"[Serial][ProtocolError] Unsupported line: {invalidLine}");
    }

    private static void LoadDotEnvIfPresent()
    {
        var dotEnvPath = ResolveDotEnvPath();
        if (string.IsNullOrWhiteSpace(dotEnvPath) || !File.Exists(dotEnvPath))
        {
            return;
        }

        foreach (var rawLine in File.ReadLines(dotEnvPath))
        {
            var line = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(line) || line.StartsWith('#'))
            {
                continue;
            }

            var separatorIndex = line.IndexOf('=');
            if (separatorIndex <= 0)
            {
                continue;
            }

            var key = line[..separatorIndex].Trim();
            if (string.IsNullOrWhiteSpace(key) || !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable(key)))
            {
                continue;
            }

            var value = line[(separatorIndex + 1)..].Trim();
            if (value.Length >= 2 &&
                ((value.StartsWith('"') && value.EndsWith('"')) || (value.StartsWith('\'') && value.EndsWith('\''))))
            {
                value = value[1..^1];
            }

            Environment.SetEnvironmentVariable(key, value);
        }
    }

    private static string? ResolveDotEnvPath()
    {
        var searchRoots = new[] { Directory.GetCurrentDirectory(), AppContext.BaseDirectory };
        foreach (var root in searchRoots)
        {
            var current = root;
            while (!string.IsNullOrWhiteSpace(current))
            {
                var candidatePath = Path.Combine(current, ".env");
                if (File.Exists(candidatePath))
                {
                    return candidatePath;
                }

                current = Directory.GetParent(current)?.FullName;
            }
        }

        return null;
    }
}

