using System.Collections.ObjectModel;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using PrintBit.Application.DTOs;
using PrintBit.Application.Interfaces;
using PrintBit.Application.Services;
using PrintBit.Presentation.Behaviors;
using QRCoder;

namespace PrintBit.Presentation.ViewModels;

public sealed class MainWindowViewModel : MainViewModel
{
    private readonly IWirelessKioskClient _wirelessKioskClient;
    private readonly DispatcherTimer _networkJoinTimer;
    private readonly DispatcherTimer _sessionCountdownTimer;
    private readonly TimeSpan _networkJoinTimeout;

    private KioskScreen _currentScreen = KioskScreen.Landing;
    private string? _selectedUploadedFile;
    private int _copies = 1;
    private string _selectedColorMode = "Colored";
    private string _selectedPageSelectionMode = "All Pages";
    private string _pageRange = "1-2";
    private decimal _credit;
    private string? _scannedDocumentName;
    private string _statusMessage = "Welcome to PrintBit.";

    private OfflinePrintState _offlineState = OfflinePrintState.HotspotStarting;
    private ImageSource? _wirelessQrCodeImage;
    private string? _wirelessUploadUrl;
    private string _wirelessUploadStatus = "Wireless upload not started.";
    private string _offlineGuidanceMessage = "Offline print is preparing.";
    private string _sessionCountdownText = "";
    private string _hotspotSsid = "PrintBit-Kiosk";
    private string _hotspotPassword = "PrintBit1234";
    private ImageSource? _hotspotQrCodeImage;
    private Guid? _activeWirelessSessionId;
    private DateTimeOffset? _activeSessionExpiresAt;
    private bool _isStartingWirelessSession;
    private bool _phoneNetworkJoinConfirmed;

