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
}

