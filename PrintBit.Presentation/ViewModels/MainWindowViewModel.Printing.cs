using System;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Input;

namespace PrintBit.Presentation.ViewModels;

public sealed partial class MainWindowViewModel
{
    private async Task StartPrintAsync()
    {
        if (!CanPrint || _isForwardingPrint)
        {
            return;
        }

        if (!TryResolveSelectedDocumentPath(out var selectedDocumentPath, out var fileName))
        {
            return;
        }

        var printerValidation = _kioskNetworkService.ValidatePrinterConnection();
        if (!printerValidation.IsReady)
        {
            StatusMessage = printerValidation.Message;
            return;
        }

        _isForwardingPrint = true;
        OnPropertyChanged(nameof(CanPrint));
        CommandManager.InvalidateRequerySuggested();

        try
        {
            StatusMessage = $"Sending {fileName} to printer queue...";

            var forwardingResult = await _printForwardingService.ForwardFileAsync(selectedDocumentPath);
            if (!forwardingResult.IsSuccess)
            {
                StatusMessage = forwardingResult.Message;
                return;
            }

            var changeAmount = Change;
            ResetBalanceCommand.Execute(null);
            Copies = 1;
            SelectedPageSelectionMode = "All Pages";
            SelectedColorMode = "Colored";
            PageRange = "1-2";
            SelectedUploadedFile = null;
            ScannedDocumentName = null;

            _networkJoinTimer.Stop();
            _sessionCountdownTimer.Stop();
            _activeWirelessSessionId = null;
            _activeSessionExpiresAt = null;
            _stepOneLocalIpv4Address = null;
            _phoneNetworkJoinConfirmed = false;
            WirelessQrCodeImage = null;
            WirelessUploadUrl = null;
            WirelessUploadStatus = "Wireless upload not started.";
            SessionCountdownText = string.Empty;
            _ = _wirelessKioskClient.DisconnectAsync();

            NavigateTo(KioskScreen.Landing);
            StatusMessage = changeAmount > 0m
                ? $"Print job queued. Please collect your change: PHP {changeAmount:0.00}."
                : "Print job queued. Exact amount received.";
        }
        finally
        {
            _isForwardingPrint = false;
            OnPropertyChanged(nameof(CanPrint));
            CommandManager.InvalidateRequerySuggested();
        }
    }

    private bool TryResolveSelectedDocumentPath(out string selectedDocumentPath, out string selectedFileName)
    {
        selectedDocumentPath = string.Empty;
        selectedFileName = SelectedUploadedFile ?? "file";

        if (string.IsNullOrWhiteSpace(SelectedUploadedFile))
        {
            StatusMessage = "Select a file before printing.";
            return false;
        }

        if (!_uploadedDocumentsByName.TryGetValue(SelectedUploadedFile, out var document))
        {
            StatusMessage = "Selected file is not available for print forwarding. Re-upload the document.";
            return false;
        }

        if (string.IsNullOrWhiteSpace(document.StoredPath) || !File.Exists(document.StoredPath))
        {
            StatusMessage = $"Selected file is missing on kiosk storage: {document.FileName}.";
            return false;
        }

        selectedDocumentPath = document.StoredPath;
        selectedFileName = document.FileName;
        return true;
    }

    private decimal CalculatePrice()
    {
        var pageCount = IsPageRangeSelection ? EstimatePagesFromRange(PageRange) : 2;
        var ratePerPage = SelectedColorMode == "Colored" ? 5m : 3m;
        var computedPrice = pageCount * Copies * ratePerPage;
        return Math.Max(10m, computedPrice);
    }

    private void RefreshPricingState()
    {
        OnPropertyChanged(nameof(Price));
        OnPropertyChanged(nameof(Change));
        OnPropertyChanged(nameof(CanPrint));
        CommandManager.InvalidateRequerySuggested();
    }

    private static int EstimatePagesFromRange(string? range)
    {
        if (string.IsNullOrWhiteSpace(range))
        {
            return 1;
        }

        var pieces = range.Split('-', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (pieces.Length != 2)
        {
            return 1;
        }

        if (!int.TryParse(pieces[0], out var startPage) || !int.TryParse(pieces[1], out var endPage))
        {
            return 1;
        }

        if (startPage <= 0 || endPage <= 0 || endPage < startPage)
        {
            return 1;
        }

        return (endPage - startPage) + 1;
    }

    protected override void OnBalanceChanged(int balance)
    {
        Credit = balance;

        if (balance > 0)
        {
            StatusMessage = $"Coin received. Current credit: PHP {Credit:0.00}.";
        }
    }

    private void UpdateSelectedDocumentPreview()
    {
        if (string.IsNullOrWhiteSpace(SelectedUploadedFile))
        {
            DocumentPreviewUri = null;
            DocumentPreviewStatusMessage = "Select an uploaded file to preview.";
            return;
        }

        if (!_uploadedDocumentsByName.TryGetValue(SelectedUploadedFile, out var uploadedDocument))
        {
            DocumentPreviewUri = null;
            DocumentPreviewStatusMessage = $"Preview is unavailable for \"{SelectedUploadedFile}\".";
            return;
        }

        if (string.IsNullOrWhiteSpace(uploadedDocument.StoredPath) || !File.Exists(uploadedDocument.StoredPath))
        {
            DocumentPreviewUri = null;
            DocumentPreviewStatusMessage = $"File not found for preview: \"{uploadedDocument.FileName}\".";
            return;
        }

        var extension = Path.GetExtension(uploadedDocument.FileName).ToLowerInvariant();
        if (extension is not ".pdf" and not ".docx" and not ".doc")
        {
            DocumentPreviewUri = null;
            DocumentPreviewStatusMessage = $"Embedded preview is supported for PDF, DOCX, and DOC only. Selected: {uploadedDocument.FileName}";
            return;
        }

        try
        {
            DocumentPreviewUri = new Uri(uploadedDocument.StoredPath, UriKind.Absolute);
            DocumentPreviewStatusMessage = $"Previewing: {uploadedDocument.FileName}";
        }
        catch (IOException ex)
        {
            DocumentPreviewUri = null;
            DocumentPreviewStatusMessage = $"Unable to read document preview: {ex.Message}";
        }
        catch (UnauthorizedAccessException ex)
        {
            DocumentPreviewUri = null;
            DocumentPreviewStatusMessage = $"Preview access denied: {ex.Message}";
        }
        catch (UriFormatException ex)
        {
            DocumentPreviewUri = null;
            DocumentPreviewStatusMessage = $"Document preview path error: {ex.Message}";
        }
    }
}
