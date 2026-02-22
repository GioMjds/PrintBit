using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.ComponentModel;
using System.Diagnostics;
using PrintBit.Application.DTOs;
using PrintBit.Application.Interfaces;

namespace PrintBit.Infrastructure.Network;

public sealed class KioskNetworkService : IKioskNetworkService
{
    private readonly string _hotspotSsid;
    private readonly bool _routerMode;
    private readonly string? _configuredLocalIp;
    private readonly string? _preferredInterface;
    private readonly string _printerHost;
    private readonly int _printerPingTimeoutMs;

    public KioskNetworkService()
    {
        _hotspotSsid = ResolveHotspotSsid();
        _routerMode = ResolveRouterMode();
        _configuredLocalIp = ResolveConfiguredLocalIp();
        _preferredInterface = ResolvePreferredInterface();
        _printerHost = (Environment.GetEnvironmentVariable("PRINTBIT_PRINTER_HOST") ?? string.Empty).Trim();
        _printerPingTimeoutMs = ResolvePrinterPingTimeout();
    }

    public HotspotNetworkStatusDto GetHotspotStatus()
    {
        var localIpv4 = ResolveLocalIpv4Address();
        if (string.IsNullOrWhiteSpace(localIpv4))
        {
            return new HotspotNetworkStatusDto
            {
                IsNetworkAvailable = false,
                GuidanceMessage = "Kiosk network not detected. Ensure router/kiosk network is available."
            };
        }

        return new HotspotNetworkStatusDto
        {
            IsNetworkAvailable = true,
            LocalIpv4Address = localIpv4,
            GuidanceMessage = $"Scan Wi-Fi QR and connect to '{_hotspotSsid}'. Kiosk network IP: {localIpv4}."
        };
    }

    public PrinterNetworkValidationResult ValidatePrinterConnection()
    {
        if (string.IsNullOrWhiteSpace(_printerHost))
        {
            return new PrinterNetworkValidationResult
            {
                IsReady = false,
                Message = "Printer is not configured. Set PRINTBIT_PRINTER_HOST before printing."
            };
        }

        try
        {
            using var ping = new Ping();
            var reply = ping.Send(_printerHost, _printerPingTimeoutMs);
            if (reply?.Status == IPStatus.Success)
            {
                return new PrinterNetworkValidationResult
                {
                    IsReady = true,
                    Message = $"Printer reachable at {_printerHost}."
                };
            }

            return new PrinterNetworkValidationResult
            {
                IsReady = false,
                Message = $"Printer unreachable at {_printerHost}. Ensure printer is on kiosk network."
            };
        }
        catch (PingException ex)
        {
            return new PrinterNetworkValidationResult
            {
                IsReady = false,
                Message = $"Printer network check failed: {ex.Message}"
            };
        }
        catch (SocketException ex)
        {
            return new PrinterNetworkValidationResult
            {
                IsReady = false,
                Message = $"Printer address error: {ex.Message}"
            };
        }
        catch (InvalidOperationException ex)
        {
            return new PrinterNetworkValidationResult
            {
                IsReady = false,
                Message = $"Printer check unavailable: {ex.Message}"
            };
        }
    }

    private static string ResolveHotspotSsid()
    {
        var overrideSsid = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_SSID_OVERRIDE");
        if (!string.IsNullOrWhiteSpace(overrideSsid))
        {
            return overrideSsid.Trim();
        }

        var detectedSsid = TryResolveConnectedWifiSsid();
        if (!string.IsNullOrWhiteSpace(detectedSsid))
        {
            return detectedSsid;
        }

        var configuredSsid = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_SSID");
        if (string.IsNullOrWhiteSpace(configuredSsid))
        {
            configuredSsid = Environment.GetEnvironmentVariable("PRINTBIT_HOTSPOT_SSID");
        }
        return string.IsNullOrWhiteSpace(configuredSsid) ? "PrintBit-Kiosk" : configuredSsid.Trim();
    }

