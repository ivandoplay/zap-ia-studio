@echo off
chcp 65001 >nul
title Instalador Portatil Automatico -- Ienvia
cd /d "%~dp0"

if not exist "%~dp0package.json" (
    echo [ATENCAO] Voce abriu este arquivo de dentro do .ZIP sem extrair!
    echo Clique com o botao direito no arquivo .ZIP baixado ^> "Extrair Tudo..." e abra pela pasta extraida.
    echo.
    pause
    exit /b 1
)

echo ==============================================================
echo   IENVIA -- PREPARACAO AUTOMATICA PORTATIL (WINDOWS)
echo   Zero instalacao externa: prepara o motor Node.js sozinho!
echo ==============================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup_windows_portable.ps1" -ForceInstall
if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Houve uma falha na preparacao automatica. Verifique sua conexao com a internet e tente novamente.
    pause
    exit /b 1
)

echo.
echo ==============================================================
echo   TUDO PRONTO COM SUCESSO!
echo   Agora basta dar 2 cliques em: 2_Iniciar_Atendente_IA.bat
echo   ^(Ou rode 3_Criar_Atalho_Area_de_Trabalho.bat para criar icone^)
echo ==============================================================
echo.
pause
