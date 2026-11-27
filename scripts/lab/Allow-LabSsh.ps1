# On the test laptop, ELEVATED: lets SSH (TCP 22) in from the development computer over the direct cable only.
# Two things, both limited to the cable: a firewall rule bound to its addresses and adapter, and a second sshd
# ListenAddress (sshd otherwise listens on the Tailscale address only). The laptop's SSH is also locked to the
# development computer's Tailscale address (a `Match ... Address` deny in sshd_config and `from=` on the key), so the
# development computer's cable address is added to both; no other address is allowed. Originals are backed up, the
# config is checked with `sshd -t` before sshd restarts, and if the check fails nothing is changed.
#   add:     Allow-LabSsh.ps1
#   remove:  Allow-LabSsh.ps1 -Remove
param([Parameter(Mandatory)][string]$DevTailscaleAddress, [string]$Adapter = 'Ethernet 3', [string]$LocalAddress = '10.77.0.2', [string]$RemoteAddress = '10.77.0.1', [switch]$Remove)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this elevated.' }
$name = 'BeaconLab-SSH-from-wired-link'
$config = Join-Path $env:ProgramData 'ssh\sshd_config'
$marker = '# beacon-lab-wired-link'
$text = [IO.File]::ReadAllText($config)
$lines = $text -split "`r?`n" | Where-Object { $_ -notmatch [regex]::Escape($marker) }
$matchOld = "Match User saiha Address *,!$DevTailscaleAddress"
$matchNew = "$matchOld,!$RemoteAddress"
$keysFile = Join-Path $env:ProgramData 'ssh\administrators_authorized_keys'
$fromOld = "from=`"$DevTailscaleAddress`""
$fromNew = "from=`"$DevTailscaleAddress,$RemoteAddress`""
$lines = $lines | ForEach-Object { if ($_.Trim() -eq $matchOld -or $_.Trim() -eq $matchNew) { if ($Remove) { $matchOld } else { $matchNew } } else { $_ } }
$keys = [IO.File]::ReadAllText($keysFile)
$newKeys = if ($Remove) { $keys.Replace($fromNew, $fromOld) } else { $keys.Replace($fromOld, $fromNew) }
if ($newKeys -ne $keys) {
    Copy-Item -LiteralPath $keysFile -Destination "$keysFile.before-lab-link" -Force
    [IO.File]::WriteAllText($keysFile, $newKeys)
}
Get-NetFirewallRule -Name $name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
if (-not $Remove) {
    New-NetFirewallRule -Name $name -DisplayName 'Beacon lab: SSH from the development computer over the direct cable' `
        -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $LocalAddress -RemoteAddress $RemoteAddress `
        -InterfaceAlias $Adapter -Profile Any | Out-Null
    # The new ListenAddress goes right after the existing one.
    $index = [array]::FindIndex($lines, [Predicate[string]]{ param($l) $l -match '^\s*ListenAddress\s' })
    if ($index -lt 0) { throw 'No ListenAddress line found; not changing sshd.' }
    $lines = $lines[0..$index] + "ListenAddress $LocalAddress $marker" + $lines[($index + 1)..($lines.Count - 1)]
}
if (($lines -join "`r`n") -ne ($text -replace "`r?`n", "`r`n")) {
    Copy-Item -LiteralPath $config -Destination "$config.before-lab-link" -Force
    $candidate = "$config.candidate"
    [IO.File]::WriteAllText($candidate, ($lines -join "`r`n"))
    & "$env:SystemRoot\System32\OpenSSH\sshd.exe" -t -f $candidate
    if ($LASTEXITCODE -ne 0) { Remove-Item $candidate; throw 'sshd rejected the new configuration; nothing was changed.' }
    Move-Item -LiteralPath $candidate -Destination $config -Force
    Restart-Service sshd
}
if ($Remove) { 'removed the rule and the ListenAddress' } else { "allowed $RemoteAddress -> ${LocalAddress}:22 on $Adapter; sshd also listens on $LocalAddress" }
