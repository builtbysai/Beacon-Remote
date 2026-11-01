# Dot-source this file in the development shell: . ./scripts/Enter-Workspace.ps1
[CmdletBinding()]
param([string]$PrivateRoot = $env:BEACON_PRIVATE_DIR)
$ErrorActionPreference = 'Stop'
if (-not $PrivateRoot) {
    $PrivateRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\Beacon-Private'))
}
if (-not (Test-Path -LiteralPath $PrivateRoot -PathType Container)) {
    throw 'Private workspace folder missing. Pass -PrivateRoot with its current location; never create replacement keys implicitly.'
}
$PrivateRoot = [IO.Path]::GetFullPath($PrivateRoot)
$env:BEACON_PRIVATE_DIR = $PrivateRoot
$env:REMOTE_DEV_STATE_DIR = Join-Path $PrivateRoot 'remote\development'
$env:REMOTE_ACCEPTANCE_STATE_DIR = Join-Path $PrivateRoot 'remote\recovery\android-acceptance-20261010'
Write-Host 'Development secret paths configured. No secret values were displayed.'
