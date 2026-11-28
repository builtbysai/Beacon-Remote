# Lab only, in BeaconTest's own session: install the newest build, pair it and turn on trusted access with control,
# using the product's own installer and agent commands. Records only outcomes.
param([string]$Code, [string]$Server = 'http://127.0.0.1:3012', [string]$Name = 'SURFIENA-TEST')
$lab = 'C:\Users\BeaconTest\BeaconLab'
$log = Join-Path $lab 'user-setup.txt'
$agent = Join-Path $env:LOCALAPPDATA 'Programs\Beacon Remote\beacon-remote-agent.exe'
"started $(Get-Date -Format o)" | Set-Content $log
Get-Process beacon-remote-host -ErrorAction SilentlyContinue | Where-Object SessionId -eq (Get-Process -Id $PID).SessionId | Stop-Process -Force
$setup = Start-Process (Join-Path $lab 'BeaconRemoteSetup.exe') -ArgumentList '--silent' -PassThru -Wait
"install exit $($setup.ExitCode)" | Add-Content $log
if (-not (Test-Path $agent)) { 'agent missing after install' | Add-Content $log; return }
$pair = ($Server, $Name, $Code) | & $agent pair 2>&1 | Out-String
"pair exit $LASTEXITCODE $pair" | Add-Content $log
$access = & $agent access trusted --control 2>&1 | Out-String
"access exit $LASTEXITCODE $access" | Add-Content $log
Start-Process (Join-Path $env:LOCALAPPDATA 'Programs\Beacon Remote\beacon-remote-host.exe') -ArgumentList '--background'
"finished $(Get-Date -Format o)" | Add-Content $log
