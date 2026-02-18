using Microsoft.Extensions.DependencyInjection;
using PrintBit.Presentation.ViewModels;

namespace PrintBit.Presentation.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddPresentation(this IServiceCollection services)
    {
        services.AddSingleton<MainWindowViewModel>();
        services.AddSingleton<MainWindow>();
        return services;
    }
}
