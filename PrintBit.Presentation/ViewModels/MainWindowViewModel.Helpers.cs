using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using QRCoder;

namespace PrintBit.Presentation.ViewModels;

public sealed partial class MainWindowViewModel
{
    private static ImageSource BuildQrCodeImage(string payload)
    {
        using var qrGenerator = new QRCodeGenerator();
        using var qrCodeData = qrGenerator.CreateQrCode(payload, QRCodeGenerator.ECCLevel.Q);
        var qrCode = new PngByteQRCode(qrCodeData);
        var pngBytes = qrCode.GetGraphic(20);

        using var memoryStream = new MemoryStream(pngBytes);
        var bitmap = new BitmapImage();
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = memoryStream;
        bitmap.EndInit();
        bitmap.Freeze();
        return bitmap;
    }

    private static ImageSource? BuildWifiQrCodeImage(string ssid, string password)
    {
        if (string.IsNullOrWhiteSpace(ssid))
        {
            return null;
        }

        var securityType = string.IsNullOrWhiteSpace(password) ? "nopass" : "WPA";
        var escapedSsid = EscapeWifiQrField(ssid);
        var escapedPassword = EscapeWifiQrField(password);
        var wifiPayload = string.IsNullOrWhiteSpace(password)
            ? $"WIFI:T:{securityType};S:{escapedSsid};;"
            : $"WIFI:T:{securityType};S:{escapedSsid};P:{escapedPassword};;";

        return BuildQrCodeImage(wifiPayload);
    }

    private static string EscapeWifiQrField(string value)
    {
        return value
            .Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace(";", "\\;", StringComparison.Ordinal)
            .Replace(":", "\\:", StringComparison.Ordinal)
            .Replace(",", "\\,", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal);
    }

    private static string ResolveUploadUrlForStepOneNetwork(string uploadUrl, string? stepOneIpv4Address)
    {
        if (string.IsNullOrWhiteSpace(uploadUrl)
            || string.IsNullOrWhiteSpace(stepOneIpv4Address)
            || !Uri.TryCreate(uploadUrl, UriKind.Absolute, out var uploadUri)
            || !IPAddress.TryParse(stepOneIpv4Address, out var networkAddress)
            || networkAddress.AddressFamily != AddressFamily.InterNetwork)
        {
            return uploadUrl;
        }

        var resolvedAddress = networkAddress.ToString();
        if (string.Equals(uploadUri.Host, resolvedAddress, StringComparison.OrdinalIgnoreCase))
        {
            return uploadUrl;
        }

        var uploadUriBuilder = new UriBuilder(uploadUri)
        {
            Host = resolvedAddress
        };

        return uploadUriBuilder.Uri.ToString();
    }

    private static TimeSpan ResolveNetworkJoinTimeout()
    {
        var rawTimeout = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_JOIN_TIMEOUT_SECONDS");
        if (int.TryParse(rawTimeout, out var seconds) && seconds > 0)
        {
            return TimeSpan.FromSeconds(seconds);
        }

        return TimeSpan.FromSeconds(90);
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

    private static string ResolveHotspotPassword()
    {
        var overridePassword = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_PASSWORD_OVERRIDE");
        if (!string.IsNullOrWhiteSpace(overridePassword))
        {
            return overridePassword.Trim();
        }

        var detectedSsid = TryResolveConnectedWifiSsid();
        if (!string.IsNullOrWhiteSpace(detectedSsid))
        {
            var detectedPassword = TryResolveWifiPassword(detectedSsid);
            if (!string.IsNullOrWhiteSpace(detectedPassword))
            {
                return detectedPassword;
            }
        }

        var configuredPassword = Environment.GetEnvironmentVariable("PRINTBIT_NETWORK_PASSWORD");
        if (string.IsNullOrWhiteSpace(configuredPassword))
        {
            configuredPassword = Environment.GetEnvironmentVariable("PRINTBIT_HOTSPOT_PASSWORD");
        }
        return string.IsNullOrWhiteSpace(configuredPassword) ? "PrintBit1234" : configuredPassword.Trim();
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

    private static string? TryResolveWifiPassword(string ssid)
    {
        if (string.IsNullOrWhiteSpace(ssid))
        {
            return null;
        }

        var escapedSsid = ssid.Replace("\"", "\\\"", StringComparison.Ordinal);
        var output = RunNetshCommand($"wlan show profile name=\"{escapedSsid}\" key=clear");
        if (string.IsNullOrWhiteSpace(output))
        {
            return null;
        }

        foreach (var line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = line.Trim();
            if (!trimmed.StartsWith("Key Content", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var separatorIndex = trimmed.IndexOf(':');
            if (separatorIndex <= 0)
            {
                continue;
            }

            var password = trimmed[(separatorIndex + 1)..].Trim();
            if (!string.IsNullOrWhiteSpace(password))
            {
                return password;
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
