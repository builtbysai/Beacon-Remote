<#
.SYNOPSIS
  Trust Beacon Remote's signing certificate on this computer, once, so Windows recognises Beacon Remote programs
  as coming from Beacon Remote. Also removes or revokes that trust.

.DESCRIPTION
  Beacon Remote is signed with its own free certificate, not one from a public authority, so Windows trusts it only
  on computers that have been told to. This script tells this computer to. It needs administrator approval once.

  Check the fingerprint first. The SHA-256 below must match the one on the Beacon Remote Downloads page and the one
  the installer shows; pass it as -Fingerprint to have the script refuse anything else.

    Certificate SHA-256 : @@CERT_SHA256@@
    Valid until         : @@NOT_AFTER@@

  Usage (PowerShell; right-click Start, Terminal):
    .\Trust-BeaconRemote.ps1                       trust it (asks for administrator approval)
    .\Trust-BeaconRemote.ps1 -Status               show whether this computer already trusts it
    .\Trust-BeaconRemote.ps1 -Remove               take the trust away again
    .\Trust-BeaconRemote.ps1 -Revoke               remove it and block it permanently (key lost or stolen)
    .\Trust-BeaconRemote.ps1 -Fingerprint <hex>    refuse unless the certificate matches this SHA-256

  Computers that already trust it are skipped: running it again changes nothing.

  Group Policy (many computers), either way:
    1. Computer Configuration > Policies > Windows Settings > Security Settings > Public Key Policies: import
       beacon-remote-signing.cer into both "Trusted Root Certification Authorities" and "Trusted Publishers".
    2. Or add this script as a Computer Configuration > Windows Settings > Scripts > Startup > PowerShell script
       with the parameter -Quiet. It runs as SYSTEM, needs no prompt and skips computers already configured.
  Remove it the same way you added it, or run it with -Remove -Quiet.

  This script only adds the one certificate below to Trusted Root and Trusted Publishers on this computer. It
  changes nothing else and does not turn off any Windows protection.
#>
[CmdletBinding(DefaultParameterSetName = 'Trust')]
param(
    [Parameter(ParameterSetName = 'Status')][switch]$Status,
    [Parameter(ParameterSetName = 'Remove')][switch]$Remove,
    [Parameter(ParameterSetName = 'Revoke')][switch]$Revoke,
    [string]$Fingerprint,
    [switch]$Quiet
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$expected = '@@CERT_SHA256@@'
$certificate = [Convert]::FromBase64String('@@CERT_BASE64@@')
# Certificates withdrawn after a key problem: removed from the trusted stores and blocked.
$revokedList = @(
    @@REVOKED@@
)

function Get-Sha256([byte[]]$bytes) {
    ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-', '')
}
function Say([string]$text) { if (-not $Quiet) { Write-Host $text } }

if ((Get-Sha256 $certificate) -ne $expected) { throw 'This script is damaged: its certificate does not match its fingerprint. Download it again.' }
if ($Fingerprint) {
    $wanted = ($Fingerprint -replace '[^0-9A-Fa-f]', '').ToUpperInvariant()
    if ($wanted -ne $expected) { throw "Refusing: this certificate's SHA-256 is $expected, not $wanted." }
}
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (, $certificate)

function Open-Store([string]$name, [bool]$write) {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store -ArgumentList $name, 'LocalMachine'
    $store.Open($(if ($write) { 'ReadWrite' } else { 'ReadOnly' }))
    $store
}
function Test-InStore([string]$name, [System.Security.Cryptography.X509Certificates.X509Certificate2]$candidate) {
    $store = Open-Store $name $false
    try { $store.Certificates.Find('FindByThumbprint', $candidate.Thumbprint, $false).Count -gt 0 } finally { $store.Close() }
}
function Test-Trusted { (Test-InStore 'Root' $cert) -and (Test-InStore 'TrustedPublisher' $cert) }
function Test-Admin {
    ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
function Add-To([string]$name, $item) {
    $store = Open-Store $name $true
    try { $store.Add($item) } finally { $store.Close() }
}
function Remove-From([string]$name, $item) {
    $store = Open-Store $name $true
    try { foreach ($found in $store.Certificates.Find('FindByThumbprint', $item.Thumbprint, $false)) { $store.Remove($found) } } finally { $store.Close() }
}
function Test-RevocationsApplied {
    foreach ($entry in $revokedList) {
        $old = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (, ([Convert]::FromBase64String($entry.Base64)))
        if (-not (Test-InStore 'Disallowed' $old) -or (Test-InStore 'Root' $old) -or (Test-InStore 'TrustedPublisher' $old)) { return $false }
    }
    $true
}
function Apply-Revocations {
    foreach ($entry in $revokedList) {
        $bytes = [Convert]::FromBase64String($entry.Base64)
        if ((Get-Sha256 $bytes) -ne $entry.Sha256) { continue }
        $old = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList (, $bytes)
        Remove-From 'Root' $old
        Remove-From 'TrustedPublisher' $old
        if (-not (Test-InStore 'Disallowed' $old)) { Add-To 'Disallowed' $old }
    }
}
function Restart-Elevated([string]$extra) {
    $arguments = "-NoProfile -File `"$PSCommandPath`" $extra"
    if ($Fingerprint) { $arguments += " -Fingerprint $Fingerprint" }
    $process = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $arguments -Verb RunAs -Wait -PassThru
    exit $process.ExitCode
}

$line = "Beacon Remote signing certificate`n  SHA-256     $expected`n  Valid until @@NOT_AFTER@@"
if ($Status) {
    $trusted = Test-Trusted
    Say "$line`n  Trusted on this computer: $trusted"
    exit $(if ($trusted) { 0 } else { 1 })
}
if ($Remove -or $Revoke) {
    if (-not (Test-Admin)) {
        if ($Quiet) { [Console]::Error.WriteLine('Administrator rights are required.'); exit 5 }
        Restart-Elevated $(if ($Revoke) { '-Revoke' } else { '-Remove' })
    }
    Remove-From 'Root' $cert
    Remove-From 'TrustedPublisher' $cert
    if ($Revoke -and -not (Test-InStore 'Disallowed' $cert)) { Add-To 'Disallowed' $cert }
    Say $(if ($Revoke) { 'Removed and blocked. Windows will no longer trust this certificate on this computer.' } else { 'Removed. Windows no longer trusts this certificate on this computer.' })
    exit 0
}
if ((Test-Trusted) -and (Test-RevocationsApplied)) { Say "$line`n  Already trusted on this computer. Nothing to do."; exit 0 }
if (-not (Test-Admin)) {
    if ($Quiet) { [Console]::Error.WriteLine('Administrator rights are required.'); exit 5 }
    Say "$line`n`nThis needs administrator approval once. Check that the SHA-256 above matches the Beacon Remote Downloads page."
    Restart-Elevated ''
}
if (-not $Quiet) {
    Write-Host "$line`n"
    $answer = Read-Host 'Trust this certificate for Beacon Remote programs on this computer? Type YES to continue'
    if ($answer -ne 'YES') { Write-Host 'Cancelled. Nothing was changed.'; exit 2 }
}
if (-not (Test-InStore 'Root' $cert)) { Add-To 'Root' $cert }
if (-not (Test-InStore 'TrustedPublisher' $cert)) { Add-To 'TrustedPublisher' $cert }
Apply-Revocations
Say 'Done. This computer now trusts Beacon Remote programs signed with this certificate.'
if (-not $Quiet -and $Host.Name -eq 'ConsoleHost' -and [Environment]::UserInteractive) { Start-Sleep -Seconds 2 }
exit 0
