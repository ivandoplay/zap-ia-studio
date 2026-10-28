@echo off
chcp 65001 >nul
title Ienvia -- Reparar / Reinstalar Bibliotecas (Windows)
cd /d "%~dp0.."

if not exist "%CD%\sistema\package.json" (
    echo [ATENCAO] Extraia o arquivo .ZIP completamente antes de usar esta ferramenta.
    pause
    exit /b 1
)

echo ==============================================================
echo   IENVIA -- REPARO AUTOMATICO DO MOTOR PORTATIL
echo ==============================================================
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%CD%\sistema\scripts\setup_windows_portable.ps1" -ForceInstall
echo.
pause
