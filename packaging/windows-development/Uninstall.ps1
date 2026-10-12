[CmdletBinding()]
param([switch]$ForgetIdentity)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$expectedRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs\BeaconRemoteDevelopment'))
if (-not [StringComparer]::OrdinalIgnoreCase.Equals([IO.Path]::GetFullPath($PSScriptRoot), $expectedRoot)) { throw 'Uninstaller must run from this user''s installed development directory' }
$manifest = Get-Content -LiteralPath (Join-Path $expectedRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.kind -ne 'beacon-remote-development-v1') { throw 'Installed package identity missing' }
foreach ($running in @(Get-Process -Name 'beacon-remote-agent', 'beacon-remote-session' -ErrorAction SilentlyContinue)) {
    $executable = $running.Path
    if (-not $executable) { throw 'Cannot verify a running Beacon endpoint location. Resolve this process before uninstalling.' }
    $prefix = $expectedRoot + [IO.Path]::DirectorySeparatorChar
    if ([IO.Path]::GetFullPath($executable).StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Stop this installed agent and its sessions before uninstalling. No running process will be killed.'
    }
}
if ($ForgetIdentity) {
    Write-Host 'Revoke this computer in Beacon Remote before forgetting its local identity.'
    & (Join-Path $expectedRoot 'beacon-remote-agent.exe') forget
    if ($LASTEXITCODE -ne 0) { throw 'Identity removal failed; installation was preserved' }
}
$links = Join-Path ([Environment]::GetFolderPath('Programs')) 'Beacon Remote Development'
$shell = New-Object -ComObject WScript.Shell
foreach ($action in @('Pair', 'Run', 'Uninstall')) {
    $path = Join-Path $links "$action.lnk"
    if (Test-Path -LiteralPath $path) {
        $shortcut = $shell.CreateShortcut($path)
        if ($shortcut.Arguments.Contains($expectedRoot)) { Remove-Item -LiteralPath $path }
    }
}
if ((Test-Path -LiteralPath $links) -and -not (Get-ChildItem -LiteralPath $links -Force)) { Remove-Item -LiteralPath $links }
# Remove only known package files. Preserve any unrecognized user files.
foreach ($name in @('beacon-remote-agent.exe', 'beacon-remote-session.exe', 'Host.ps1', 'Uninstall.ps1', 'manifest.json')) {
    $path = Join-Path $expectedRoot $name
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path }
}
if (-not (Get-ChildItem -LiteralPath $expectedRoot -Force)) { Remove-Item -LiteralPath $expectedRoot }
Write-Host 'Development host removed. Local pairing identity is retained unless -ForgetIdentity was explicitly used.'
