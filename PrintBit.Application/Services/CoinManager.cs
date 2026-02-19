namespace PrintBit.Application.Services;

public delegate void BalanceUpdatedHandler(int balance);

public sealed class CoinManager
{
    private static readonly HashSet<int> ValidCoinValues = new() { 1, 5, 10, 20 };
    private const int MaxBalance = 100;

    private readonly object _sync = new();
    private int _balance;

    public event BalanceUpdatedHandler? OnBalanceUpdated;

    public int Balance
    {
        get
        {
            lock (_sync)
            {
                return _balance;
            }
        }
    }

    public bool AddCoin(int value)
    {
        if (!ValidCoinValues.Contains(value))
        {
            return false;
        }

        int updatedBalance;
        lock (_sync)
        {
            var cappedBalance = Math.Min(MaxBalance, _balance + value);
            if (cappedBalance == _balance)
            {
                return true;
            }

            _balance = cappedBalance;
            updatedBalance = _balance;
        }

        OnBalanceUpdated?.Invoke(updatedBalance);
        return true;
    }

    public void Reset()
    {
        bool changed;
        lock (_sync)
        {
            changed = _balance != 0;
            _balance = 0;
        }

        if (changed)
        {
            OnBalanceUpdated?.Invoke(0);
        }
    }
}