    private static bool ResolveRouterMode()
    {
        var mode = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_MODE");
        return string.Equals(mode, "router", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ResolveConfiguredLocalIp()
    {
        var localIp = Environment.GetEnvironmentVariable("PRINTBIT_KIOSK_LOCAL_IP");
        return string.IsNullOrWhiteSpace(localIp) ? null : localIp.Trim();
    }

    private static string? ResolvePreferredInterface()
    {
        var preferredInterface = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_INTERFACE");
        return string.IsNullOrWhiteSpace(preferredInterface) ? null : preferredInterface.Trim();
    }

    private static int ResolvePrinterPingTimeout()
    {
        var raw = Environment.GetEnvironmentVariable("PRINTBIT_PRINTER_PING_TIMEOUT_MS");
        return int.TryParse(raw, out var timeoutMs) && timeoutMs > 0
            ? timeoutMs
            : 1500;
    }

    private string? ResolveLocalIpv4Address()
    {
        if (!string.IsNullOrWhiteSpace(_configuredLocalIp)
            && IPAddress.TryParse(_configuredLocalIp, out var configuredIp)
            && configuredIp.AddressFamily == AddressFamily.InterNetwork)
        {
            return configuredIp.ToString();
        }

        if (!string.IsNullOrWhiteSpace(_preferredInterface))
        {
            var preferredAddress = ResolveInterfaceIpv4Address(_preferredInterface);
            if (!string.IsNullOrWhiteSpace(preferredAddress))
            {
                return preferredAddress;
            }
        }

        string? fallback = null;

        foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (networkInterface.OperationalStatus != OperationalStatus.Up)
            {
                continue;
            }

            if (networkInterface.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel)
            {
                continue;
            }

            foreach (var unicast in networkInterface.GetIPProperties().UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(unicast.Address))
                {
                    continue;
                }

                var ipAddress = unicast.Address.ToString();
                if (!_routerMode && (IsLikelyHotspotAddress(ipAddress) || IsLikelyHotspotInterface(networkInterface)))
                {
                    return ipAddress;
                }

                fallback ??= ipAddress;
            }
        }

        return fallback;
    }

    private static bool IsLikelyHotspotAddress(string ipAddress)
    {
        return ipAddress.StartsWith("192.168.137.", StringComparison.Ordinal);
    }

    private static bool IsLikelyHotspotInterface(NetworkInterface networkInterface)
    {
        var descriptor = $"{networkInterface.Name} {networkInterface.Description}";
        return descriptor.Contains("Local Area Connection", StringComparison.OrdinalIgnoreCase)
            || descriptor.Contains("Hosted Network", StringComparison.OrdinalIgnoreCase)
            || descriptor.Contains("Mobile Hotspot", StringComparison.OrdinalIgnoreCase);
    }

    private static string? ResolveInterfaceIpv4Address(string preferredInterface)
    {
        foreach (var networkInterface in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (networkInterface.OperationalStatus != OperationalStatus.Up)
            {
                continue;
            }

            var descriptor = $"{networkInterface.Name} {networkInterface.Description}";
            if (!descriptor.Contains(preferredInterface, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            foreach (var unicast in networkInterface.GetIPProperties().UnicastAddresses)
            {
                if (unicast.Address.AddressFamily != AddressFamily.InterNetwork || IPAddress.IsLoopback(unicast.Address))
                {
                    continue;
                }

                return unicast.Address.ToString();
            }
        }

        return null;
    }

    private static string? TryResolveConnectedWifiSsid()
    {
        var output = RunNetshCommand("wlan show interfaces");
        if (string.IsNullOrWhiteSpace(output))
        {
            return null;
        }

        foreach (var line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("BSSID", StringComparison.OrdinalIgnoreCase)
                || !trimmed.StartsWith("SSID", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var separatorIndex = trimmed.IndexOf(':');
            if (separatorIndex <= 0)
            {
                continue;
            }

            var ssid = trimmed[(separatorIndex + 1)..].Trim();
            if (!string.IsNullOrWhiteSpace(ssid))
            {
                return ssid;
            }
        }

        return null;
    }

    private static string? RunNetshCommand(string arguments)
    {
        try
        {
            using var process = new Process
            {
                StartInfo = new ProcessStartInfo
                {
                    FileName = "netsh",
                    Arguments = arguments,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };

            if (!process.Start())
            {
                return null;
            }

            var output = process.StandardOutput.ReadToEnd();
            _ = process.StandardError.ReadToEnd();

            process.WaitForExit(4000);
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
                return null;
            }

            return process.ExitCode == 0 ? output : null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
        catch (Win32Exception)
        {
            return null;
        }
    }
}
