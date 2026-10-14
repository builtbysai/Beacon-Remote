[CmdletBinding()]
param(
    # Fail instead of producing unsigned output when no signing certificate is available.
    [switch]$RequireSigning
)
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
    $names = @('beacon-remote-agent.exe', 'beacon-remote-host.exe', 'beacon-remote-session.exe')
    foreach ($name in $names) {
        if (-not (Test-Path -LiteralPath (Join-Path $root "target\release\$name"))) { throw 'Run scripts/Test-RemoteCi.ps1 -NativeOnly before packaging' }
    }
    New-Item -ItemType Directory -Path $output | Out-Null
    foreach ($name in $names) { Copy-Item -LiteralPath (Join-Path $root "target\release\$name") -Destination $output }
    foreach ($name in @('Install.ps1', 'Uninstall.ps1', 'README.txt')) { Copy-Item -LiteralPath (Join-Path $root "packaging\windows-development\$name") -Destination $output }
    # Sign with Beacon Remote's own certificate (ADR 0035) before anything is hashed, so the update feed's SHA-256
    # and the installer carry the signed files. The key comes from the secrets folder or BEACON_SIGNING_PFX.
    $signingScript = Join-Path $PSScriptRoot 'Beacon-Signing.ps1'
    $signed = [bool]$env:BEACON_SIGNING_PFX -or (Test-Path -LiteralPath (Join-Path $env:USERPROFILE '.beacon\secrets\remote-codesign\beacon-remote-codesign.pfx'))
    if (-not $signed -and $RequireSigning) { throw 'No signing certificate (run scripts\Beacon-Signing.ps1 -Action New)' }
    $trust = "$output-trust"
    if ($signed) {
        $toSign = @($names + @('Install.ps1', 'Uninstall.ps1')) | ForEach-Object { Join-Path $output $_ }
        & $signingScript -Action Sign -Path $toSign
        & $signingScript -Action Package -Output $trust
        $env:BEACON_TRUST_DIR = $trust
    }
    $files = foreach ($name in @('beacon-remote-agent.exe', 'beacon-remote-host.exe', 'beacon-remote-session.exe', 'Uninstall.ps1')) {
        @{ name = $name; sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $output $name)).Hash }
    }
    @{kind = 'beacon-remote-development-v2'; commit = $commit; files = @($files)} | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding UTF8
    Compress-Archive -Path (Join-Path $output '*') -DestinationPath "$output.zip"
    Get-FileHash -Algorithm SHA256 -LiteralPath "$output.zip" | Format-List
    # The double-click installer carries the same three programs and manifest. The zip stays the update payload.
    $env:BEACON_PAYLOAD_DIR = $output
    try { & cargo build --release -p beacon-remote-setup; if ($LASTEXITCODE -ne 0) { throw 'Installer build failed' } } finally { Remove-Item Env:BEACON_PAYLOAD_DIR -ErrorAction SilentlyContinue; Remove-Item Env:BEACON_TRUST_DIR -ErrorAction SilentlyContinue }
    $setup = Join-Path $root "dist\BeaconRemoteSetup-$($commit.Substring(0, 8)).exe"
    Copy-Item -LiteralPath (Join-Path $root 'target\release\beacon-remote-setup.exe') -Destination $setup
    if ($signed) { & $signingScript -Action Sign -Path $setup }
    Get-FileHash -Algorithm SHA256 -LiteralPath $setup | Format-List
    if ($signed) {
        Write-Host "Signed installer: $setup (Beacon Remote's own certificate; trust files in $trust)"
    } else {
        Write-Host "Unsigned installer: $setup (create a certificate with scripts\Beacon-Signing.ps1 -Action New)"
    }
    Write-Host "Internal development package: $output.zip"
} finally { Pop-Location }
