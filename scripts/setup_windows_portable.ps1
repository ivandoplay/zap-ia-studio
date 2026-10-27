param(
    [switch]$ForceInstall,
    [switch]$StartApp,
    [switch]$CreateShortcut
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor 3072
} catch {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
}

$RootDir = Split-Path -Parent $PSScriptRoot
$PkgJson = Join-Path $RootDir 'package.json'

if (-not (Test-Path -LiteralPath $PkgJson)) {
    Write-Host ''
    Write-Host '[ATENCAO] Voce abriu o arquivo de dentro do .ZIP sem extrair!' -ForegroundColor Yellow
    Write-Host 'Clique com o botao direito no arquivo .ZIP baixado -> "Extrair Tudo..." e abra pela pasta extraida.'
    Write-Host ''
    exit 1
}

if ($CreateShortcut) {
    $ws = New-Object -ComObject WScript.Shell
    $desktop = [Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop 'ZAP-IA Studio (WhatsApp).lnk'
    $OuterDir = Split-Path -Parent $RootDir
    $OuterBat = Join-Path $OuterDir 'INICIAR_NO_WINDOWS.bat'
    $s = $ws.CreateShortcut($lnkPath)
    if (Test-Path -LiteralPath $OuterBat) {
        $s.TargetPath = $OuterBat
        $s.WorkingDirectory = $OuterDir
    } else {
        $s.TargetPath = Join-Path $RootDir '2_Iniciar_Atendente_IA.bat'
        $s.WorkingDirectory = $RootDir
    }
    $s.IconLocation = 'shell32.dll,13'
    $s.Description = 'Abrir ZAP-IA Studio (Motor Portatil Automatico)'
    $s.Save()
    Write-Host "[PRONTO] Atalho 'ZAP-IA Studio (WhatsApp)' criado na sua Area de Trabalho!" -ForegroundColor Green
    exit 0
}

$RuntimeDir = Join-Path $RootDir '.runtime'
$PortableNodeDir = Join-Path $RuntimeDir 'node'
$PortableNodeExe = Join-Path $PortableNodeDir 'node.exe'

function Test-NodeMajor20Plus([string]$ExePath) {
    if (-not $ExePath -or -not (Test-Path -LiteralPath $ExePath)) {
        return $false
    }
    try {
        $verOut = & $ExePath -p "process.versions.node.split('.')[0]" 2>$null
        $major = 0
        if ([int]::TryParse(($verOut | Out-String).Trim(), [ref]$major)) {
            return ($major -ge 20)
        }
    } catch {}
    return $false
}

function Resolve-ActiveNodeInfo {
    # 1. Prioriza o Node Portatil isolado dentro da propria pasta do sistema
    if (Test-NodeMajor20Plus $PortableNodeExe) {
        return @{
            IsPortable = $true
            NodeDir    = $PortableNodeDir
            NodeExe    = $PortableNodeExe
            NpmCmd     = (Join-Path $PortableNodeDir 'npm.cmd')
            Source     = 'Portatil Local (.runtime\node)'
        }
    }

    # 2. Caso o PC ja tenha Node.js >= 20 global instalado e funcional, aproveita
    $sysNode = Get-Command node -ErrorAction SilentlyContinue
    if ($sysNode -and $sysNode.Source -and (Test-NodeMajor20Plus $sysNode.Source)) {
        $sysDir = Split-Path -Parent $sysNode.Source
        $sysNpm = Join-Path $sysDir 'npm.cmd'
        if (-not (Test-Path -LiteralPath $sysNpm)) {
            $npmLookup = Get-Command npm.cmd -ErrorAction SilentlyContinue
            if ($npmLookup) { $sysNpm = $npmLookup.Source }
        }
        if ($sysNpm -and (Test-Path -LiteralPath $sysNpm)) {
            return @{
                IsPortable = $false
                NodeDir    = $sysDir
                NodeExe    = $sysNode.Source
                NpmCmd     = $sysNpm
                Source     = 'Sistema Windows'
            }
        }
    }

    return $null
}

function Install-PortableNode {
    Write-Host ''
    Write-Host '==============================================================' -ForegroundColor Cyan
    Write-Host '  PREPARANDO MOTOR PORTATIL ZAP-IA STUDIO (1a EXECUCAO)' -ForegroundColor Cyan
    Write-Host '  Nao precisa instalar nada por fora nem permissao Admin!' -ForegroundColor Gray
    Write-Host '==============================================================' -ForegroundColor Cyan
    Write-Host ''

    if (-not (Test-Path -LiteralPath $RuntimeDir)) {
        New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
    }

    $rawArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $nodeArch = switch -Regex ($rawArch) {
        'ARM64'      { 'win-arm64'; break }
        'AMD64|IA64' { 'win-x64'; break }
        default      { 'win-x86' }
    }

    $baseUrl = 'https://nodejs.org/dist/latest-v22.x'
    $zipFileName = $null
    $expectedSha256 = $null

    Write-Host "[1/2] Localizando Node.js v22 LTS Portatil Oficial ($nodeArch)..." -ForegroundColor Green
    try {
        $shasums = (Invoke-WebRequest -Uri "$baseUrl/SHASUMS256.txt" -UseBasicParsing -TimeoutSec 20).Content
        foreach ($line in ($shasums -split "`r?`n")) {
            if ($line -match "^([0-9a-fA-F]{64})\s+(node-v22\.\d+\.\d+-$nodeArch\.zip)$") {
                $expectedSha256 = $Matches[1].ToLowerInvariant()
                $zipFileName = $Matches[2]
                break
            }
        }
    } catch {}

    if (-not $zipFileName) {
        $baseUrl = 'https://nodejs.org/dist/v22.23.4'
        $zipFileName = "node-v22.23.4-$nodeArch.zip"
        $fallbackHashes = @{
            'win-x64'   = 'cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20'
            'win-arm64' = 'a8b8cd79cbbb3062435f449591d98dd63730bbbf30ce2d7cc3a6376c236cb111'
            'win-x86'   = '7d6c4dce2ecccca46e3c4b3e43c8bebbd1969bd616fdb4fda1e8269171d9ccea'
        }
        $expectedSha256 = $fallbackHashes[$nodeArch]
    }

    $downloadUrl = "$baseUrl/$zipFileName"
    $shortTmpRoot = Join-Path ([System.IO.Path]::GetTempPath()) "zapia_node_$PID"
    if (Test-Path -LiteralPath $shortTmpRoot) {
        Remove-Item -LiteralPath $shortTmpRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $shortTmpRoot -Force | Out-Null
    $tmpZip = Join-Path $shortTmpRoot 'node.zip'
    $extractTmp = Join-Path $shortTmpRoot 'ext'
    New-Item -ItemType Directory -Path $extractTmp -Force | Out-Null

    try {
        Write-Host "      Baixando $zipFileName (~34 MB)..." -ForegroundColor Gray
        $sysCurl = Join-Path $env:SystemRoot 'System32\curl.exe'
        $downloaded = $false

        if (Test-Path -LiteralPath $sysCurl) {
            & $sysCurl -fSL --retry 3 --connect-timeout 20 -o $tmpZip $downloadUrl
            if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $tmpZip)) {
                $downloaded = $true
            }
        }

        if (-not $downloaded) {
            Invoke-WebRequest -Uri $downloadUrl -OutFile $tmpZip -UseBasicParsing -TimeoutSec 240
        }

        if (-not (Test-Path -LiteralPath $tmpZip)) {
            throw 'Nao foi possivel baixar o pacote portatil do Node.js. Verifique sua conexao com a internet.'
        }

        if ($expectedSha256) {
            $actualHash = (Get-FileHash -LiteralPath $tmpZip -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actualHash -ne $expectedSha256) {
                throw "Falha de integridade SHA-256 no download ($actualHash != $expectedSha256). Tente novamente."
            }
        }

        Write-Host '      Extraindo motor portatil na pasta local (.runtime\node)...' -ForegroundColor Gray
        $sysTar = Join-Path $env:SystemRoot 'System32\tar.exe'
        $extracted = $false
        if (Test-Path -LiteralPath $sysTar) {
            & $sysTar -xf $tmpZip -C $extractTmp 2>$null
            if ($LASTEXITCODE -eq 0) { $extracted = $true }
        }
        if (-not $extracted) {
            Add-Type -AssemblyName System.IO.Compression.FileSystem
            [System.IO.Compression.ZipFile]::ExtractToDirectory($tmpZip, $extractTmp)
        }

        $innerDir = Get-ChildItem -LiteralPath $extractTmp -Directory | Select-Object -First 1
        if (-not $innerDir) {
            throw 'Estrutura inesperada ao extrair o Node.js portatil.'
        }

        if (Test-Path -LiteralPath $PortableNodeDir) {
            & cmd.exe /c "rmdir /s /q `"$PortableNodeDir`"" 2>$null | Out-Null
        }
        New-Item -ItemType Directory -Path $PortableNodeDir -Force | Out-Null

        # Robocopy contorna nativamente o limite MAX_PATH (260 caracteres) mesmo em pastas do OneDrive
        & robocopy $innerDir.FullName $PortableNodeDir /E /MOVE /NFL /NDL /NJH /NJS /NP /R:2 /W:1 | Out-Null
        if ($LASTEXITCODE -ge 8) {
            throw "Falha ao copiar arquivos do Node portatil (robocopy codigo $LASTEXITCODE)."
        }

        Unblock-File -LiteralPath $PortableNodeExe -ErrorAction SilentlyContinue
    } finally {
        if (Test-Path -LiteralPath $shortTmpRoot) {
            & cmd.exe /c "rmdir /s /q `"$shortTmpRoot`"" 2>$null | Out-Null
        }
    }

    if (-not (Test-NodeMajor20Plus $PortableNodeExe)) {
        throw 'O motor Node.js portatil foi extraido, mas nao respondeu corretamente.'
    }

    $verStr = (& $PortableNodeExe -v | Out-String).Trim()
    Write-Host "      [OK] Node.js Portatil $verStr pronto!" -ForegroundColor Green
}

