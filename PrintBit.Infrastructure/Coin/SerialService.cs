using System.IO.Ports;
using System.Text;

namespace PrintBit.Infrastructure.Coin;

public delegate void CoinReceivedHandler(int value);
public delegate void SerialStatusReceivedHandler(string statusLine);
public delegate void SerialProtocolErrorHandler(string invalidLine);

/// <summary>
/// Serial coin intake contract (9600 baud, newline-delimited):
/// - READY
/// - COIN:&lt;value&gt; where value is one of 1, 5, 10, 20
/// </summary>
public sealed class SerialService : IDisposable
{
    private static readonly HashSet<int> ValidCoinValues = new() { 1, 5, 10, 20 };

    private const string ReadyToken = "READY";
    private const string CoinPrefix = "COIN:";
    private const string WarningPrefix = "WARN:";
    private const string ErrorPrefix = "ERROR:";

    private readonly SerialPort _serialPort;
    private readonly object _sync = new();
    private readonly StringBuilder _buffer = new();
    private bool _disposed;

    public SerialService(string portName, int baudRate = 9600)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(portName);

        _serialPort = new SerialPort(portName, baudRate)
        {
            NewLine = "\n",
            Encoding = Encoding.ASCII
        };
        _serialPort.DataReceived += SerialPortOnDataReceived;
    }

    public event CoinReceivedHandler? OnCoinReceived;
    public event SerialStatusReceivedHandler? OnStatusReceived;
    public event SerialProtocolErrorHandler? OnProtocolError;

    public string PortName => _serialPort.PortName;

    public int BaudRate => _serialPort.BaudRate;

    public void StartListening()
    {
        ThrowIfDisposed();

        if (_serialPort.IsOpen)
        {
            return;
        }

        _serialPort.Open();
    }

    public void StopListening()
    {
        if (_disposed)
        {
            return;
        }

        if (_serialPort.IsOpen)
        {
            _serialPort.Close();
        }
    }

    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _serialPort.DataReceived -= SerialPortOnDataReceived;

        if (_serialPort.IsOpen)
        {
            _serialPort.Close();
        }

        _serialPort.Dispose();
        GC.SuppressFinalize(this);
    }

    private void SerialPortOnDataReceived(object sender, SerialDataReceivedEventArgs e)
    {
        if (!_serialPort.IsOpen)
        {
            return;
        }

        var incoming = _serialPort.ReadExisting();
        if (string.IsNullOrEmpty(incoming))
        {
            return;
        }

        lock (_sync)
        {
            _buffer.Append(incoming);
            ProcessBufferedLines();
        }
    }

    private void ProcessBufferedLines()
    {
        while (true)
        {
            var content = _buffer.ToString();
            var newLineIndex = content.IndexOf('\n');
            if (newLineIndex < 0)
            {
                return;
            }

            var line = content[..newLineIndex];
            _buffer.Clear();
            _buffer.Append(content[(newLineIndex + 1)..]);
            ProcessLine(line);
        }
    }

    private void ProcessLine(string line)
    {
        var trimmed = line.Trim();
        if (string.IsNullOrWhiteSpace(trimmed))
        {
            return;
        }

        if (trimmed.Equals(ReadyToken, StringComparison.OrdinalIgnoreCase))
        {
            OnStatusReceived?.Invoke(trimmed);
            return;
        }

        if (trimmed.StartsWith(WarningPrefix, StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith(ErrorPrefix, StringComparison.OrdinalIgnoreCase))
        {
            OnStatusReceived?.Invoke(trimmed);
            return;
        }

        if (!trimmed.StartsWith(CoinPrefix, StringComparison.OrdinalIgnoreCase))
        {
            OnProtocolError?.Invoke(trimmed);
            return;
        }

        var valueText = trimmed[CoinPrefix.Length..].Trim();
        if (!int.TryParse(valueText, out var coinValue) || !ValidCoinValues.Contains(coinValue))
        {
            OnProtocolError?.Invoke(trimmed);
            return;
        }

        OnCoinReceived?.Invoke(coinValue);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new ObjectDisposedException(nameof(SerialService));
        }
    }
}
