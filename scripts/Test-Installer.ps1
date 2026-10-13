# Installs and uninstalls the Windows setup program in a throwaway profile and checks each step.
# Needs `cargo build --release` first (the three programs). Touches no real install: LOCALAPPDATA and APPDATA point
# into a temp folder and registry writes go under HKCU\Software\BeaconRemoteSetupTest.
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$temp = Join-Path ([IO.Path]::GetTempPath()) ("beacon-setup-test-" + [guid]::NewGuid().ToString('N'))
$payload = Join-Path $temp 'payload'
$profileRoot = Join-Path $temp 'profile'
$key = 'HKCU:\Software\BeaconRemoteSetupTest'
function Check($condition, $message) { if (-not $condition) { throw "FAIL $message" }; Write-Host "PASS $message" }
try {
    New-Item -ItemType Directory -Force $payload, "$profileRoot\Local\BeaconRemote\updates", "$profileRoot\Roaming" | Out-Null
    foreach ($name in 'beacon-remote-agent.exe', 'beacon-remote-host.exe', 'beacon-remote-session.exe') {
        $source = Join-Path $repo "target\release\$name"
        if (-not (Test-Path $source)) { throw "Build $name first: cargo build --release" }
        Copy-Item $source $payload
    }
    '{"kind":"beacon-remote-development-v2","commit":"0123456789abcdef0123456789abcdef01234567","files":[]}' | Set-Content "$payload\manifest.json"
    Push-Location $repo
    try {
        $env:BEACON_PAYLOAD_DIR = $payload
        cargo build --release -p beacon-remote-setup
        if ($LASTEXITCODE -ne 0) { throw 'setup build failed' }
    } finally { Remove-Item Env:BEACON_PAYLOAD_DIR -ErrorAction SilentlyContinue; Pop-Location }
    $setup = Join-Path $repo 'target\release\beacon-remote-setup.exe'
    $env:LOCALAPPDATA = "$profileRoot\Local"
    $env:APPDATA = "$profileRoot\Roaming"
    $env:BEACON_SETUP_SANDBOX = '1'
    if (Test-Path $key) { Remove-Item -Recurse $key }
    Set-Content "$profileRoot\Local\BeaconRemote\identity.bin" 'saved sign-in'
    $install = "$profileRoot\Local\Programs\Beacon Remote"
    $link = "$profileRoot\Roaming\Microsoft\Windows\Start Menu\Programs\Beacon Remote.lnk"

    Start-Process $setup -ArgumentList '--silent' -Wait
    foreach ($name in 'beacon-remote-agent.exe', 'beacon-remote-host.exe', 'beacon-remote-session.exe', 'manifest.json', 'Uninstall Beacon Remote.exe') {
        Check (Test-Path "$install\$name") "installed $name"
    }
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($link).TargetPath
    Check ($target -eq "$install\beacon-remote-host.exe") 'Start menu shortcut opens the host'
    $entry = Get-ItemProperty "$key\Uninstall"
    Check ($entry.DisplayName -eq 'Beacon Remote' -and $entry.DisplayVersion -eq '0.1.0 (01234567)') 'Apps and features entry with version'
    Check ((Get-ItemProperty "$key\Run").BeaconRemoteHost -eq "`"$install\beacon-remote-host.exe`" --background") 'start at sign-in is on by default'

    Start-Process $setup -ArgumentList '--silent' -Wait
    Check (Test-Path "$install\beacon-remote-host.exe") 'installing again over an install works'

    Set-Content "$install\keep.txt" 'not ours'
    Start-Process "$install\Uninstall Beacon Remote.exe" -ArgumentList '--uninstall', '--silent' -Wait
    Start-Sleep 5
    Check (-not (Test-Path "$profileRoot\Local\BeaconRemote")) 'uninstall removes the saved sign-in'
    Check (-not (Test-Path $link)) 'uninstall removes the shortcut'
    Check (-not (Test-Path "$key\Uninstall")) 'uninstall removes the Apps and features entry'
    $run = Get-ItemProperty "$key\Run" -ErrorAction SilentlyContinue
    Check (-not $run -or -not $run.PSObject.Properties['BeaconRemoteHost']) 'uninstall removes start at sign-in'
    Check (-not (Test-Path "$install\beacon-remote-host.exe")) 'uninstall removes the programs'
    Check (Test-Path "$install\keep.txt") 'uninstall leaves files it did not create'
    Write-Host 'Installer check passed.'
} finally {
    if (Test-Path $key) { Remove-Item -Recurse $key -ErrorAction SilentlyContinue }
    if (Test-Path $temp) { Remove-Item -Recurse -Force $temp -ErrorAction SilentlyContinue }
}
