# Dot-source this file in the development shell: . ./scripts/Enter-Workspace.ps1
[CmdletBinding()]
param([string]$PrivateRoot = $env:BEACON_PRIVATE_DIR)
$ErrorActionPreference = 'Stop'
if (-not $PrivateRoot) {
    $PrivateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\Beacon-Secrets'))
}
if (-not (Test-Path -LiteralPath $PrivateRoot -PathType Container)) {
    throw 'Private workspace folder missing. Pass -PrivateRoot with its current location; never create replacement keys implicitly.'
}
$PrivateRoot = [IO.Path]::GetFullPath($PrivateRoot)
$env:BEACON_PRIVATE_DIR = $PrivateRoot
$env:REMOTE_DEV_STATE_DIR = Join-Path $PrivateRoot 'remote\local\state'
$env:REMOTE_LOCAL_ACCOUNTS_DIR = Join-Path $PrivateRoot 'remote\local\accounts'
$env:REMOTE_PRODUCTION_LOGIN_FILE = Join-Path $PrivateRoot 'remote\production\accounts\test.json'
$env:REMOTE_ACCEPTANCE_STATE_DIR = Join-Path $PrivateRoot 'remote\acceptance\android'
$env:REMOTE_DEV_DATABASE_FILE = Join-Path $PrivateRoot 'remote\local\database.json'
if (Test-Path -LiteralPath $env:REMOTE_DEV_DATABASE_FILE -PathType Leaf) {
    try {
        $database = Get-Content -LiteralPath $env:REMOTE_DEV_DATABASE_FILE -Raw | ConvertFrom-Json
    } catch {
        throw 'Cannot read the selected private local database file.'
    }
    if (@($database.PSObject.Properties).Count -ne 1 -or -not ($database.password -is [string]) -or -not $database.password) {
        throw 'Private local database configuration must contain only a nonempty password.'
    }
    $env:REMOTE_DEV_POSTGRES_PASSWORD = $database.password
    $env:DATABASE_URL = 'postgresql://remote_dev:' + [uri]::EscapeDataString($database.password) + '@127.0.0.1:5433/beacon_remote_dev'
    $env:TEST_DATABASE_URL = 'postgresql://remote_dev:' + [uri]::EscapeDataString($database.password) + '@127.0.0.1:5433/beacon_remote_test'
}
Write-Host 'Development secret paths configured. No secret values were displayed.'
