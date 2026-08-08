#Requires -Version 5.1
#Requires -RunAsAdministrator

# Instalador de um comando so do Q-Zap para cliente novo (Etapa 11 do DEV_PLAN.md).
# Automatiza o que hoje e manual nas Etapas 1 e 10: pre-requisitos, .env, pastas,
# Evolution API via Docker, instancia do WhatsApp e o servico do Windows.

$ErrorActionPreference = 'Stop'

function Test-Comando([string]$Nome) {
    return $null -ne (Get-Command $Nome -ErrorAction SilentlyContinue)
}

function Resolve-ComandoCompose {
    if (Test-Comando 'docker') {
        docker compose version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return @('docker', 'compose') }
    }
    if (Test-Comando 'docker-compose') {
        docker-compose version 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { return @('docker-compose') }
    }
    return $null
}

function Invoke-DockerCompose([string[]]$ComandoBase, [string]$RaizProjeto, [string[]]$Argumentos) {
    Push-Location $RaizProjeto
    try {
        $listaArgumentos = @($ComandoBase | Select-Object -Skip 1) + $Argumentos
        & $ComandoBase[0] @listaArgumentos
        if ($LASTEXITCODE -ne 0) {
            throw "Comando docker compose falhou: $($Argumentos -join ' ')"
        }
    } finally {
        Pop-Location
    }
}

function Get-EnvMap([string]$Caminho) {
    $mapa = [ordered]@{}
    if (-not (Test-Path $Caminho)) { return $mapa }
    foreach ($linha in Get-Content -Path $Caminho) {
        $linha = $linha.Trim()
        if ($linha -eq '' -or $linha.StartsWith('#')) { continue }
        $indice = $linha.IndexOf('=')
        if ($indice -lt 1) { continue }
        $chave = $linha.Substring(0, $indice).Trim()
        $valor = $linha.Substring($indice + 1).Trim()
        $mapa[$chave] = $valor
    }
    return $mapa
}

function Set-EnvValor([string]$Caminho, [string]$Chave, [string]$Valor) {
    $linhas = Get-Content -Path $Caminho
    $encontrada = $false
    $novasLinhas = foreach ($linha in $linhas) {
        if ($linha -match "^\s*$([regex]::Escape($Chave))\s*=") {
            $encontrada = $true
            "$Chave=$Valor"
        } else {
            $linha
        }
    }
    if (-not $encontrada) {
        $novasLinhas = @($novasLinhas) + "$Chave=$Valor"
    }
    $codificacao = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($Caminho, [string[]]$novasLinhas, $codificacao)
}

function New-TokenAleatorio([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($buffer)
    } finally {
        $rng.Dispose()
    }
    -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function Read-PastaBase {
    while ($true) {
        $valor = (Read-Host 'Pasta base onde o ERP salva os PDFs (caminho completo)').Trim()
        if ($valor -ne '') { return $valor }
        Write-Host 'A pasta base e obrigatoria.' -ForegroundColor Yellow
    }
}

function Read-NumeroAdmin {
    while ($true) {
        $bruto = Read-Host 'Numero administrador, com DDI (ex: 5551999999999)'
        $sanitizado = ($bruto -replace '\D', '')
        if ($sanitizado -match '^\d{12,13}$') { return $sanitizado }
        Write-Host 'Numero invalido. Informe DDI + DDD + numero (12 ou 13 digitos apos remover formatacao).' -ForegroundColor Yellow
    }
}

function Read-LimiteDiario {
    $padrao = 50
    while ($true) {
        $bruto = Read-Host "Limite diario de mensagens por numero [padrao: $padrao, Enter aceita o padrao]"
        if ($bruto.Trim() -eq '') { return $padrao }
        if ($bruto -match '^\d+$' -and [int]$bruto -gt 0) { return [int]$bruto }
        Write-Host 'Informe um numero inteiro positivo, ou deixe em branco para usar o padrao.' -ForegroundColor Yellow
    }
}

function Wait-EvolutionApiPronta([string]$BaseUrl, [int]$MaxTentativas = 30, [int]$IntervaloSegundos = 2) {
    for ($tentativa = 1; $tentativa -le $MaxTentativas; $tentativa++) {
        try {
            Invoke-RestMethod -Uri $BaseUrl -Method Get -TimeoutSec 5 | Out-Null
            return $true
        } catch {
            Start-Sleep -Seconds $IntervaloSegundos
        }
    }
    return $false
}

function Test-InstanciaExiste([string]$BaseUrl, [string]$ApiKey, [string]$NomeInstancia) {
    try {
        $resposta = Invoke-RestMethod -Uri "$BaseUrl/instance/fetchInstances" -Headers @{ apikey = $ApiKey } -Method Get -TimeoutSec 10
        foreach ($item in $resposta) {
            $nome = $item.name
            if (-not $nome) { $nome = $item.instanceName }
            if ($nome -eq $NomeInstancia) { return $true }
        }
        return $false
    } catch {
        return $false
    }
}

function New-InstanciaEvolution([string]$BaseUrl, [string]$ApiKey, [string]$NomeInstancia) {
    $corpo = @{
        instanceName = $NomeInstancia
        qrcode       = $true
        Integration  = 'WHATSAPP-BAILEYS'
    } | ConvertTo-Json
    Invoke-RestMethod -Uri "$BaseUrl/instance/create" -Headers @{ apikey = $ApiKey } -Method Post -Body $corpo -ContentType 'application/json' -TimeoutSec 15 | Out-Null
}

function Get-EstadoConexaoInstancia([string]$BaseUrl, [string]$ApiKey, [string]$NomeInstancia) {
    try {
        $resposta = Invoke-RestMethod -Uri "$BaseUrl/instance/connectionState/$NomeInstancia" -Headers @{ apikey = $ApiKey } -Method Get -TimeoutSec 10
        return $resposta.instance.state
    } catch {
        return $null
    }
}

function Wait-Pareamento([string]$BaseUrl, [string]$ApiKey, [string]$NomeInstancia, [int]$MaxTentativas = 100, [int]$IntervaloSegundos = 3) {
    for ($tentativa = 1; $tentativa -le $MaxTentativas; $tentativa++) {
        $estado = Get-EstadoConexaoInstancia -BaseUrl $BaseUrl -ApiKey $ApiKey -NomeInstancia $NomeInstancia
        if ($estado -eq 'open') { return $true }
        if ($tentativa % 10 -eq 0) {
            Write-Host "Ainda aguardando o pareamento do WhatsApp (estado atual: $estado)..."
        }
        Start-Sleep -Seconds $IntervaloSegundos
    }
    return $false
}

function Update-PathDaSessao {
    $env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [System.Environment]::GetEnvironmentVariable('Path', 'User')
}

function Install-NodeViaWinget {
    if (-not (Test-Comando 'winget')) { return $false }
    Write-Host 'Node.js nao encontrado. Tentando instalar automaticamente via winget...'
    winget install --id OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Host 'Instalacao do Node.js via winget falhou.' -ForegroundColor Yellow
        return $false
    }
    Update-PathDaSessao
    return Test-Comando 'node'
}

