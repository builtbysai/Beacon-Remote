[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $env:LOCALAPPDATA) { throw 'Interactive Windows user profile required' }
$destination = Join-Path $env:LOCALAPPDATA 'Programs\BeaconRemoteDevelopment'
if (Test-Path -LiteralPath $destination) { throw 'Development host already installed. Uninstall it before installing another build.' }
$manifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Raw | ConvertFrom-Json
$expected = @('beacon-remote-agent.exe', 'beacon-remote-session.exe', 'Host.ps1', 'Uninstall.ps1')
if ($manifest.kind -ne 'beacon-remote-development-v1' -or $manifest.files.Count -ne $expected.Count) { throw 'Invalid development package manifest' }
foreach ($name in $expected) {
    $entry = @($manifest.files | Where-Object { $_.name -ceq $name })
    if ($entry.Count -ne 1 -or $entry[0].sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw "Invalid package entry: $name" }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot $name)).Hash
    if ($actual -cne $entry[0].sha256) { throw "Package integrity check failed: $name" }
}
$links = Join-Path ([Environment]::GetFolderPath('Programs')) 'Beacon Remote Development'
if (Test-Path -LiteralPath $links) { throw 'Existing development shortcuts require review before installation' }
# No elevation, startup task, service, firewall change or security-policy override.
New-Item -ItemType Directory -Path $destination | Out-Null
foreach ($name in $expected) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $destination }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'manifest.json') -Destination $destination
New-Item -ItemType Directory -Path $links | Out-Null
$shell = New-Object -ComObject WScript.Shell
foreach ($action in @('Pair', 'Run', 'Uninstall')) {
    $shortcut = $shell.CreateShortcut((Join-Path $links "$action.lnk"))
    $shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $script = if ($action -eq 'Uninstall') { 'Uninstall.ps1' } else { 'Host.ps1' }
    $shortcut.Arguments = '-NoProfile -File "' + (Join-Path $destination $script) + '"'
    if ($action -ne 'Uninstall') { $shortcut.Arguments += " -Command $($action.ToLowerInvariant())" }
    $shortcut.WorkingDirectory = $destination
    $shortcut.Description = 'Beacon Remote unsigned internal development host'
    $shortcut.Save()
}
Write-Host "Installed unsigned development build $($manifest.commit) for this user."
Write-Host 'Use Start menu > Beacon Remote Development > Pair, then Run. Keep the visible Run console open.'
Write-Host 'No service, tray, automatic startup, updater or production control was installed.'
