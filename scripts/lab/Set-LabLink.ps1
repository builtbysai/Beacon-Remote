# Gives the direct Ethernet cable between the two lab computers a fixed private address, so Tailscale and SSH can use
# the 1 ms wired path instead of the relay. Run ELEVATED on each computer (a UAC prompt appears):
#   this computer:   Set-LabLink.ps1 -Address 10.77.0.1
#   the test laptop: Set-LabLink.ps1 -Address 10.77.0.2
#   undo either:     Set-LabLink.ps1 -Remove
# Changes only the one adapter named (or found as the only wired adapter that is up), adds no gateway or DNS, and
# leaves every other network setting alone.
param(
    [string]$Address,
    [string]$Adapter,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this elevated.' }
if (-not $Adapter) {
    # The cable's adapter: wired, up, not virtual, not Wi-Fi, not Tailscale.
    $wired = @(Get-NetAdapter -Physical | Where-Object { $_.Status -eq 'Up' -and $_.InterfaceDescription -notmatch 'Wi-?Fi|Wireless|Bluetooth|Virtual|Tailscale' -and $_.PhysicalMediaType -match '802\.3' })
    if ($wired.Count -ne 1) { throw "Expected one wired adapter that is up, found $($wired.Count). Pass -Adapter <name>." }
    $Adapter = $wired[0].Name
}
$nic = Get-NetAdapter -Name $Adapter
if ($Remove) {
    Get-NetIPAddress -InterfaceAlias $Adapter -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -like '10.77.0.*' } | Remove-NetIPAddress -Confirm:$false
    Set-NetIPInterface -InterfaceAlias $Adapter -Dhcp Enabled
    "removed from $Adapter"
    return
}
if ($Address -notmatch '^10\.77\.0\.(1|2)$') { throw 'Use 10.77.0.1 or 10.77.0.2.' }
Get-NetIPAddress -InterfaceAlias $Adapter -AddressFamily IPv4 -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false
Set-NetIPInterface -InterfaceAlias $Adapter -Dhcp Disabled
New-NetIPAddress -InterfaceAlias $Adapter -IPAddress $Address -PrefixLength 24 | Out-Null
# Never let this link become the route to the internet or the preferred resolver.
Set-NetIPInterface -InterfaceAlias $Adapter -InterfaceMetric 500 -AutomaticMetric Disabled
"$Adapter ($($nic.InterfaceDescription)) is now $Address/24"