$nodeInfo = Resolve-ActiveNodeInfo
if (-not $nodeInfo) {
    Install-PortableNode
    $nodeInfo = Resolve-ActiveNodeInfo
}

if (-not $nodeInfo) {
    Write-Host '[ERRO] Nao foi possivel preparar o motor Node.js.' -ForegroundColor Red
    exit 1
}

$env:Path = "$($nodeInfo.NodeDir);$env:Path"
$env:NODE_OPTIONS = '--dns-result-order=ipv4first --no-network-family-autoselection'

# Auto-Update Universal ANTES do npm install (usa apenas Node puro!)
$autoUpdateScript = Join-Path $RootDir 'scripts\auto_update_boot.mjs'
$justUpdated = $false
if ($StartApp -and (Test-Path -LiteralPath $autoUpdateScript)) {
    Push-Location -LiteralPath $RootDir
    try {
        $env:ZAPIA_DEFER_NPM = '1'
        & $nodeInfo.NodeExe '--dns-result-order=ipv4first' '--no-network-family-autoselection' 'scripts/auto_update_boot.mjs' '--signal-updated-exit-20'
        if ($LASTEXITCODE -eq 20) {
            $justUpdated = $true
        }
    } catch {} finally {
        Remove-Item Env:\ZAPIA_DEFER_NPM -ErrorAction SilentlyContinue
        Pop-Location
    }
}

