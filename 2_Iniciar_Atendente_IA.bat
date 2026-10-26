@echo off
chcp 65001 >nul
title ZAP-IA Studio -- Inicializador Automatico (Zero Instalacao)
cd /d "%~dp0"

if not exist "%~dp0package.json" (
    echo [ATENCAO] Voce abriu este arquivo de dentro do .ZIP sem extrair!
    echo Clique com o botao direito no arquivo .ZIP baixado ^> "Extrair Tudo..." e abra pela pasta extraida.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_windows_portable.ps1" -StartApp
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Nao foi possivel iniciar o ZAP-IA Studio automaticamente.
    echo Verifique sua internet ^(na 1a abertura o sistema baixa o motor portatil sozinho^) e tente novamente.
    echo.
    pause
    exit /b 1
)

exit /b 0
