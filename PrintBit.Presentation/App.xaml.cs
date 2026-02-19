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

        _serviceProvider = services.BuildServiceProvider();
        _serialService = _serviceProvider.GetRequiredService<SerialService>();
        _coinManager = _serviceProvider.GetRequiredService<CoinManager>();
        _serialService.OnCoinReceived += HandleCoinReceived;
        _serialService.StartListening();

        var mainWindow = _serviceProvider.GetRequiredService<MainWindow>();
        mainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        if (_serialService is not null)
        {
            _serialService.OnCoinReceived -= HandleCoinReceived;
            _serialService.StopListening();
        }

        _serviceProvider.Dispose();
        base.OnExit(e);
    }

    private void HandleCoinReceived(int value)
    {
        _coinManager?.AddCoin(value);
    }
}