$expressCheck = Join-Path $RootDir 'node_modules\express\package.json'
$baileysCheck = Join-Path $RootDir 'node_modules\@whiskeysockets\baileys\package.json'
$needsNpmInstall = $ForceInstall -or (-not (Test-Path -LiteralPath $expressCheck)) -or (-not (Test-Path -LiteralPath $baileysCheck))

if ($needsNpmInstall) {
    Write-Host ''
    Write-Host '[2/2] Baixando e configurando bibliotecas do ZAP-IA Studio (modo anti-timeout IPv4)...' -ForegroundColor Green
    Push-Location -LiteralPath $RootDir
    try {
        & $nodeInfo.NpmCmd install --legacy-peer-deps --no-audit --no-fund --maxsockets=4 --fetch-timeout=300000 --fetch-retries=6 --prefer-offline
        if ($LASTEXITCODE -ne 0) {
            Write-Host '      [Auto-Recuperacao] Oscilacao de rede detectada -- tentando via espelho CDN...' -ForegroundColor Yellow
            & $nodeInfo.NpmCmd install --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmmirror.com --maxsockets=4 --fetch-timeout=300000 --fetch-retries=6 --prefer-offline --omit=optional
        }
        if ($LASTEXITCODE -ne 0) {
            throw "npm install retornou codigo $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }

    $ffmpegExe = Join-Path $RootDir 'node_modules\ffmpeg-static\ffmpeg.exe'
    if (Test-Path -LiteralPath $ffmpegExe) {
        Unblock-File -LiteralPath $ffmpegExe -ErrorAction SilentlyContinue
    }
    Write-Host '      [OK] Bibliotecas instaladas com sucesso!' -ForegroundColor Green
}

$envFile = Join-Path $RootDir '.env'
$envExample = Join-Path $RootDir '.env.example'
if ((-not (Test-Path -LiteralPath $envFile)) -and (Test-Path -LiteralPath $envExample)) {
    Copy-Item -LiteralPath $envExample -Destination $envFile -Force
}

function Test-LocalPortListening([int]$Port) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if ($iar.AsyncWaitHandle.WaitOne(220, $false) -and $client.Connected) {
            $client.EndConnect($iar)
            return $true
        }
    } catch {} finally {
        $client.Close()
    }
    return $false
}