# ----- Fluxo principal -----

$raizProjeto = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $raizProjeto '.env'
$envExamplePath = Join-Path $raizProjeto '.env.example'

Write-Host '=== Instalador do Q-Zap ==='
Write-Host ''

Write-Host 'Verificando pre-requisitos...'
if (-not (Test-Comando 'node')) {
    if (-not (Install-NodeViaWinget)) {
        Write-Host 'Node.js nao encontrado e nao foi possivel instalar automaticamente (winget ausente ou instalacao falhou).' -ForegroundColor Red
        Write-Host 'Instale manualmente a versao LTS em https://nodejs.org e rode o script novamente.' -ForegroundColor Red
        exit 1
    }
    Write-Host 'Node.js instalado com sucesso.'
}
if (-not (Test-Comando 'docker')) {
    Write-Host 'Docker nao encontrado.' -ForegroundColor Red
    Write-Host 'Instale o Docker Desktop manualmente em https://www.docker.com/products/docker-desktop/ antes de continuar.' -ForegroundColor Red
    Write-Host 'A instalacao do Docker Desktop pode exigir habilitar WSL2/Hyper-V e reiniciar a maquina -- faca isso e rode o script de novo.' -ForegroundColor Red
    exit 1
}
$comandoCompose = Resolve-ComandoCompose
if (-not $comandoCompose) {
    Write-Host 'Docker Compose nao encontrado (nem "docker compose" nem "docker-compose"). Atualize o Docker Desktop.' -ForegroundColor Red
    exit 1
}
Write-Host "Pre-requisitos OK (docker compose: $($comandoCompose -join ' '))."
Write-Host ''

$primeiraExecucao = -not (Test-Path $envPath)
if ($primeiraExecucao) {
    if (-not (Test-Path $envExamplePath)) {
        throw 'Arquivo .env.example nao encontrado na raiz do projeto.'
    }
    Copy-Item -Path $envExamplePath -Destination $envPath

    Write-Host 'Primeira instalacao detectada. Responda as perguntas abaixo.'
    Write-Host ''

    $pastaBase = Read-PastaBase
    $numeroAdmin = Read-NumeroAdmin
    $limiteDiario = Read-LimiteDiario

    Write-Host ''
    Write-Host 'Resumo da configuracao:'
    Write-Host "  Pasta base: $pastaBase"
    Write-Host "  Numero administrador: $numeroAdmin"
    Write-Host "  Limite diario por numero: $limiteDiario"
    Write-Host ''
    $confirmacao = Read-Host 'Confirma esses valores? (S/n)'
    if ($confirmacao -match '^[nN]') {
        Remove-Item -Path $envPath -Force
        Write-Host 'Instalacao cancelada. Rode o script novamente para reconfigurar.' -ForegroundColor Yellow
        exit 1
    }

    Set-EnvValor -Caminho $envPath -Chave 'PASTA_BASE' -Valor $pastaBase
    Set-EnvValor -Caminho $envPath -Chave 'NUMERO_ADMIN' -Valor $numeroAdmin
    Set-EnvValor -Caminho $envPath -Chave 'LIMITE_DIARIO_POR_NUMERO' -Valor $limiteDiario
} else {
    Write-Host '.env ja existe, pulando as perguntas de primeira instalacao.'
}
Write-Host ''

