#Requires -Version 5.1
#Requires -RunAsAdministrator

# Desinstalador de um comando so do Q-Zap (Etapa 11 / RNF09).
# Remove o servico Windows e os containers Docker com volumes (sessao do WhatsApp
# e dados do Postgres da Evolution API). Nunca apaga PASTA_BASE (dados de clientes).

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

# ----- Fluxo principal -----

$raizProjeto = Split-Path -Parent $MyInvocation.MyCommand.Path
$envPath = Join-Path $raizProjeto '.env'

Write-Host '=== Desinstalador do Q-Zap ==='
Write-Host ''

if (-not (Test-Comando 'node')) {
    Write-Host 'Node.js nao encontrado. Nao e possivel remover o servico do Windows sem ele.' -ForegroundColor Red
    exit 1
}
if (-not (Test-Comando 'docker')) {
    Write-Host 'Docker nao encontrado. Nao e possivel derrubar os containers sem ele.' -ForegroundColor Red
    exit 1
}
$comandoCompose = Resolve-ComandoCompose
if (-not $comandoCompose) {
    Write-Host 'Docker Compose nao encontrado (nem "docker compose" nem "docker-compose").' -ForegroundColor Red
    exit 1
}

$envMap = Get-EnvMap $envPath
$pastaBase = $envMap['PASTA_BASE']

Write-Host 'Removendo o servico do Windows...'
Push-Location $raizProjeto
try {
    node scripts/desinstalar-servico.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao remover o servico do Windows.' }
} finally {
    Pop-Location
}

Write-Host ''
Write-Host 'Derrubando os containers Docker e removendo volumes (sessao do WhatsApp e dados do Postgres)...'
Invoke-DockerCompose -ComandoBase $comandoCompose -RaizProjeto $raizProjeto -Argumentos @('down', '-v')

Write-Host ''
Write-Host '=== Desinstalacao concluida. ==='
Write-Host 'O servico do Windows e os containers/volumes da Evolution API foram removidos.'
Write-Host 'Uma reinstalacao vai exigir um novo pareamento do WhatsApp por QR code.'
Write-Host ''
if (-not [string]::IsNullOrWhiteSpace($pastaBase)) {
    Write-Host "Os documentos e logs em PASTA_BASE NAO foram apagados: $pastaBase"
} else {
    Write-Host 'Nao foi possivel ler PASTA_BASE do .env (arquivo ausente ou variavel nao definida) -- de qualquer forma, nenhum dado de PASTA_BASE foi tocado.'
}
