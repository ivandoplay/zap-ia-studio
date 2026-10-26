@echo off
chcp 65001 >nul
title ZAP-IA Studio -- Inicializador Oficial Windows (Zero Instalacao)
cd /d "%~dp0"

if not exist "%~dp0sistema\package.json" (
    echo.
    echo [ATENCAO] Voce abriu este arquivo direto de dentro do .ZIP sem extrair!
    echo Clique com o botao direito no arquivo .ZIP baixado ^> "Extrair Tudo..."
    echo e depois de 2 cliques em INICIAR_NO_WINDOWS.bat na pasta extraida.
    echo.
    pause
    exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0sistema\scripts\setup_windows_portable.ps1" -StartApp
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Nao foi possivel iniciar o ZAP-IA Studio automaticamente.
    echo Verifique sua conexao com a internet ^(na 1a abertura o sistema baixa o motor portatil sozinho^) e tente novamente.
    echo.
    pause
    exit /b 1
)

exit /b 0
