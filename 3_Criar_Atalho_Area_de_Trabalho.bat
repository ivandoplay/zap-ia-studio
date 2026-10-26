@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist "%~dp0package.json" (
    echo [ATENCAO] Voce abriu este arquivo de dentro do .ZIP sem extrair!
    echo Clique com o botao direito no arquivo .ZIP baixado ^> "Extrair Tudo..." e abra pela pasta extraida.
    echo.
    pause
    exit /b 1
)

echo Criando atalho na sua Area de Trabalho...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_windows_portable.ps1" -CreateShortcut
echo.
pause
