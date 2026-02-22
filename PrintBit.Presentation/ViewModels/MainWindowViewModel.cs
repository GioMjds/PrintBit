using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
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
    private readonly IKioskNetworkService _kioskNetworkService;
    private readonly IPrintForwardingService _printForwardingService;
    private readonly IWirelessKioskClient _wirelessKioskClient;
    private readonly DispatcherTimer _networkJoinTimer;
    private readonly DispatcherTimer _sessionCountdownTimer;
    private readonly TimeSpan _networkJoinTimeout;
    private readonly Dictionary<string, UploadedDocumentDto> _uploadedDocumentsByName = new(StringComparer.OrdinalIgnoreCase);

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
    private Uri? _documentPreviewUri;
    private string _documentPreviewStatusMessage = "Select an uploaded file to preview.";
    private string _offlineGuidanceMessage = "Offline print is preparing.";
    private string _sessionCountdownText = "";
    private string _networkDiagnosticsText = "Diagnostics unavailable.";
    private readonly string _hotspotSsid = "PrintBit-Kiosk";
    private readonly string _hotspotPassword = "PrintBit1234";
    private readonly ImageSource? _hotspotQrCodeImage;
    private Guid? _activeWirelessSessionId;
    private DateTimeOffset? _activeSessionExpiresAt;
    private bool _isStartingWirelessSession;
    private bool _phoneNetworkJoinConfirmed;
    private bool _isForwardingPrint;

    public MainWindowViewModel(
        CoinManager coinManager,
        IKioskNetworkService kioskNetworkService,
        IPrintForwardingService printForwardingService,
        IWirelessKioskClient wirelessKioskClient)
        : base(coinManager)
    {
        _kioskNetworkService = kioskNetworkService;
        _printForwardingService = printForwardingService;
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

        UploadedFiles = [];

        ColorModes = ["Colored", "Grayscale"];
        PageSelectionModes = ["All Pages", "Page Range"];

        ShowLandingCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Landing));
        OpenPrintCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Print));
        OpenCopyCommand = new RelayCommand(_ => NavigateTo(KioskScreen.Copy));
        OpenScanCommand = new RelayCommand(_ =>
        {
            NavigateTo(KioskScreen.Copy);
            StatusMessage = "Use Scan to capture a document, then proceed to print configuration.";
        });
        OpenSettingsCommand = new RelayCommand(_ => StatusMessage = "Settings screen is not implemented yet.");
        PowerOffCommand = new RelayCommand(_ =>
        {
            var choice = System.Windows.MessageBox.Show(
                "Shut down the kiosk application?",
                "Power Off",
                System.Windows.MessageBoxButton.YesNo,
                System.Windows.MessageBoxImage.Question
            );

            if (choice != System.Windows.MessageBoxResult.Yes) return;

            try
            {
                _networkJoinTimer.Stop();
                _sessionCountdownTimer.Stop();
                _ = _wirelessKioskClient.DisconnectAsync();
            } 
            catch {  }

            System.Windows.Application.Current?.Dispatcher.Invoke(() =>
            {
                System.Windows.Application.Current.Shutdown();
            });
        });

        ConfirmPhoneConnectedCommand = new RelayCommand(
            _ => ConfirmPhoneConnected(),
            _ => CanConfirmPhoneConnected);

        ShowNoNetworkFallbackCommand = new RelayCommand(
            _ =>
            {
                SetOfflineState(
                    OfflinePrintState.NoLocalNetworkFallback,
                    "Cannot detect kiosk network. Use USB transfer or reconnect to kiosk network.");
                WirelessUploadStatus = "No local network detected for QR upload.";
                StatusMessage = "Use fallback transfer or reconnect to kiosk network.";
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

        StartPrintCommand = new RelayCommand(_ => _ = StartPrintAsync(), _ => CanPrint);
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

    public string NetworkDiagnosticsText
    {
        get => _networkDiagnosticsText;
        private set => SetProperty(ref _networkDiagnosticsText, value);
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
            UpdateSelectedDocumentPreview();
            RefreshPricingState();
        }
    }

    public Uri? DocumentPreviewUri
    {
        get => _documentPreviewUri;
        private set => SetProperty(ref _documentPreviewUri, value);
    }

    public string DocumentPreviewStatusMessage
    {
        get => _documentPreviewStatusMessage;
        private set => SetProperty(ref _documentPreviewStatusMessage, value);
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

    public bool CanPrint => Credit >= Price
        && Price > 0m
        && !string.IsNullOrWhiteSpace(SelectedUploadedFile)
        && !_isForwardingPrint;

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
        var hotspotStatus = _kioskNetworkService.GetHotspotStatus();
        _phoneNetworkJoinConfirmed = false;
        _networkJoinTimer.Stop();

        _ = _wirelessKioskClient.DisconnectAsync();
        _activeWirelessSessionId = null;
        _activeSessionExpiresAt = null;
        _uploadedDocumentsByName.Clear();
        WirelessQrCodeImage = null;
        WirelessUploadUrl = null;
        WirelessUploadStatus = "Step 1 required before upload QR is available.";
        SessionCountdownText = string.Empty;
        NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, null);

        SetOfflineState(
            hotspotStatus.IsNetworkAvailable ? OfflinePrintState.HotspotReady : OfflinePrintState.HotspotStarting,
            BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
        StatusMessage = hotspotStatus.IsNetworkAvailable
            ? "Scan Wi-Fi QR, connect, then tap Connected - Continue."
            : BuildManualJoinHint();
        BeginWaitingForPhoneNetworkJoin(BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
    }

    private void BeginWaitingForPhoneNetworkJoin(string? guidanceMessage = null)
    {
        _phoneNetworkJoinConfirmed = false;
        SetOfflineState(
            OfflinePrintState.WaitingForPhoneNetworkJoin,
            guidanceMessage ?? "Step 1 required: scan Wi-Fi QR, connect, then tap Connected - Continue.");
        StatusMessage = "Waiting for phone and printer to join kiosk network.";

        _networkJoinTimer.Stop();
        _networkJoinTimer.Start();
    }

    private void ConfirmPhoneConnected()
    {
        var hotspotStatus = _kioskNetworkService.GetHotspotStatus();
        NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, WirelessUploadUrl);
        if (!hotspotStatus.IsNetworkAvailable)
        {
            _phoneNetworkJoinConfirmed = false;
            _networkJoinTimer.Stop();
            SetOfflineState(OfflinePrintState.NoLocalNetworkFallback, BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
            WirelessUploadStatus = "Step 1 incomplete. Kiosk network is not ready.";
            StatusMessage = BuildManualJoinHint();
            CommandManager.InvalidateRequerySuggested();
            return;
        }

        _phoneNetworkJoinConfirmed = true;
        _networkJoinTimer.Stop();
        StatusMessage = "Step 1 complete. Generating upload QR...";
        _ = StartWirelessSessionAsync();
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
                BuildStepOneGuidance("Phone/printer not yet connected to kiosk network."));
            WirelessUploadStatus = "Network join timeout. Manual Wi-Fi join may be required.";
            StatusMessage = BuildManualJoinHint();
    }

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
                BuildStepOneGuidance(null));
            WirelessUploadStatus = "Step 1 required before upload QR is available.";
            NetworkDiagnosticsText = BuildDiagnosticsText(null, WirelessUploadUrl);
            return;
        }

        var hotspotStatus = _kioskNetworkService.GetHotspotStatus();
        if (!hotspotStatus.IsNetworkAvailable)
        {
            _phoneNetworkJoinConfirmed = false;
            SetOfflineState(OfflinePrintState.NoLocalNetworkFallback, BuildStepOneGuidance(hotspotStatus.GuidanceMessage));
            WirelessUploadStatus = "Kiosk network unavailable. Reconnect before upload QR.";
            StatusMessage = BuildManualJoinHint();
            NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, WirelessUploadUrl);
            _networkJoinTimer.Stop();
            _networkJoinTimer.Start();
            return;
        }

        if (!await IsWirelessGatewayReachableAsync())
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless gateway is not reachable on kiosk network.");
            WirelessUploadStatus = "Gateway pre-check failed. Verify kiosk gateway service and network IP.";
            StatusMessage = "Cannot reach upload service. Start/verify gateway and retry.";
            NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, WirelessUploadUrl);
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
            _activeSessionExpiresAt = null;
            WirelessUploadUrl = session.UploadUrl;
            WirelessQrCodeImage = BuildQrCodeImage(session.UploadUrl);
            NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, session.UploadUrl);
            await _wirelessKioskClient.ConnectToSessionAsync(session.SessionId);

            var uploadedDocuments = await _wirelessKioskClient.GetUploadedDocumentsAsync(session.SessionId);
            foreach (var uploadedDocument in uploadedDocuments)
            {
                ApplyWirelessUploadedDocument(uploadedDocument);
            }

            SessionCountdownText = string.Empty;

            if (uploadedDocuments.Count > 0)
            {
                SetOfflineState(OfflinePrintState.UploadReceived, "Upload already detected for this session.");
            }
            else
            {
                SetOfflineState(OfflinePrintState.SessionReady, "Step 2: Scan upload QR and send file from your phone.");
            }

            WirelessUploadStatus = "Session ready. Upload page works offline when connected to kiosk network.";
            StatusMessage = "Scan the upload QR and send your file.";
        }
        catch (HttpRequestException ex)
        {
            SetOfflineState(
                OfflinePrintState.GatewayUnavailable,
                "Wireless gateway unreachable. Ensure kiosk and phone are on the same local network.");
            WirelessUploadStatus = $"Wireless server unavailable: {ex.Message}";
            StatusMessage = "Unable to reach wireless upload service.";
            NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, WirelessUploadUrl);
        }
        catch (InvalidOperationException ex)
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless upload service returned an invalid response.");
            WirelessUploadStatus = $"Wireless session error: {ex.Message}";
            StatusMessage = "Unable to create wireless upload session.";
            NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, WirelessUploadUrl);
        }
        catch (TaskCanceledException ex)
        {
            SetOfflineState(OfflinePrintState.GatewayUnavailable, "Wireless session timed out. Retry when local network is stable.");
            WirelessUploadStatus = $"Wireless session timed out: {ex.Message}";
            StatusMessage = "Wireless upload session timed out.";
            NetworkDiagnosticsText = BuildDiagnosticsText(hotspotStatus.LocalIpv4Address, WirelessUploadUrl);
        }
        finally
        {
            _isStartingWirelessSession = false;
            CommandManager.InvalidateRequerySuggested();
        }
    }

    private string BuildManualJoinHint()
    {
        return $"If auto-connect fails, open Wi-Fi settings, select \"{_hotspotSsid}\", enter password, then tap Connected - Continue.";
    }

    private string BuildStepOneGuidance(string? baseGuidance)
    {
        var normalized = string.IsNullOrWhiteSpace(baseGuidance)
            ? $"Scan Wi-Fi QR and connect to \"{_hotspotSsid}\"."
            : baseGuidance.Trim();
        return $"{normalized} {BuildManualJoinHint()}";
    }

    private string BuildDiagnosticsText(string? hotspotIp, string? uploadUrl)
    {
        var resolvedHotspotIp = string.IsNullOrWhiteSpace(hotspotIp) ? "not detected" : hotspotIp;
        var resolvedUploadUrl = string.IsNullOrWhiteSpace(uploadUrl) ? "not generated yet" : uploadUrl;
        return $"Diagnostics - Network SSID: {_hotspotSsid} | Kiosk IP: {resolvedHotspotIp} | Upload URL: {resolvedUploadUrl}";
    }

    private static async Task<bool> IsWirelessGatewayReachableAsync()
    {
        var wirelessBaseUrl = Environment.GetEnvironmentVariable("PRINTBIT_WIRELESS_BASE_URL");
        if (string.IsNullOrWhiteSpace(wirelessBaseUrl))
        {
            wirelessBaseUrl = "http://127.0.0.1:5058";
        }

        try
        {
            using var httpClient = new HttpClient
            {
                Timeout = TimeSpan.FromSeconds(3)
            };
            var gatewayHealthUrl = new Uri(new Uri(wirelessBaseUrl, UriKind.Absolute), "/");
            using var response = await httpClient.GetAsync(gatewayHealthUrl);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
        catch (InvalidOperationException)
        {
            return false;
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
            SetOfflineState(OfflinePrintState.ReconnectingRealtime, "Realtime channel reconnecting. Keep phone connected to kiosk network.");
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
        _uploadedDocumentsByName[document.FileName] = document;

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
