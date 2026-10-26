@echo off
chcp 65001 >nul
title ZAP-IA Studio — Inicializador Modo App
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERRO] Node.js nao instalado! Rode primeiro: 1_Instalar_No_Windows.bat
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo Primeira execucao detectada! Instalando dependencias automaticamente...
    call npm install
)

REM Verifica se o servidor ja esta ativo na porta 3000
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>nul
if %errorlevel% neq 0 (
    echo Iniciando motor do WhatsApp em segundo plano...
    start "Motor ZAP-IA Studio (Nao feche enquanto usar o robo)" /min cmd /k "chcp 65001 >nul && node src/server.js"
    timeout /t 2 /nobreak >nul
)

REM Abre em Modo Aplicativo Hibrido (Janela limpa sem barra de abas!)
set "APP_URL=http://localhost:3000"

if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --app=%APP_URL%
    exit /b 0
)

if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --app=%APP_URL%
    exit /b 0
)

if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --app=%APP_URL%
    exit /b 0
)

if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" (
    start "" "%LocalAppData%\Google\Chrome\Application\chrome.exe" --app=%APP_URL%
    exit /b 0
)

start "" "%APP_URL%"
exit /b 0
