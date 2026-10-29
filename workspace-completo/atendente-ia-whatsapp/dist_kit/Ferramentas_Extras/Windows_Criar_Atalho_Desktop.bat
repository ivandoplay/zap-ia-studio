@echo off
chcp 65001 >nul
cd /d "%~dp0.."

if not exist "%CD%\sistema\package.json" (
    echo [ATENCAO] Extraia o arquivo .ZIP completamente antes de usar esta ferramenta.
    pause
    exit /b 1
)

echo Criando atalho oficial na sua Area de Trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\sistema\scripts\setup_windows_portable.ps1" -CreateShortcut
echo.
pause
