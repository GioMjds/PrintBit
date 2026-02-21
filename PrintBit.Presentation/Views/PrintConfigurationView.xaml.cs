using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Controls;
using System.Windows.Input;
using Microsoft.Web.WebView2.Core;
using PrintBit.Presentation.ViewModels;

namespace PrintBit.Presentation.Views;

public partial class PrintConfigurationView : UserControl
{
    private MainWindowViewModel? _viewModel;
    private bool _isWebViewReady;

    public PrintConfigurationView()
    {
        InitializeComponent();
        Loaded += HandleLoaded;
        DataContextChanged += HandleDataContextChanged;
        Unloaded += HandleUnloaded;
        PreviewKeyDown += HandlePreviewKeyDown;
    }

    private async void HandleLoaded(object sender, System.Windows.RoutedEventArgs e)
    {
        await SafeNavigatePreviewAsync(_viewModel?.DocumentPreviewUri);
    }

    private void HandleDataContextChanged(object sender, System.Windows.DependencyPropertyChangedEventArgs e)
    {
        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged -= HandleViewModelPropertyChanged;
        }

        _viewModel = DataContext as MainWindowViewModel;
        if (_viewModel is null)
        {
            return;
        }

        _viewModel.PropertyChanged += HandleViewModelPropertyChanged;
        _ = SafeNavigatePreviewAsync(_viewModel.DocumentPreviewUri);
    }

    private void HandleViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainWindowViewModel.DocumentPreviewUri))
        {
            _ = SafeNavigatePreviewAsync(_viewModel?.DocumentPreviewUri);
        }
    }

    private async Task EnsureWebViewReadyAsync()
    {
        if (_isWebViewReady)
        {
            return;
        }

        await DocumentPreviewBrowser.EnsureCoreWebView2Async();
        _isWebViewReady = true;

        var coreWebView = DocumentPreviewBrowser.CoreWebView2;
        if (coreWebView is null)
        {
            _isWebViewReady = false;
            throw new InvalidOperationException("WebView2 core was not initialized.");
        }

        try
        {
            coreWebView.Settings.AreDefaultContextMenusEnabled = false;
            coreWebView.Settings.AreDevToolsEnabled = false;
            coreWebView.Settings.AreBrowserAcceleratorKeysEnabled = false;
            coreWebView.Settings.IsZoomControlEnabled = false;
            coreWebView.Settings.HiddenPdfToolbarItems =
                CoreWebView2PdfToolbarItems.Save |
                CoreWebView2PdfToolbarItems.SaveAs |
                CoreWebView2PdfToolbarItems.Print;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"WebView2 settings fallback: {ex.Message}");
        }

        coreWebView.NewWindowRequested += HandleNewWindowRequested;
        coreWebView.DownloadStarting += HandleDownloadStarting;
    }

    private async Task NavigatePreviewAsync(Uri? previewUri)
    {
        await EnsureWebViewReadyAsync();

        if (previewUri is null)
        {
            NavigateHtml("No preview available.");
            return;
        }

        try
        {
            var sourcePath = previewUri.LocalPath;
            if (!File.Exists(sourcePath))
            {
                NavigateHtml("Preview file not found.");
                return;
            }

            var extension = Path.GetExtension(sourcePath).ToLowerInvariant();
            var targetPath = extension is ".doc" or ".docx"
                ? ConvertWordDocumentToPdf(sourcePath)
                : sourcePath;

            DocumentPreviewBrowser.CoreWebView2.Navigate(new Uri(targetPath).AbsoluteUri);
        }
        catch (TimeoutException ex)
        {
            NavigateHtml($"Preview conversion timed out. {ex.Message}");
        }
        catch (InvalidOperationException ex)
        {
            NavigateHtml($"Preview conversion failed. {ex.Message}");
        }
        catch (IOException ex)
        {
            NavigateHtml($"Unable to load preview file. {ex.Message}");
        }
        catch (UnauthorizedAccessException ex)
        {
            NavigateHtml($"Preview access denied. {ex.Message}");
        }
        catch (UriFormatException ex)
        {
            NavigateHtml($"Preview path is invalid. {ex.Message}");
        }
    }

    private async Task SafeNavigatePreviewAsync(Uri? previewUri)
    {
        try
        {
            await NavigatePreviewAsync(previewUri);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Preview initialization failed: {ex.Message}");
            if (DocumentPreviewBrowser.CoreWebView2 is not null)
            {
                NavigateHtml($"Preview engine unavailable. {ex.Message}");
            }
        }
    }

    private static string ConvertWordDocumentToPdf(string sourcePath)
    {
        var cacheFolder = Path.Combine(Path.GetTempPath(), "PrintBit", "PreviewCache");
        Directory.CreateDirectory(cacheFolder);

        var cacheKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{sourcePath}|{File.GetLastWriteTimeUtc(sourcePath).Ticks}")));
        var outputPdfPath = Path.Combine(cacheFolder, $"{cacheKey}.pdf");
        if (File.Exists(outputPdfPath))
        {
            return outputPdfPath;
        }

        var sourceExtension = Path.GetExtension(sourcePath);
        var conversionSourcePath = Path.Combine(cacheFolder, $"{cacheKey}{sourceExtension}");
        File.Copy(sourcePath, conversionSourcePath, overwrite: true);

        var sofficePath = ResolveLibreOfficePath();
        if (sofficePath is null)
        {
            throw new IOException("LibreOffice is not installed or PRINTBIT_LIBREOFFICE_PATH is not configured.");
        }

        ConvertWithLibreOffice(sofficePath, conversionSourcePath, cacheFolder);
        if (!File.Exists(outputPdfPath))
        {
            throw new IOException("LibreOffice conversion did not produce a preview PDF.");
        }

        return outputPdfPath;
    }

    private static string? ResolveLibreOfficePath()
    {
        var configuredPath = Environment.GetEnvironmentVariable("PRINTBIT_LIBREOFFICE_PATH");
        if (!string.IsNullOrWhiteSpace(configuredPath) && File.Exists(configuredPath))
        {
            return configuredPath;
        }

        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "LibreOffice", "program", "soffice.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "LibreOffice", "program", "soffice.exe")
        };

        foreach (var candidate in candidates)
        {
            if (File.Exists(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    private static void ConvertWithLibreOffice(string sofficePath, string sourcePath, string outputDirectory)
    {
        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = sofficePath,
            Arguments = $"--headless --nologo --nodefault --norestore --nolockcheck --convert-to pdf --outdir \"{outputDirectory}\" \"{sourcePath}\"",
            UseShellExecute = false,
            CreateNoWindow = true
        };

        if (!process.Start())
        {
            throw new InvalidOperationException("Failed to start LibreOffice conversion process.");
        }

        if (!process.WaitForExit(60000))
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }

            throw new TimeoutException("LibreOffice did not finish within 60 seconds.");
        }

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"LibreOffice conversion failed with exit code {process.ExitCode}.");
        }
    }

    private void HandleNewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        e.Handled = true;
    }

    private void HandleDownloadStarting(object? sender, CoreWebView2DownloadStartingEventArgs e)
    {
        e.Cancel = true;
        NavigateHtml("Kiosk preview blocked external download. Use supported preview format or continue to print.");
    }

    private void HandlePreviewKeyDown(object sender, KeyEventArgs e)
    {
        if ((Keyboard.Modifiers & ModifierKeys.Control) != ModifierKeys.Control)
        {
            return;
        }

        if (e.Key is Key.P or Key.S or Key.O or Key.N)
        {
            e.Handled = true;
        }
    }

    private void NavigateHtml(string message)
    {
        var safeMessage = System.Net.WebUtility.HtmlEncode(message);
        DocumentPreviewBrowser.CoreWebView2.NavigateToString(
            $"<html><body style=\"font-family:Segoe UI; color:#666; padding:16px;\">{safeMessage}</body></html>");
    }

    private void HandleUnloaded(object sender, System.Windows.RoutedEventArgs e)
    {
        if (_viewModel is not null)
        {
            _viewModel.PropertyChanged -= HandleViewModelPropertyChanged;
            _viewModel = null;
        }

        if (DocumentPreviewBrowser.CoreWebView2 is not null)
        {
            DocumentPreviewBrowser.CoreWebView2.NewWindowRequested -= HandleNewWindowRequested;
            DocumentPreviewBrowser.CoreWebView2.DownloadStarting -= HandleDownloadStarting;
        }

        PreviewKeyDown -= HandlePreviewKeyDown;
    }
}
