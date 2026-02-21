using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Controls;
using Microsoft.Web.WebView2.Core;
using PrintBit.Presentation.ViewModels;
using Word = Microsoft.Office.Interop.Word;

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
    }

    private async void HandleLoaded(object sender, System.Windows.RoutedEventArgs e)
    {
        await EnsureWebViewReadyAsync();
        await NavigatePreviewAsync(_viewModel?.DocumentPreviewUri);
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
        _ = NavigatePreviewAsync(_viewModel.DocumentPreviewUri);
    }

    private void HandleViewModelPropertyChanged(object? sender, PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(MainWindowViewModel.DocumentPreviewUri))
        {
            _ = NavigatePreviewAsync(_viewModel?.DocumentPreviewUri);
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

        DocumentPreviewBrowser.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        DocumentPreviewBrowser.CoreWebView2.Settings.AreDevToolsEnabled = false;
        DocumentPreviewBrowser.CoreWebView2.NewWindowRequested += HandleNewWindowRequested;
        DocumentPreviewBrowser.CoreWebView2.DownloadStarting += HandleDownloadStarting;
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
        catch (COMException ex)
        {
            NavigateHtml($"Unable to render Word document inside kiosk preview. {ex.Message}");
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

        Word.Application? wordApplication = null;
        Word.Document? wordDocument = null;
        try
        {
            wordApplication = new Word.Application
            {
                Visible = false,
                DisplayAlerts = Word.WdAlertLevel.wdAlertsNone
            };

            wordDocument = wordApplication.Documents.Open(
                FileName: sourcePath,
                ConfirmConversions: false,
                ReadOnly: true,
                AddToRecentFiles: false,
                Visible: false,
                OpenAndRepair: true,
                NoEncodingDialog: true);

            wordDocument.SaveAs2(
                FileName: outputPdfPath,
                FileFormat: Word.WdSaveFormat.wdFormatPDF);

            return outputPdfPath;
        }
        finally
        {
            if (wordDocument is not null)
            {
                wordDocument.Close(Word.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.FinalReleaseComObject(wordDocument);
            }

            if (wordApplication is not null)
            {
                wordApplication.Quit(Word.WdSaveOptions.wdDoNotSaveChanges);
                Marshal.FinalReleaseComObject(wordApplication);
            }
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
    }
}
