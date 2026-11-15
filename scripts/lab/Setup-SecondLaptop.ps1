# Beacon Remote lab bootstrap. Public key only; no credentials are embedded.
# Run in Windows PowerShell as Administrator ON THE SECOND LAPTOP.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ipaddress]$ManagementIp,
    [Parameter(Mandatory)][string]$PublicKeyPath,
    [Parameter(Mandatory)][string]$DevelopmentComputerName
)
$ErrorActionPreference = 'Stop'
$publicKey = [IO.File]::ReadAllText([IO.Path]::GetFullPath($PublicKeyPath)).Trim()
if ($publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/=]+(?: .*)?$') { throw 'Supply one OpenSSH Ed25519 PUBLIC key, never a private key.' }
$labUserName = 'BeaconLab'

if ($env:COMPUTERNAME -eq $DevelopmentComputerName) {
    throw 'This is the development workstation. Run this script only on the second test laptop.'
}
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open Windows PowerShell using Run as administrator, then run this script again.'
}
if (-not [Environment]::Is64BitProcess) {
    throw 'Use 64-bit Windows PowerShell, not Windows PowerShell (x86).'
}
$tailscale = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
if (-not (Test-Path -LiteralPath $tailscale)) { throw 'Install Tailscale and sign into the same tailnet first.' }
$tailnet = (& $tailscale status --json) | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $tailnet.BackendState -ne 'Running') {
    throw 'Connect this laptop to Tailscale first.'
}
$labIp = @($tailnet.Self.TailscaleIPs | Where-Object { $_ -notlike '*:*' }) | Select-Object -First 1
if (-not $labIp -or $labIp -eq $managementIp) { throw 'Could not identify a distinct second-laptop Tailscale IPv4 address.' }
$labInterface = @(Get-NetIPAddress -AddressFamily IPv4 -IPAddress $labIp)[0].InterfaceAlias
if (-not $labInterface) { throw 'Could not identify the Tailscale network interface.' }

# Never interrupt an existing SSH installation in use. Inspect it separately.
$sshd = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($sshd -and $sshd.Status -eq 'Running') {
    throw 'OpenSSH is already running. Stop here and tell Codex; existing remote access needs inspection before changes.'
}
if (Get-NetTCPConnection -State Listen -LocalPort 22 -ErrorAction SilentlyContinue) {
    throw 'Port 22 is already occupied. Stop here and tell Codex.'
}

Write-Host 'Installing the Windows OpenSSH Server capability if needed...'
$sshCapability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
if ($sshCapability.State -ne 'Installed') {
    $installation = Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
    if ($installation.RestartNeeded) {
        throw 'Windows requests a restart to finish installing OpenSSH. Restart this test laptop, then rerun this script.'
    }
}
# The stock installer rule allows more sources. Replace it with the explicit lab rule
# before starting SSH. Other firewall rules are preserved for review after connection.
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Disable-NetFirewallRule | Out-Null
$labFirewallRule = Get-NetFirewallRule -Name 'BeaconRemoteLab-SSH' -ErrorAction SilentlyContinue
if ($labFirewallRule) {
    Set-NetFirewallRule -Name 'BeaconRemoteLab-SSH' -Enabled True -Direction Inbound -Action Allow -Profile Any -InterfaceAlias $labInterface | Out-Null
    $labFirewallRule | Get-NetFirewallAddressFilter | Set-NetFirewallAddressFilter -RemoteAddress $managementIp | Out-Null
    $labFirewallRule | Get-NetFirewallPortFilter | Set-NetFirewallPortFilter -Protocol TCP -LocalPort 22 | Out-Null
} else {
    New-NetFirewallRule -Name 'BeaconRemoteLab-SSH' -DisplayName 'Beacon Remote lab SSH from development workstation' -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -RemoteAddress $managementIp -InterfaceAlias $labInterface -Profile Any | Out-Null
}

$labUser = Get-LocalUser -Name $labUserName -ErrorAction SilentlyContinue
if (-not $labUser) {
    Write-Host 'Choose a password for the dedicated BeaconLab Windows test account. Keep it private; do not paste it into chat.'
    $labPassword = Read-Host 'BeaconLab password' -AsSecureString
    try {
        $labUser = New-LocalUser -Name $labUserName -Password $labPassword -Description 'Dedicated Beacon Remote acceptance test account'
    } finally {
        if ($labPassword) { $labPassword.Dispose() }
    }
} elseif (-not $labUser.Enabled) {
    throw 'BeaconLab already exists but is disabled. Its state was not changed.'
}
$administrators = Get-LocalGroup -SID 'S-1-5-32-544'
$alreadyAdmin = @(Get-LocalGroupMember -Group $administrators.Name | Where-Object { $_.SID.Value -eq $labUser.SID.Value }).Count -gt 0
if (-not $alreadyAdmin) { Add-LocalGroupMember -Group $administrators.Name -Member $labUser }

