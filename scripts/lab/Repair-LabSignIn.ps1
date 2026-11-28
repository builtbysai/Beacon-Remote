# Lab only, over the elevated SSH session: brings the installed sign-in and boot services up to the app build that is
# installed for the given profile, with the product's own repair command (the same one the Repair button runs after
# its UAC). Repairs only the installations whose owner is that profile's Windows account.
param([string]$Profile = 'saiha')
$ErrorActionPreference = 'Stop'
$agent = "C:\Users\$Profile\AppData\Local\Programs\Beacon Remote\beacon-remote-agent.exe"
$sid = (New-Object Security.Principal.NTAccount("$env:COMPUTERNAME\$Profile")).Translate([Security.Principal.SecurityIdentifier]).Value
"agent signature: $((Get-AuthenticodeSignature $agent).Status)  modified $((Get-Item $agent).LastWriteTime)"
foreach ($dir in Get-ChildItem 'C:\Program Files\Beacon Remote Sign-in' -Directory) {
    $binding = Get-Content (Join-Path $dir.FullName 'public.json') -Raw | ConvertFrom-Json
    if ($binding.owner_sid -ne $sid) { continue }
    $text = & $agent unattended-repair $dir.Name $binding.server $binding.owner_sid 2>&1 | Out-String
    "repair $($dir.Name): exit $LASTEXITCODE $text"
}
Start-Sleep -Seconds 3
Get-Process beacon-remote-agent | Format-Table Id, StartTime, Path -AutoSize | Out-String -Width 250
