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
Write-Host 'Development secret paths configured. No secret values were displayed.'
