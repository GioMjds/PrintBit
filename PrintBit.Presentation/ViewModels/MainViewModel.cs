using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;
using PrintBit.Application.Services;
using PrintBit.Presentation.Behaviors;

namespace PrintBit.Presentation.ViewModels;

public class MainViewModel : ViewModelBase, IDisposable
{
    private readonly CoinManager _coinManager;
    private readonly Dispatcher _dispatcher;
    private int _balance;

    protected MainViewModel(CoinManager coinManager)
    {
        _coinManager = coinManager;
        _dispatcher = System.Windows.Application.Current?.Dispatcher ?? Dispatcher.CurrentDispatcher;
        _coinManager.OnBalanceUpdated += CoinManagerOnBalanceUpdated;
        ResetBalanceCommand = new RelayCommand(_ => _coinManager.Reset());
        UpdateBalance(_coinManager.Balance);
    }

    public int Balance
    {
        get => _balance;
        private set
        {
            if (!SetProperty(ref _balance, value))
            {
                return;
            }

            OnPropertyChanged(nameof(BalanceDisplay));
        }
    }

    public string BalanceDisplay => $"₱{Balance}";

    public ICommand ResetBalanceCommand { get; }

    public void Dispose()
    {
        _coinManager.OnBalanceUpdated -= CoinManagerOnBalanceUpdated;
    }

    protected virtual void OnBalanceChanged(int balance)
    {
    }

    private void CoinManagerOnBalanceUpdated(int balance)
    {
        if (_dispatcher.CheckAccess())
        {
            UpdateBalance(balance);
            return;
        }

        _ = _dispatcher.BeginInvoke(() => UpdateBalance(balance));
    }

    private void UpdateBalance(int balance)
    {
        Balance = balance;
        OnBalanceChanged(balance);
    }
}
