[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $commit = (& git rev-parse HEAD).Trim()
    if ($LASTEXITCODE -ne 0 -or $commit -notmatch '^[a-f0-9]{40}$') { throw 'Git build identity unavailable' }
    $nativeChanges = & git status --porcelain -- apps/windows-agent apps/windows-session crates Cargo.toml Cargo.lock
    if ($nativeChanges) { throw 'Commit and validate native changes before packaging exact-commit binaries' }
    $output = Join-Path $root "dist\BeaconRemoteDevelopment-$($commit.Substring(0, 8))"
    if (Test-Path -LiteralPath $output) { throw "Output exists; preserve/review it before rebuilding: $output" }
    # Build both endpoint binaries from this exact native source before copying.
    & (Join-Path $PSScriptRoot 'Test-RemoteCi.ps1') -NativeOnly
    $names = @('beacon-remote-agent.exe', 'beacon-remote-session.exe')
    foreach ($name in $names) {
        if (-not (Test-Path -LiteralPath (Join-Path $root "target\release\$name"))) { throw 'Run scripts/Test-RemoteCi.ps1 -NativeOnly before packaging' }
    }
    New-Item -ItemType Directory -Path $output | Out-Null
    foreach ($name in $names) { Copy-Item -LiteralPath (Join-Path $root "target\release\$name") -Destination $output }
    foreach ($name in @('Host.ps1', 'Install.ps1', 'Uninstall.ps1', 'README.txt')) { Copy-Item -LiteralPath (Join-Path $root "packaging\windows-development\$name") -Destination $output }
    $files = foreach ($name in @('beacon-remote-agent.exe', 'beacon-remote-session.exe', 'Host.ps1', 'Uninstall.ps1')) {
        @{ name = $name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output $name)).Hash }
    }
    @{kind = 'beacon-remote-development-v1'; commit = $commit; files = @($files)} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding UTF8
    Compress-Archive -Path (Join-Path $output '*') -DestinationPath "$output.zip"
    Get-FileHash -Algorithm SHA256 -LiteralPath "$output.zip" | Format-List
    Write-Host "Unsigned internal development package: $output.zip"
} finally { Pop-Location }
