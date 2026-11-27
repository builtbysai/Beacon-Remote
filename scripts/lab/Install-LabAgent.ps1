# Installs (or removes) the Beacon lab helper for the signed-in user on the test laptop. No administrator rights and no
# network port: a per-user logon task starts lab-agent.ps1 in the user's own session.
#   Install:  powershell -NoProfile -File Install-LabAgent.ps1
#   Remove:   powershell -NoProfile -File Install-LabAgent.ps1 -Remove
param([switch]$Remove, [string]$Root = (Join-Path $env:USERPROFILE 'BeaconLab'))
$ErrorActionPreference = 'Stop'
$task = 'BeaconLabAgent'
$agent = Join-Path $Root 'lab-agent.ps1'
if ($Remove) {
    New-Item -ItemType File -Force -Path (Join-Path $Root 'STOP') | Out-Null
    Start-Sleep -Seconds 2
    schtasks.exe /Delete /TN $task /F 2>$null | Out-Null
    schtasks.exe /Delete /TN "$task-watch" /F 2>$null | Out-Null
    $items = Get-ChildItem -LiteralPath $Root -Recurse -Force -ErrorAction SilentlyContinue
    if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'A link is inside the helper folder; not deleting it.' }
    Remove-Item -LiteralPath $Root -Recurse -Force
    'removed'
    return
}
if (-not (Test-Path -LiteralPath $agent)) { throw "Copy lab-agent.ps1 to $Root first." }
$action = "powershell.exe -NoProfile -WindowStyle Hidden -File `"$agent`""
schtasks.exe /Create /TN $task /SC ONLOGON /IT /RL LIMITED /RU "$env:USERDOMAIN\$env:USERNAME" /TR $action /F | Out-String
# A second task restarts it if it ever stops (a second copy exits at once, the helper holds a mutex).
schtasks.exe /Create /TN "$task-watch" /SC MINUTE /MO 10 /IT /RL LIMITED /RU "$env:USERDOMAIN\$env:USERNAME" /TR $action /F | Out-String
schtasks.exe /Run /TN $task | Out-String
