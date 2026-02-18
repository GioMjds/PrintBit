using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using PrintBit.Application.DependencyInjection;
using PrintBit.Infrastructure.DependencyInjection;
using PrintBit.Presentation.DependencyInjection;

namespace PrintBit.Presentation;

/// <summary>
/// Interaction logic for App.xaml
/// </summary>
public partial class App : System.Windows.Application
{
    private ServiceProvider _serviceProvider = null!;

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        var services = new ServiceCollection();

        services.AddInfrastructure("Data Source=printbit.db");
        services.AddApplication();
        services.AddPresentation();

        _serviceProvider = services.BuildServiceProvider();

        var mainWindow = _serviceProvider.GetRequiredService<MainWindow>();
        mainWindow.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _serviceProvider.Dispose();
        base.OnExit(e);
    }
}

