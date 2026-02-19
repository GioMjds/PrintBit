using System.IO.Ports;
using System.Text;

namespace PrintBit.Infrastructure.Coin;

public delegate void CoinReceivedHandler(int value);

public sealed class SerialService : IDisposable
{
    private static readonly HashSet<int> ValidCoinValues = new() { 1, 5, 10, 20 };

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
            ProcessBuffer();
        }
    }

    private void ProcessBuffer()
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
        if (!int.TryParse(trimmed, out var coinValue))
        {
            return;
        }

        if (!ValidCoinValues.Contains(coinValue))
        {
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
