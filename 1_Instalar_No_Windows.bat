@echo off
chcp 65001 >nul
title Instalador — ZAP-IA Studio (Atendente Universal WhatsApp)
cd /d "%~dp0"

echo ==============================================================
echo   ZAP-IA STUDIO — INSTALACAO AUTOMATICA NO WINDOWS
echo ==============================================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ATENCAO] O Node.js nao foi encontrado no seu computador!
    echo.
    echo 1. Vamos abrir o site oficial do Node.js para voce baixar a versao LTS ^(Gratis^).
    echo 2. Instale clicando em Avancar ^(Next^) ate concluir.
    echo 3. Depois de instalar o Node.js, clique duas vezes neste arquivo novamente!
    echo.
    start https://nodejs.org/pt
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [OK] Node.js detectado: %NODE_VER%
echo.
echo Baixando e configurando as bibliotecas do sistema ^(aguarde 20 a 40 segundos^)...
echo.

call npm install

if %errorlevel% neq 0 (
    echo.
    echo [ERRO] Houve uma falha ao baixar os pacotes. Verifique sua internet e tente novamente.
    pause
    exit /b 1
)

if not exist ".env" (
    copy ".env.example" ".env" >nul 2>nul
)

echo.
echo ==============================================================
echo   INSTALACAO CONCLUIDA COM SUCESSO!
echo   Agora basta dar 2 cliques em: 2_Iniciar_Atendente_IA.bat
echo   ^(Ou rode 3_Criar_Atalho_Area_de_Trabalho.bat para criar icone^)
echo ==============================================================
echo.
pause