$sshDirectory = Join-Path $env:ProgramData 'ssh'
New-Item -ItemType Directory -Path $sshDirectory -Force | Out-Null
# Windows OpenSSH uses this file for administrator accounts. Preserve existing keys.
$authorizedKeys = Join-Path $sshDirectory 'administrators_authorized_keys'
if (-not (Test-Path -LiteralPath $authorizedKeys)) {
    [IO.File]::WriteAllText($authorizedKeys, $publicKey + [Environment]::NewLine, [Text.Encoding]::ASCII)
} elseif (-not (@(Get-Content -LiteralPath $authorizedKeys) -contains $publicKey)) {
    [IO.File]::AppendAllText($authorizedKeys, [Environment]::NewLine + $publicKey + [Environment]::NewLine, [Text.Encoding]::ASCII)
}
& icacls.exe $authorizedKeys /inheritance:r /grant:r '*S-1-5-32-544:F' '*S-1-5-18:F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not protect authorized_keys permissions.' }
$unexpected = @((Get-Acl -LiteralPath $authorizedKeys).Access | Where-Object {
    $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -notin @('S-1-5-32-544', 'S-1-5-18')
})
if ($unexpected.Count -gt 0) { throw 'Existing authorized_keys permissions need inspection. SSH has not been started.' }

# Pin the login account and source address as well as the firewall rule. Refuse
# custom authentication settings rather than overriding an existing SSH policy.
$sshdConfig = Join-Path $sshDirectory 'sshd_config'
if (-not (Test-Path -LiteralPath $sshdConfig)) {
    $defaultConfig = Join-Path $env:WINDIR 'System32\OpenSSH\sshd_config_default'
    if (-not (Test-Path -LiteralPath $defaultConfig)) { throw 'OpenSSH default configuration is missing. SSH has not been started.' }
    Copy-Item -LiteralPath $defaultConfig -Destination $sshdConfig
}
$originalConfig = [IO.File]::ReadAllText($sshdConfig)
if ($originalConfig -match '(?im)^\s*(AllowUsers|AllowGroups|DenyUsers|DenyGroups|PasswordAuthentication|PubkeyAuthentication|AuthenticationMethods|Include)\s+') {
    throw 'Existing custom SSH authentication settings need inspection. SSH has not been started.'
}
$backupConfig = $sshdConfig + '.before-beacon-lab-' + [guid]::NewGuid().ToString('N')
Copy-Item -LiteralPath $sshdConfig -Destination $backupConfig
$managedConfig = "# Beacon Remote lab: this workstation key only`r`nAllowUsers beaconlab@$managementIp`r`nAuthenticationMethods publickey`r`nPasswordAuthentication no`r`nPubkeyAuthentication yes`r`n" + $originalConfig
$sshdExecutable = Join-Path $env:WINDIR 'System32\OpenSSH\sshd.exe'
try {
    & (Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe') -A
    if ($LASTEXITCODE -ne 0) { throw 'Could not generate missing SSH host keys.' }
    [IO.File]::WriteAllText($sshdConfig, $managedConfig, [Text.Encoding]::ASCII)
    & $sshdExecutable -t -f $sshdConfig
    if ($LASTEXITCODE -ne 0) { throw 'SSH configuration validation failed.' }
} catch {
    Copy-Item -LiteralPath $backupConfig -Destination $sshdConfig -Force
    throw
}
Set-Service -Name sshd -StartupType Automatic
Start-Service -Name sshd
$hostPublicKey = Join-Path $sshDirectory 'ssh_host_ed25519_key.pub'
$sshKeygen = Join-Path $env:WINDIR 'System32\OpenSSH\ssh-keygen.exe'
$hostFingerprint = & $sshKeygen -lf $hostPublicKey
if ($LASTEXITCODE -ne 0) { throw 'Could not read the SSH host public-key fingerprint.' }
$windows = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
Write-Host ''
Write-Host 'SETUP READY. Copy the following public connection details back into the chat:'
[pscustomobject]@{
    Computer = $env:COMPUTERNAME
    TailscaleIPv4 = $labIp
    User = $labUserName.ToLowerInvariant()
    WindowsEdition = $windows.EditionID
    WindowsBuild = $windows.CurrentBuildNumber
    SSHService = (Get-Service sshd).Status.ToString()
    HostKeyFingerprint = $hostFingerprint
} | Format-List
Write-Host 'Keep the laptop powered and awake. Enable Tailscale Preferences > Run unattended if not already enabled.'
Write-Host 'No Beacon installation, reboot, sleep setting or existing account password was changed.'