    public MainWindowViewModel(CoinManager coinManager, IWirelessKioskClient wirelessKioskClient)
        : base(coinManager)
    {
        _wirelessKioskClient = wirelessKioskClient;
        _wirelessKioskClient.UploadCompleted += HandleWirelessUploadCompleted;
        _wirelessKioskClient.StatusChanged += HandleWirelessStatusChanged;

        _networkJoinTimeout = ResolveNetworkJoinTimeout();
        _networkJoinTimer = new DispatcherTimer { Interval = _networkJoinTimeout };
        _networkJoinTimer.Tick += HandleNetworkJoinTimeout;

        _sessionCountdownTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _sessionCountdownTimer.Tick += HandleSessionCountdown;

        _hotspotSsid = ResolveHotspotSsid();
        _hotspotPassword = ResolveHotspotPassword();
        _hotspotQrCodeImage = BuildWifiQrCodeImage(_hotspotSsid, _hotspotPassword);

        UploadedFiles = new ObservableCollection<string>();

        ColorModes = new ObservableCollection<string> { "Colored", "Grayscale" };
        PageSelectionModes = new ObservableCollection<string> { "All Pages", "Page Range" };

        ShowLandingCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Landing));
        OpenPrintCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Print));
        OpenCopyCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Copy));
        OpenScanCommand = new RelayCommand(_ =>
        {
            NavigateTo(KioskScreen.Copy);
            StatusMessage = "Use Scan to capture a document, then proceed to print configuration.";
        });
        OpenSettingsCommand = new RelayCommand(_ => StatusMessage = "Settings screen is not implemented yet.");
        PowerOffCommand = new RelayCommand(_ => StatusMessage = "Power off is disabled in this demo.");

        ConfirmPhoneConnectedCommand = new RelayCommand(
            _ =>
            {
                _phoneNetworkJoinConfirmed = true;
                _networkJoinTimer.Stop();
                _ = StartWirelessSessionAsync();
            },
            _ => CanConfirmPhoneConnected);

        ShowNoNetworkFallbackCommand = new RelayCommand(
            _ =>
            {
                SetOfflineState(
                    OfflinePrintState.NoLocalNetworkFallback,
                    "Cannot detect local connection. Use USB transfer or reconnect to kiosk Wi-Fi.");
                WirelessUploadStatus = "No local network detected for QR upload.";
                StatusMessage = "Use fallback transfer or reconnect to kiosk Wi-Fi.";
            });

        RetryPhoneConnectionCommand = new RelayCommand(
            _ => BeginWaitingForPhoneNetworkJoin(),
            _ => IsFallbackActionsVisible || OfflineState == OfflinePrintState.NetworkJoinTimeout);

        UseUsbFallbackCommand = new RelayCommand(
            _ =>
            {
                WirelessUploadStatus = "USB fallback selected.";
                StatusMessage = "Insert USB storage and choose local file import path.";
            },
            _ => IsFallbackActionsVisible);

        StartWirelessSessionCommand = new RelayCommand(
            _ => _ = StartWirelessSessionAsync(forceRefresh: true),
            _ => !_isStartingWirelessSession && _phoneNetworkJoinConfirmed);

        ContinueToConfigurationCommand = new RelayCommand(
            _ => NavigateTo(KioskScreen.PrintConfiguration),
            _ => CanProceedToConfiguration);

        GoToConfirmPrintCommand = new RelayCommand(
            _ => NavigateTo(KioskScreen.ConfirmPrint),
            _ => CanConfirmConfiguration);

        GoBackToPrintCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Print));
        GoBackToConfigurationCommand = new RelayCommand(_ => NavigateTo(KioskScreen.PrintConfiguration));
        GoBackToLandingCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Landing));

        IncreaseCopiesCommand = new RelayCommand(_ => Copies++);
        DecreaseCopiesCommand = new RelayCommand(_ => Copies--, _ => Copies > 1);

        StartPrintCommand = new RelayCommand(_ => StartPrint(), _ => CanPrint);
        ResetCoinsCommand = new RelayCommand(_ =>
        {
            ResetBalanceCommand.Execute(null);
            StatusMessage = "Coin credit reset.";
        });

        SimulateScanCommand = new RelayCommand(_ =>
        {
            ScannedDocumentName = $"Scanned_{DateTime.Now:HHmmss}.pdf";
            StatusMessage = "Scan complete. You can now proceed to print configuration.";
        });

        ProceedCopyToConfigurationCommand = new RelayCommand(
            _ =>
            {
                SelectedUploadedFile = ScannedDocumentName;
                NavigateTo(KioskScreen.PrintConfiguration);
            },
            _ => HasScannedDocument);

        NavigateTo(KioskScreen.Landing);
    }

    public ObservableCollection<string> UploadedFiles { get; }

    public ObservableCollection<string> ColorModes { get; }

    public ObservableCollection<string> PageSelectionModes { get; }

    public ICommand ShowLandingCommand { get; }

    public ICommand OpenPrintCommand { get; }

    public ICommand OpenCopyCommand { get; }

    public ICommand OpenScanCommand { get; }

    public ICommand OpenSettingsCommand { get; }

    public ICommand PowerOffCommand { get; }

    public ICommand ConfirmPhoneConnectedCommand { get; }

    public ICommand ShowNoNetworkFallbackCommand { get; }

    public ICommand RetryPhoneConnectionCommand { get; }

    public ICommand UseUsbFallbackCommand { get; }

    public ICommand StartWirelessSessionCommand { get; }

    public ICommand ContinueToConfigurationCommand { get; }

    public ICommand GoToConfirmPrintCommand { get; }

    public ICommand GoBackToPrintCommand { get; }

    public ICommand GoBackToConfigurationCommand { get; }

    public ICommand GoBackToLandingCommand { get; }

    public ICommand IncreaseCopiesCommand { get; }

    public ICommand DecreaseCopiesCommand { get; }

    public ICommand ResetCoinsCommand { get; }

    public ICommand StartPrintCommand { get; }

    public ICommand SimulateScanCommand { get; }

    public ICommand ProceedCopyToConfigurationCommand { get; }

    public KioskScreen CurrentScreen
    {
        get => _currentScreen;
        private set
        {
            if (!SetProperty(ref _currentScreen, value))
            {
                return;
            }

            OnPropertyChanged(nameof(CurrentScreenTitle));
            OnPropertyChanged(nameof(IsLandingScreen));
            OnPropertyChanged(nameof(IsPrintScreen));
            OnPropertyChanged(nameof(IsPrintConfigurationScreen));
            OnPropertyChanged(nameof(IsConfirmPrintScreen));
            OnPropertyChanged(nameof(IsCopyScreen));
            CommandManager.InvalidateRequerySuggested();
        }
    }

    public OfflinePrintState OfflineState
    {
        get => _offlineState;
        private set
        {
            if (!SetProperty(ref _offlineState, value))
            {
                return;
            }

            OnPropertyChanged(nameof(IsHotspotGuideVisible));
            OnPropertyChanged(nameof(IsUploadQrVisible));
            OnPropertyChanged(nameof(IsFallbackActionsVisible));
            OnPropertyChanged(nameof(CanConfirmPhoneConnected));
        }
    }

    public string CurrentScreenTitle => CurrentScreen switch
    {
        KioskScreen.Landing => "PrintBit Kiosk",
        KioskScreen.Print => "Print: Upload and Select File",
        KioskScreen.PrintConfiguration => "Print Configuration",
        KioskScreen.ConfirmPrint => "Confirm and Pay",
        KioskScreen.Copy => "Copy and Scan",
        _ => "PrintBit Kiosk"
    };

    public bool IsLandingScreen => CurrentScreen == KioskScreen.Landing;

    public bool IsPrintScreen => CurrentScreen == KioskScreen.Print;

    public bool IsPrintConfigurationScreen => CurrentScreen == KioskScreen.PrintConfiguration;

    public bool IsConfirmPrintScreen => CurrentScreen == KioskScreen.ConfirmPrint;

    public bool IsCopyScreen => CurrentScreen == KioskScreen.Copy;

    public bool IsHotspotGuideVisible =>
        OfflineState is OfflinePrintState.HotspotStarting
            or OfflinePrintState.HotspotReady
            or OfflinePrintState.WaitingForPhoneNetworkJoin
            or OfflinePrintState.NetworkJoinTimeout
            or OfflinePrintState.NoLocalNetworkFallback
            or OfflinePrintState.GatewayUnavailable;

    public bool IsUploadQrVisible =>
        OfflineState is OfflinePrintState.SessionCreating
            or OfflinePrintState.SessionReady
            or OfflinePrintState.UploadInProgress
            or OfflinePrintState.UploadReceived
            or OfflinePrintState.SessionExpired
            or OfflinePrintState.ReconnectingRealtime;

    public bool IsFallbackActionsVisible =>
        OfflineState is OfflinePrintState.NetworkJoinTimeout
            or OfflinePrintState.NoLocalNetworkFallback
            or OfflinePrintState.GatewayUnavailable;

    public bool CanConfirmPhoneConnected =>
        OfflineState is OfflinePrintState.WaitingForPhoneNetworkJoin
            or OfflinePrintState.NetworkJoinTimeout;

    public string HotspotSsid => _hotspotSsid;

    public string HotspotPassword => _hotspotPassword;

    public ImageSource? HotspotQrCodeImage => _hotspotQrCodeImage;

    public string OfflineGuidanceMessage
    {
        get => _offlineGuidanceMessage;
        private set => SetProperty(ref _offlineGuidanceMessage, value);
    }

    public string SessionCountdownText
    {
        get => _sessionCountdownText;
        private set => SetProperty(ref _sessionCountdownText, value);
    }

    public string? SelectedUploadedFile
    {
        get => _selectedUploadedFile;
        set
        {
            if (!SetProperty(ref _selectedUploadedFile, value))
            {
                return;
            }

            OnPropertyChanged(nameof(CanProceedToConfiguration));
            OnPropertyChanged(nameof(CanConfirmConfiguration));
            RefreshPricingState();
        }
    }

    public int Copies
    {
        get => _copies;
        set
        {
            var normalized = Math.Max(1, value);
            if (!SetProperty(ref _copies, normalized))
            {
                return;
            }

            OnPropertyChanged(nameof(CanConfirmConfiguration));
            RefreshPricingState();
        }
    }

    public string SelectedColorMode
    {
        get => _selectedColorMode;
        set
        {
            if (!SetProperty(ref _selectedColorMode, value))
            {
                return;
            }

            RefreshPricingState();
        }
    }

    public string SelectedPageSelectionMode
    {
        get => _selectedPageSelectionMode;
        set
        {
            if (!SetProperty(ref _selectedPageSelectionMode, value))
            {
                return;
            }

            OnPropertyChanged(nameof(IsPageRangeSelection));
            OnPropertyChanged(nameof(CanConfirmConfiguration));
            RefreshPricingState();
        }
    }

    public string PageRange
    {
        get => _pageRange;
        set
        {
            if (!SetProperty(ref _pageRange, value))
            {
                return;
            }

            OnPropertyChanged(nameof(CanConfirmConfiguration));
            RefreshPricingState();
        }
    }

    public bool IsPageRangeSelection => SelectedPageSelectionMode == "Page Range";

    public decimal Credit
    {
        get => _credit;
        private set
        {
            if (!SetProperty(ref _credit, value))
            {
                return;
            }

            OnPropertyChanged(nameof(Change));
            OnPropertyChanged(nameof(CanPrint));
            CommandManager.InvalidateRequerySuggested();
        }
    }

    public decimal Price => CalculatePrice();

    public decimal Change => Math.Max(0m, Credit - Price);

    public bool CanProceedToConfiguration => !string.IsNullOrWhiteSpace(SelectedUploadedFile);

    public bool CanConfirmConfiguration =>
        !string.IsNullOrWhiteSpace(SelectedUploadedFile)
        && Copies > 0
        && (!IsPageRangeSelection || !string.IsNullOrWhiteSpace(PageRange));

    public bool CanPrint => Credit >= Price && Price > 0m && !string.IsNullOrWhiteSpace(SelectedUploadedFile);

    public string? ScannedDocumentName
    {
        get => _scannedDocumentName;
        private set
        {
            if (!SetProperty(ref _scannedDocumentName, value))
            {
                return;
            }

            OnPropertyChanged(nameof(HasScannedDocument));
            CommandManager.InvalidateRequerySuggested();
        }
    }

    public bool HasScannedDocument => !string.IsNullOrWhiteSpace(ScannedDocumentName);

    public string StatusMessage
    {
        get => _statusMessage;
        private set => SetProperty(ref _statusMessage, value);
    }

    public ImageSource? WirelessQrCodeImage
    {
        get => _wirelessQrCodeImage;
        private set => SetProperty(ref _wirelessQrCodeImage, value);
    }

    public string? WirelessUploadUrl
    {
        get => _wirelessUploadUrl;
        private set
        {
            if (!SetProperty(ref _wirelessUploadUrl, value))
            {
                return;
            }

            OnPropertyChanged(nameof(HasWirelessUploadUrl));
        }
    }

    public bool HasWirelessUploadUrl => !string.IsNullOrWhiteSpace(WirelessUploadUrl);

    public string WirelessUploadStatus
    {
        get => _wirelessUploadStatus;
        private set => SetProperty(ref _wirelessUploadStatus, value);
    }

    private void NavigateTo(KioskScreen targetScreen)
    {
        CurrentScreen = targetScreen;

        if (targetScreen == KioskScreen.Landing)
        {
            StatusMessage = "Choose Print, Copy, or Scan.";
            _networkJoinTimer.Stop();
            _sessionCountdownTimer.Stop();
        }
        else if (targetScreen == KioskScreen.Print)
        {
            EnterOfflinePrintFlow();
        }
        else if (targetScreen == KioskScreen.PrintConfiguration)
        {
            StatusMessage = "Review print settings before confirmation.";
            _networkJoinTimer.Stop();
        }
        else if (targetScreen == KioskScreen.ConfirmPrint)
        {
            StatusMessage = "Insert coins to match the required print price.";
        }
        else if (targetScreen == KioskScreen.Copy)
        {
            StatusMessage = "Scan a physical document, then continue.";
        }
    }

    private void EnterOfflinePrintFlow()
    {
        _phoneNetworkJoinConfirmed = true;
        _networkJoinTimer.Stop();

        _ = _wirelessKioskClient.DisconnectAsync();
        _activeWirelessSessionId = null;
        _activeSessionExpiresAt = null;
        WirelessQrCodeImage = null;
        WirelessUploadUrl = null;
        WirelessUploadStatus = "Preparing upload QR session...";
        SessionCountdownText = string.Empty;

        SetOfflineState(OfflinePrintState.SessionCreating, "Step 2: Scan upload QR and send file from your phone.");
        StatusMessage = "Generating upload QR. Use your phone to open the upload page.";
        _ = StartWirelessSessionAsync(forceRefresh: true);
    }

    private void BeginWaitingForPhoneNetworkJoin()
    {
        _phoneNetworkJoinConfirmed = false;
        SetOfflineState(
            OfflinePrintState.WaitingForPhoneNetworkJoin,
            "Step 1: Connect phone to kiosk Wi-Fi. Step 2: tap 'I Connected My Phone'.");
        StatusMessage = "Waiting for phone to join kiosk network.";

        _networkJoinTimer.Stop();
        _networkJoinTimer.Start();
    }

    private void HandleNetworkJoinTimeout(object? sender, EventArgs e)
    {
        _networkJoinTimer.Stop();
        if (_phoneNetworkJoinConfirmed)
        {
            return;
        }

        SetOfflineState(
            OfflinePrintState.NetworkJoinTimeout,
            "Phone not yet connected to kiosk network. Retry connection or choose fallback transfer.");
        WirelessUploadStatus = "Network join timeout.";
        StatusMessage = "Phone must connect to kiosk Wi-Fi before QR upload works.";
    }

    private void StartPrint()
    {
        if (!CanPrint)
        {
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
        _phoneNetworkJoinConfirmed = false;
        WirelessQrCodeImage = null;
        WirelessUploadUrl = null;
        WirelessUploadStatus = "Wireless upload not started.";
        SessionCountdownText = string.Empty;
        _ = _wirelessKioskClient.DisconnectAsync();

        NavigateTo(KioskScreen.Landing);
        StatusMessage = changeAmount > 0m
            ? $"Printing started. Please collect your change: PHP {changeAmount:0.00}."
            : "Printing started. Exact amount received.";
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

    private async Task StartWirelessSessionAsync(bool forceRefresh = false)
    {
        if (_isStartingWirelessSession)
        {
            return;
        }

        if (!_phoneNetworkJoinConfirmed)
        {
            SetOfflineState(
                OfflinePrintState.WaitingForPhoneNetworkJoin,
                "No internet is okay, but your phone must connect to kiosk Wi-Fi first.");
            WirelessUploadStatus = "Phone is not connected to kiosk network yet.";
            return;
        }

        _isStartingWirelessSession = true;
        _networkJoinTimer.Stop();
        SetOfflineState(OfflinePrintState.SessionCreating, "Creating upload session and QR code...");
        WirelessUploadStatus = "Creating wireless session...";
        CommandManager.InvalidateRequerySuggested();

        try
        {
            if (forceRefresh && _activeWirelessSessionId.HasValue)
            {
                await _wirelessKioskClient.DisconnectAsync();
                _activeWirelessSessionId = null;
            }

            var session = await _wirelessKioskClient.CreateSessionAsync();
            _activeWirelessSessionId = session.SessionId;
            _activeSessionExpiresAt = session.ExpiresAt;
            WirelessUploadUrl = session.UploadUrl;
            WirelessQrCodeImage = BuildQrCodeImage(session.UploadUrl);
            await _wirelessKioskClient.ConnectToSessionAsync(session.SessionId);

            var uploadedDocuments = await _wirelessKioskClient.GetUploadedDocumentsAsync(session.SessionId);
            foreach (var uploadedDocument in uploadedDocuments)
            {
                ApplyWirelessUploadedDocument(uploadedDocument);
            }

            StartSessionCountdown();

            if (uploadedDocuments.Count > 0)
            {
                SetOfflineState(OfflinePrintState.UploadReceived, "Upload already detected for this session.");
            }
            else
            {
                SetOfflineState(OfflinePrintState.SessionReady, "Step 2: Scan upload QR and send file from your phone.");
            }

            WirelessUploadStatus = "Session ready. Upload page works without internet when connected to kiosk Wi-Fi.";
            StatusMessage = "Scan the upload QR and send your file.";
        }
        catch (HttpRequestException ex)
        {
            SetOfflineState(
                OfflinePrintState.GatewayUnavailable,
                "Wireless gateway unreachable. Ensure kiosk and phone are on the same local network.");
            WirelessUploadStatus = $"Wireless server unavailable: {ex.Message}";
            StatusMessage = "Unable to reach wireless upload service.";
        }
        catch (InvalidOperationException ex)
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless upload service returned an invalid response.");
            WirelessUploadStatus = $"Wireless session error: {ex.Message}";
            StatusMessage = "Unable to create wireless upload session.";
        }
        catch (TaskCanceledException ex)
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless session timed out. Retry when local network is stable.");
            WirelessUploadStatus = $"Wireless session timed out: {ex.Message}";
            StatusMessage = "Wireless upload session timed out.";
        }
        finally
        {
            _isStartingWirelessSession = false;
            CommandManager.InvalidateRequerySuggested();
        }
    }

    private void StartSessionCountdown()
    {
        _sessionCountdownTimer.Stop();
        HandleSessionCountdown(this, EventArgs.Empty);
        _sessionCountdownTimer.Start();
    }

    private void HandleSessionCountdown(object? sender, EventArgs e)
    {
        if (!_activeSessionExpiresAt.HasValue)
        {
            SessionCountdownText = string.Empty;
            return;
        }

        var remaining = _activeSessionExpiresAt.Value - DateTimeOffset.UtcNow;
        if (remaining <= TimeSpan.Zero)
        {
            _sessionCountdownTimer.Stop();
            SessionCountdownText = "Session expired. Refresh QR session.";
            SetOfflineState(OfflinePrintState.SessionExpired, "Session expired. Refresh QR session and upload again.");
            WirelessUploadStatus = "Upload session expired.";
            return;
        }

        SessionCountdownText = $"Session expires in {remaining:mm\\:ss}";
    }

    private void HandleWirelessUploadCompleted(UploadedDocumentDto document)
    {
        var dispatcher = System.Windows.Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            ApplyWirelessUploadedDocument(document);
            return;
        }

        _ = dispatcher.BeginInvoke(new Action(() => ApplyWirelessUploadedDocument(document)));
    }

    private void HandleWirelessStatusChanged(string statusMessage)
    {
        var dispatcher = System.Windows.Application.Current?.Dispatcher;
        if (dispatcher is null || dispatcher.CheckAccess())
        {
            ApplyWirelessStatus(statusMessage);
            return;
        }

        _ = dispatcher.BeginInvoke(new Action(() => ApplyWirelessStatus(statusMessage)));
    }

    private void ApplyWirelessStatus(string statusMessage)
    {
        WirelessUploadStatus = statusMessage;

        if (statusMessage.Contains("reconnecting", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.ReconnectingRealtime, "Realtime channel reconnecting. Keep phone connected to kiosk Wi-Fi.");
            return;
        }

        if (statusMessage.Contains("Upload in progress", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.UploadInProgress, "Upload in progress from phone...");
            return;
        }

        if (statusMessage.Contains("reconnected", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(SelectedUploadedFile is null ? OfflinePrintState.SessionReady : OfflinePrintState.UploadReceived,
                "Realtime channel restored.");
            return;
        }

        if (statusMessage.Contains("expired", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.SessionExpired, "Session expired. Refresh QR session.");
            return;
        }

        if (statusMessage.Contains("closed", StringComparison.OrdinalIgnoreCase)
            || statusMessage.Contains("failed", StringComparison.OrdinalIgnoreCase))
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable,
                "Realtime channel unavailable. Retry session or use fallback transfer.");
        }
    }

    private void ApplyWirelessUploadedDocument(UploadedDocumentDto document)
    {
        if (!UploadedFiles.Any(existingFileName =>
                string.Equals(existingFileName, document.FileName, StringComparison.OrdinalIgnoreCase)))
        {
            UploadedFiles.Add(document.FileName);
        }

        SelectedUploadedFile = document.FileName;
        SetOfflineState(OfflinePrintState.UploadReceived, "Upload received. Continue to print configuration.");
        WirelessUploadStatus = $"Upload received: {document.FileName}";
        StatusMessage = $"Wireless file ready: {document.FileName}. Continue to print configuration.";
    }

    private void SetOfflineState(OfflinePrintState state, string guidanceMessage)
    {
        OfflineState = state;
        OfflineGuidanceMessage = guidanceMessage;
    }

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
        var configuredSsid = Environment.GetEnvironmentVariable("PRINTBIT_HOTSPOT_SSID");
        return string.IsNullOrWhiteSpace(configuredSsid) ? "PrintBit-Kiosk" : configuredSsid.Trim();
    }

    private static string ResolveHotspotPassword()
    {
        var configuredPassword = Environment.GetEnvironmentVariable("PRINTBIT_HOTSPOT_PASSWORD");
        return string.IsNullOrWhiteSpace(configuredPassword) ? "PrintBit1234" : configuredPassword.Trim();
    }
}