$envMap = Get-EnvMap $envPath
if ([string]::IsNullOrWhiteSpace($envMap['EVOLUTION_API_KEY'])) {
    Write-Host 'Gerando EVOLUTION_API_KEY...'
    Set-EnvValor -Caminho $envPath -Chave 'EVOLUTION_API_KEY' -Valor (New-TokenAleatorio)
}
if ([string]::IsNullOrWhiteSpace($envMap['POSTGRES_PASSWORD'])) {
    Write-Host 'Gerando POSTGRES_PASSWORD...'
    Set-EnvValor -Caminho $envPath -Chave 'POSTGRES_PASSWORD' -Valor (New-TokenAleatorio)
}

$envMap = Get-EnvMap $envPath
$evolutionApiUrl = $envMap['EVOLUTION_API_URL']
if ([string]::IsNullOrWhiteSpace($evolutionApiUrl)) { $evolutionApiUrl = 'http://localhost:8080' }
$evolutionApiKey = $envMap['EVOLUTION_API_KEY']
$nomeInstancia = $envMap['EVOLUTION_INSTANCE']
if ([string]::IsNullOrWhiteSpace($nomeInstancia)) { $nomeInstancia = 'Q-Zap' }

Write-Host ''
Write-Host 'Instalando dependencias (npm install)...'
Push-Location $raizProjeto
try {
    npm install
    if ($LASTEXITCODE -ne 0) { throw 'npm install falhou.' }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Criando estrutura de pastas em PASTA_BASE...'
Push-Location $raizProjeto
try {
    node scripts/bootstrap-pastas.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar a estrutura de pastas.' }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Subindo a Evolution API (docker compose up -d)...'
Invoke-DockerCompose -ComandoBase $comandoCompose -RaizProjeto $raizProjeto -Argumentos @('up', '-d')

Write-Host ''
Write-Host 'Aguardando a Evolution API ficar pronta...'
if (-not (Wait-EvolutionApiPronta -BaseUrl $evolutionApiUrl)) {
    throw 'A Evolution API nao respondeu a tempo. Verifique os containers Docker (docker ps) e tente novamente.'
}

Write-Host 'Verificando instancia do WhatsApp...'
if (-not (Test-InstanciaExiste -BaseUrl $evolutionApiUrl -ApiKey $evolutionApiKey -NomeInstancia $nomeInstancia)) {
    Write-Host "Criando instancia '$nomeInstancia' na Evolution API..."
    New-InstanciaEvolution -BaseUrl $evolutionApiUrl -ApiKey $evolutionApiKey -NomeInstancia $nomeInstancia
} else {
    Write-Host "Instancia '$nomeInstancia' ja existe."
}

$estadoAtual = Get-EstadoConexaoInstancia -BaseUrl $evolutionApiUrl -ApiKey $evolutionApiKey -NomeInstancia $nomeInstancia
if ($estadoAtual -eq 'open') {
    Write-Host 'WhatsApp ja esta pareado nesta instancia.'
    $pareado = $true
} else {
    $urlManager = "$evolutionApiUrl/manager"
    Write-Host ''
    Write-Host "Abra o manager para escanear o QR code: $urlManager"
    try { Start-Process $urlManager } catch { }
    Write-Host 'Aguardando o pareamento do WhatsApp (escaneie o QR code no navegador que foi aberto)...'
    $pareado = Wait-Pareamento -BaseUrl $evolutionApiUrl -ApiKey $evolutionApiKey -NomeInstancia $nomeInstancia
}

Write-Host ''
if ($pareado) {
    Write-Host 'WhatsApp pareado. Registrando o Q-Zap como servico do Windows...'
    Push-Location $raizProjeto
    try {
        node scripts/instalar-servico.mjs
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao registrar o servico do Windows.' }
    } finally {
        Pop-Location
    }
    Write-Host ''
    Write-Host '=== Instalacao concluida. O Q-Zap esta rodando como servico do Windows. ==='
} else {
    Write-Host 'Tempo limite esgotado esperando o pareamento do WhatsApp.' -ForegroundColor Yellow
    Write-Host 'O servico do Windows NAO foi registrado ainda.' -ForegroundColor Yellow
    Write-Host "Quando terminar de escanear o QR code em $urlManager, rode:" -ForegroundColor Yellow
    Write-Host '  npm run servico:instalar' -ForegroundColor Yellow
    exit 1
}
