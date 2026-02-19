using System.Collections.ObjectModel;
using System.Windows.Input;
using PrintBit.Application.Services;
using PrintBit.Presentation.Behaviors;

namespace PrintBit.Presentation.ViewModels;

public sealed class MainWindowViewModel : MainViewModel
{
    private KioskScreen _currentScreen = KioskScreen.Landing;
    private string? _selectedUploadedFile;
    private int _copies = 1;
    private string _selectedColorMode = "Colored";
    private string _selectedPageSelectionMode = "All Pages";
    private string _pageRange = "1-2";
    private decimal _credit;
    private string? _scannedDocumentName;
    private string _statusMessage = "Welcome to PrintBit.";

    public MainWindowViewModel(CoinManager coinManager)
        : base(coinManager)
    {
        UploadedFiles = new ObservableCollection<string>
        {
            "ProjectProposal.pdf",
            "Resume.docx",
            "FloorPlan.png"
        };

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

    private void NavigateTo(KioskScreen targetScreen)
    {
        CurrentScreen = targetScreen;

        if (targetScreen == KioskScreen.Landing)
        {
            StatusMessage = "Choose Print, Copy, or Scan.";
        }
        else if (targetScreen == KioskScreen.Print)
        {
            StatusMessage = "Scan the QR code or select an uploaded file.";
        }
        else if (targetScreen == KioskScreen.PrintConfiguration)
        {
            StatusMessage = "Review print settings before confirmation.";
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
}
