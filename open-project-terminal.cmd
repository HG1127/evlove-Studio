@echo off
setlocal
rem Set this before pwsh starts: its update banner can fail before profiles run.
set "POWERSHELL_UPDATECHECK=Off"
cd /d "%~dp0"
if errorlevel 1 exit /b 1
if not exist "%ProgramFiles%\PowerShell\7\pwsh.exe" (
    echo PowerShell 7 was not found in Program Files.
    pause
    exit /b 1
)
"%ProgramFiles%\PowerShell\7\pwsh.exe" -NoLogo -NoExit -Command "$Host.UI.RawUI.WindowTitle = 'Evolution Project Terminal'; Write-Host ('Project: ' + (Get-Location).Path)"
endlocal
