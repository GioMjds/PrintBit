# Copilot Instructions

## Build and Test Commands
- Build solution: `dotnet build .\pisopit.slnx`
- Build app project only: `dotnet build .\pisopit\pisopit.csproj`
- Run all tests (when test projects are added): `dotnet test .\pisopit.slnx`
- Run one test by name filter: `dotnet test .\pisopit.slnx --filter "FullyQualifiedName~Namespace.ClassName.TestName"`

Current baseline: there is no test project yet, and `dotnet build .\pisopit.slnx` currently fails on `MainWindow.xaml` because WPF `StackPanel` does not support the `Spacing` property.

## High-Level Architecture
- Treat this repository as a **Clean Architecture + MVVM** codebase, reflecting user preference for project structure.
- Current implementation is in a single WPF app project (`pisopit\pisopit.csproj`, `net10.0-windows`, `UseWPF=true`) with startup at `App.xaml` -> `MainWindow.xaml`.
- Presentation layer (MVVM UI side): XAML views and code-behind currently exist for `MainWindow` and `IdleView`; the `MainWindow` UI already models kiosk flows (preview, payment, print settings, actions, status/receipt).
- Domain/application intent (from `README.md`): offline kiosk workflow for upload -> payment validation -> print -> change dispensing.
- For new work, keep Clean Architecture boundaries explicit:
  - domain rules/use cases should remain independent of WPF UI concerns
  - infrastructure concerns (printer, coin acceptor/hopper, local upload server integration) should be behind interfaces
  - presentation should coordinate through ViewModels rather than embedding business logic in views

## Key Conventions
- Keep the MVVM direction explicit: prefer binding and commands in ViewModels for new features; keep code-behind focused on view-specific behavior only.
- Preserve existing control naming style: `x:Name` values include control-type suffixes (`BalanceTextBlock`, `CoinComboBox`, `StartPrintButton`, etc.).
- Keep classes in the `pisopit` namespace and maintain WPF partial class pairs (`MainWindow.xaml` + `MainWindow.xaml.cs`, etc.).
- Keep solution-level commands rooted at repository top with the `.slnx` file (`pisopit.slnx`).
- Disable or comment out kiosk mode, the magic hotkey for exiting the app, and fullscreen functionality across the solution by default. Ensure that the WPF window starts in a normal state (WindowState should be Normal, not Maximized).
- Disable serial COM port detection to allow the UI to run without an Arduino by using the `PRINTBIT_DISABLE_SERIAL` environment variable to skip serial registration.
