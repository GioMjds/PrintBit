using Microsoft.Extensions.DependencyInjection;
using PrintBit.Application.Services;

namespace PrintBit.Application.DependencyInjection;

public static class ServiceCollectionExtensions
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddSingleton<CoinManager>();
        return services;
    }
}
