@echo off
:: ─────────────────────────────────────────────────────────────────
:: PrintBit Kiosk Startup Script
:: Starts the PrintBit server (which auto-launches MyPublicWiFi)
:: and opens Edge in kiosk mode using dynamic local IP.
::
:: This script self-elevates to Administrator if needed.
:: ─────────────────────────────────────────────────────────────────

:: Check for admin
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [PrintBit] Requesting administrator privileges...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

:: Set project directory (parent of scripts\)
cd /d "%~dp0.."
set "PROJECT_DIR=%cd%"
echo [PrintBit] Project: %PROJECT_DIR%

if "%PRINTBIT_KIOSK_LOCKDOWN%"=="" set "PRINTBIT_KIOSK_LOCKDOWN=true"
if "%PRINTBIT_USB_EXPORT_ENABLED%"=="" set "PRINTBIT_USB_EXPORT_ENABLED=false"
echo [PrintBit] Kiosk Lockdown: %PRINTBIT_KIOSK_LOCKDOWN%
echo [PrintBit] USB Export Enabled: %PRINTBIT_USB_EXPORT_ENABLED%

setlocal EnableDelayedExpansion
set "PROJECT_DIR_SANITIZED=%PROJECT_DIR%"
set "PROJECT_DIR_SANITIZED=!PROJECT_DIR_SANITIZED:^^=!"
set "PROJECT_DIR_SANITIZED=!PROJECT_DIR_SANITIZED:&=!"
set "PROJECT_DIR_SANITIZED=!PROJECT_DIR_SANITIZED:|=!"
set "PROJECT_DIR_SANITIZED=!PROJECT_DIR_SANITIZED:<=!"
set "PROJECT_DIR_SANITIZED=!PROJECT_DIR_SANITIZED:>=!"
set "PROJECT_DIR_SANITIZED=!PROJECT_DIR_SANITIZED:%%=!"
if not "%PROJECT_DIR%"=="!PROJECT_DIR_SANITIZED!" (
    echo [PrintBit] ERROR: Project path contains unsupported shell metacharacters (^& ^| ^< ^> ^! %%).
    echo [PrintBit]        Use a controlled deployment path without these characters.
    pause
    exit /b 1
)
endlocal & set "PROJECT_DIR=%PROJECT_DIR_SANITIZED%"

:: Ensure pnpm is available
where pnpm >nul 2>&1
if %errorlevel% neq 0 (
    echo [PrintBit] ERROR: pnpm not found. Install it with: npm install -g pnpm
    pause
    exit /b 1
)

if "%PORT%"=="" set "PORT=3000"

:: Start PrintBit server (this also launches MyPublicWiFi + hotspot)
echo [PrintBit] Starting server...
start "PrintBit Server" /min cmd /c "pushd ""%PROJECT_DIR%"" && pnpm run dev"

:: Wait for server + hotspot to come up before selecting kiosk IP
echo [PrintBit] Waiting for server to start...
timeout /t 10 /nobreak >nul

call :detect_ip
set "INITIAL_IP=%LOCAL_IP%"
timeout /t 3 /nobreak >nul
call :detect_ip
set "NEW_IP=%LOCAL_IP%"

set "LOCAL_IP=%INITIAL_IP%"
if not "%NEW_IP%"=="" (
    echo %NEW_IP% | findstr /R "^192\.168\.5\." >nul && set "LOCAL_IP=%NEW_IP%"
    echo %NEW_IP% | findstr /R "^192\.168\.137\." >nul && set "LOCAL_IP=%NEW_IP%"
    if "%LOCAL_IP%"=="" set "LOCAL_IP=%NEW_IP%"
)
set "INITIAL_IP="
set "NEW_IP="
if "%LOCAL_IP%"=="" (
    echo [PrintBit] WARNING: Could not detect local IP. Falling back to localhost.
    set "LOCAL_IP=localhost"
)

set "KIOSK_URL=http://%LOCAL_IP%:%PORT%"
echo [PrintBit] Kiosk URL: %KIOSK_URL%

:: Launch Edge in kiosk mode pointed at the dynamic IP
echo [PrintBit] Launching kiosk browser...
start "" msedge.exe --kiosk %KIOSK_URL% --edge-kiosk-type=fullscreen

echo [PrintBit] Kiosk started successfully at %KIOSK_URL%.
goto :eof

:detect_ip
set "LOCAL_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R "IPv4.*192\.168\.5\."') do (
    for /f "tokens=1 delims= (" %%B in ("%%A") do set "LOCAL_IP=%%B"
    goto :detect_done
)
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R "IPv4.*192\.168\.137\."') do (
    for /f "tokens=1 delims= (" %%B in ("%%A") do set "LOCAL_IP=%%B"
    goto :detect_done
)
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /R "IPv4.*[0-9][0-9]*\.[0-9]" ^| findstr /V /R "169\.254\."') do (
    for /f "tokens=1 delims= (" %%B in ("%%A") do set "LOCAL_IP=%%B"
    goto :detect_done
)
:detect_done
for /f "tokens=1 delims= (" %%A in ("%LOCAL_IP%") do set "LOCAL_IP=%%A"
exit /b
