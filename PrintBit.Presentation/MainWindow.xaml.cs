using System;
using System.ComponentModel;
using System.Windows;
using PrintBit.Presentation.ViewModels;

namespace PrintBit.Presentation;

public partial class MainWindow : Window
{
    private bool _allowClose;
    private KioskHelper? _kiosk;
    private readonly MainWindowViewModel _viewModel;

    public MainWindow(MainWindowViewModel viewModel)
    {
        _viewModel = viewModel;
        InitializeComponent();
        DataContext = _viewModel;
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        // Prevent closing unless we explicitly allow it (exit from kiosk)
        //if (!_allowClose)
        //    e.Cancel = true;
        base.OnClosing(e);
    }

    internal void RequestExitFromKiosk()
    {
        // Called by the kiosk helper's secret combo handler
        _allowClose = true;
        try
        {
            _kiosk?.Dispose();
        }
        catch { }
        Close();
    }

    private void Window_Loaded(object sender, RoutedEventArgs e)
    {
        // Attach kiosk behavior
        //_kiosk = KioskHelper.Attach(this);
    }

    private void Window_Unloaded(object sender, RoutedEventArgs e)
    {
        //_kiosk?.Dispose();
        //_kiosk = null;
    }

    private void CopyView_Loaded(object sender, RoutedEventArgs e)
    {

    }
}
