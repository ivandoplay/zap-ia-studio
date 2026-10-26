@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo Criando atalho na sua Area de Trabalho...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$desktop = [Environment]::GetFolderPath('Desktop'); " ^
  "$s = $ws.CreateShortcut((Join-Path $desktop 'ZAP-IA Studio (WhatsApp).lnk')); " ^
  "$s.TargetPath = Join-Path '%~dp0' '2_Iniciar_Atendente_IA.bat'; " ^
  "$s.WorkingDirectory = '%~dp0'; " ^
  "$s.IconLocation = 'shell32.dll,13'; " ^
  "$s.Description = 'Abrir ZAP-IA Studio em Modo Aplicativo'; " ^
  "$s.Save()"

echo.
echo [PRONTO] Atalho "ZAP-IA Studio (WhatsApp)" criado na sua Area de Trabalho!
echo.
pause
