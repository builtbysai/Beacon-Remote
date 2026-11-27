# On the test laptop, ELEVATED: keeps the lab build of the Beacon session helper's media (WebRTC UDP) on the direct
# cable. Without this the browser can nominate the Wi-Fi or the Tailscale relay (30-40 ms, throttled) over the cable
# (1-4 ms) and video never decodes. The rule drops that one program's INBOUND UDP from every address except the cable's
# 10.77.0.x (and loopback), so the browser's connectivity checks only ever succeed on the cable. It is inbound on
# purpose: a blocked outbound send fails with an access error inside the media stack and stops the stream.
#   add:     Limit-LabMediaToCable.ps1
#   remove:  Limit-LabMediaToCable.ps1 -Remove
param([switch]$Remove, [string]$Program = (Join-Path $env:USERPROFILE 'BeaconLab\builds\lab\beacon-remote-session.exe'))
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this elevated.' }
foreach ($old in 'BeaconLab-block-tailscale-ice', 'BeaconLab-media-cable-only', 'BeaconLab-media-cable-only-in') { Get-NetFirewallRule -Name $old -ErrorAction SilentlyContinue | Remove-NetFirewallRule }
if ($Remove) { 'removed'; return }
New-NetFirewallRule -Name 'BeaconLab-media-cable-only-in' -DisplayName 'Beacon lab: media only over the direct cable' -Direction Inbound -Action Block `
    -Program $Program -Protocol UDP -RemoteAddress '0.0.0.0-10.76.255.255', '10.77.1.0-126.255.255.255', '128.0.0.0-255.255.255.255' -Profile Any | Out-Null
"dropped inbound UDP to $Program from everything but the cable (10.77.0.0/24)"