if ($StartApp) {
    if ($justUpdated -and (Test-LocalPortListening 3000)) {
        Write-Host '[Auto-Update] Reiniciando motor em segundo plano para ativar a nova versao...' -ForegroundColor Cyan
        try {
            Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
                Where-Object { $_.CommandLine -like '*src/server.js*' -or $_.CommandLine -like '*src\server.js*' } |
                ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
            Start-Sleep -Seconds 1
        } catch {}
    }

    if (-not (Test-LocalPortListening 3000)) {
        Write-Host 'Iniciando Motor ZAP-IA Studio em segundo plano...' -ForegroundColor Cyan
        if (-not (Test-Path -LiteralPath $RuntimeDir)) {
            New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
        }
        $launcherBat = Join-Path $RuntimeDir 'run_motor_bg.cmd'
        $utf8NoBom = New-Object System.Text.UTF8Encoding($false)

        if ($nodeInfo.IsPortable) {
            $batLines = @(
                '@echo off',
                'chcp 65001 >nul',
                'title Motor ZAP-IA Studio (Nao feche enquanto usar o robo)',
                'set "PATH=%CD%\.runtime\node;%PATH%"',
                ':loop',
                '".runtime\node\node.exe" --dns-result-order=ipv4first scripts/auto_update_boot.mjs',
                '".runtime\node\node.exe" --dns-result-order=ipv4first src/server.js',
                'if %ERRORLEVEL% EQU 0 exit /b 0',
                'if %ERRORLEVEL% EQU 130 exit /b 0',
                'timeout /t 3 /nobreak >nul',
                'goto loop'
            )
        } else {
            $batLines = @(
                '@echo off',
                'chcp 65001 >nul',
                'title Motor ZAP-IA Studio (Nao feche enquanto usar o robo)',
                "set `"PATH=$($nodeInfo.NodeDir);%PATH%`"",
                ':loop',
                "`"$($nodeInfo.NodeExe)`" --dns-result-order=ipv4first scripts/auto_update_boot.mjs",
                "`"$($nodeInfo.NodeExe)`" --dns-result-order=ipv4first src/server.js",
                'if %ERRORLEVEL% EQU 0 exit /b 0',
                'if %ERRORLEVEL% EQU 130 exit /b 0',
                'timeout /t 3 /nobreak >nul',
                'goto loop'
            )
        }

        [System.IO.File]::WriteAllLines($launcherBat, $batLines, $utf8NoBom)

        Start-Process -FilePath 'cmd.exe' -ArgumentList '/k .runtime\run_motor_bg.cmd' -WorkingDirectory $RootDir -WindowStyle Minimized | Out-Null

        for ($i = 0; $i -lt 32; $i++) {
            if (Test-LocalPortListening 3000) { break }
            Start-Sleep -Milliseconds 250
        }
    }

    $appUrl = 'http://localhost:3000'
    $browserCandidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LocalAppData 'Google\Chrome\Application\chrome.exe')
    )

    $openedAppMode = $false
    foreach ($browserExe in $browserCandidates) {
        if ($browserExe -and (Test-Path -LiteralPath $browserExe)) {
            Start-Process -FilePath $browserExe -ArgumentList "--app=$appUrl" | Out-Null
            $openedAppMode = $true
            break
        }
    }

    if (-not $openedAppMode) {
        Start-Process $appUrl | Out-Null
    }
}

exit 0
