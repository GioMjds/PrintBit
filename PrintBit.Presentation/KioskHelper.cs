using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;

namespace PrintBit.Presentation
{
    // Lightweight helper that applies Kiosk-mode settings to a Window and installs
    // a low-level keyboard hook to suppress common system shortcuts.
    public sealed class KioskHelper : IDisposable
    {
        private readonly Window _window;
        private IntPtr _hookId = IntPtr.Zero;
        private readonly LowLevelKeyboardProc _proc;
        private readonly IntPtr _hwnd;
        private bool _disposed;

        // Secret exit combo: Ctrl + Alt + K
        private const int VK_K = 0x4B;
        private const int VK_LWIN = 0x5B;
        private const int VK_RWIN = 0x5C;
        private const int VK_APPS = 0x5D;
        private const int VK_TAB = 0x09;
        private const int VK_F4 = 0x73;
        private const int VK_ESCAPE = 0x1B;

        private const int WH_KEYBOARD_LL = 13;
        private const int WM_KEYDOWN = 0x0100;
        private const int WM_SYSKEYDOWN = 0x0104;

        private KioskHelper(Window window)
        {
            _window = window ?? throw new ArgumentNullException(nameof(window));
            _proc = HookCallback;
            var wih = new WindowInteropHelper(_window);
            _hwnd = wih.EnsureHandle();
        }

        public static KioskHelper Attach(Window window)
        {
            var k = new KioskHelper(window);
            k.Enable();
            return k;
        }

        private void Enable()
        {
            // Window presentation settings
            _window.WindowStyle = WindowStyle.None;
            _window.ResizeMode = ResizeMode.NoResize;
            _window.WindowState = WindowState.Maximized;
            _window.Topmost = true;
            _window.ShowInTaskbar = false;
            // System.Windows.Input.Mouse.OverrideCursor = Cursors.None;

            // Cover taskbar / all monitors - use native APIs to get monitor bounds
            IntPtr hMonitor = MonitorFromWindow(_hwnd, MONITOR_DEFAULTTOPRIMARY);
            MONITORINFO monitorInfo = new MONITORINFO();
            monitorInfo.cbSize = Marshal.SizeOf(typeof(MONITORINFO));
            
            if (GetMonitorInfo(hMonitor, ref monitorInfo))
            {
                var bounds = monitorInfo.rcMonitor;
                SetWindowPos(_hwnd, IntPtr.Zero,
                    bounds.Left, bounds.Top,
                    bounds.Right - bounds.Left, bounds.Bottom - bounds.Top,
                    SWP_NOZORDER | SWP_FRAMECHANGED);
            }

            // Install low-level keyboard hook
            // Pass null to GetModuleHandle to get the current process module handle
            _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, _proc, GetModuleHandle(null), 0);
        }

        private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
        {
            if (nCode >= 0 && (wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN))
            {
                int vkCode = Marshal.ReadInt32(lParam);

                bool altDown = (GetAsyncKeyState(VK_MENU) & 0x8000) != 0;
                bool ctrlDown = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;

                // Allow the secret exit combo (Ctrl+Alt+K) to pass and trigger exit
                if (vkCode == VK_K && ctrlDown && altDown)
                {
                    // Request a graceful exit on the UI thread
                    _window.Dispatcher.BeginInvoke(new Action(() =>
                    {
                        if (_window is MainWindow mw)
                            mw.RequestExitFromKiosk();
                    }));
                    return (IntPtr)1; // swallow so it doesn't go elsewhere
                }

                // Swallow platform/system combinations:
                if (vkCode == VK_LWIN || vkCode == VK_RWIN || vkCode == VK_APPS)
                    return (IntPtr)1;

                if (vkCode == VK_TAB && altDown) // Alt+Tab
                    return (IntPtr)1;

                if (vkCode == VK_F4 && altDown) // Alt+F4
                    return (IntPtr)1;

                if (vkCode == VK_ESCAPE && ctrlDown) // Ctrl+Esc
                    return (IntPtr)1;
            }

            return CallNextHookEx(_hookId, nCode, wParam, lParam);
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            try
            {
                if (_hookId != IntPtr.Zero)
                {
                    UnhookWindowsHookEx(_hookId);
                    _hookId = IntPtr.Zero;
                }
            }
            catch { }

            // restore cursor
            System.Windows.Input.Mouse.OverrideCursor = null;
        }

        #region Native

        private const uint SWP_NOZORDER = 0x0004;
        private const uint SWP_FRAMECHANGED = 0x0020;

        private const int VK_MENU = 0x12;
        private const int VK_CONTROL = 0x11;

        private const int MONITOR_DEFAULTTOPRIMARY = 1;

        private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

        [StructLayout(LayoutKind.Sequential)]
        private struct KBDLLHOOKSTRUCT
        {
            public uint vkCode;
            public uint scanCode;
            public uint flags;
            public uint time;
            public UIntPtr dwExtraInfo;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left;
            public int Top;
            public int Right;
            public int Bottom;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct MONITORINFO
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
        }

        [DllImport("user32.dll", SetLastError = true)]
        private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool UnhookWindowsHookEx(IntPtr hhk);

        [DllImport("user32.dll")]
        private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

        [DllImport("kernel32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr GetModuleHandle(string? lpModuleName);

        [DllImport("user32.dll")]
        private static extern short GetAsyncKeyState(int vKey);

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter,
            int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

        #endregion
    }
}
