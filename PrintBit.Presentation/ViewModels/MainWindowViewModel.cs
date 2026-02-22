using System.Collections.ObjectModel;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using PrintBit.Application.DTOs;
using PrintBit.Application.Interfaces;
using PrintBit.Application.Services;
using PrintBit.Presentation.Behaviors;

namespace PrintBit.Presentation.ViewModels;

public sealed partial class MainWindowViewModel : MainViewModel
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
    private string? _stepOneLocalIpv4Address;
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

}
