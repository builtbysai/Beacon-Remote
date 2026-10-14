<#
.SYNOPSIS
  Beacon Remote's own Authenticode certificate: create, renew, revoke, sign with it, and package trust files.

.DESCRIPTION
  The certificate is self-signed and free. Windows only treats it as trusted on computers where it has been
  trusted on purpose (the installer offers that once; Trust-BeaconRemote.ps1 does it on other computers), so
  this is for the owner's own devices, not a replacement for a public certificate authority (ADR 0035).

  The private key lives only in a password-protected .pfx under the secrets folder (default
  $env:USERPROFILE\.beacon\secrets\remote-codesign, readable by this Windows user only). It is never stored
  in a certificate store after creation and is never committed. CI can supply it with BEACON_SIGNING_PFX
  (base64 of the .pfx) and BEACON_SIGNING_PFX_PASSWORD instead.

  Actions
    New      Create the certificate (3 years, RSA 3072, SHA-256, code signing only).
    Renew    Keep the old one under previous\ and create a new one. Do this within 90 days of expiry. Files
             already signed stay valid after expiry because they carry a trusted timestamp.
    Revoke   The key is lost or stolen: block this certificate. Later installs and the trust script remove it
             from Trusted Root and Trusted Publishers and add it to Disallowed. Then run New.
    Info     Show the certificate and days left.
    Sign     Sign the files given with -Path, timestamped, and check the result.
    Verify   Check the files given with -Path were signed with the current certificate.
    Package  Write the public certificate, the revoked list and Trust-BeaconRemote.ps1 into -Output.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('New', 'Renew', 'Revoke', 'Info', 'Sign', 'Verify', 'Package')][string]$Action,
    [string[]]$Path,
    [string]$Output,
    [string]$Directory = (Join-Path $env:USERPROFILE '.beacon\secrets\remote-codesign'),
    [string[]]$TimestampServer = @('http://timestamp.digicert.com', 'http://timestamp.sectigo.com', 'http://timestamp.globalsign.com/tsa/r6advanced1'),
    [switch]$AllowNoTimestamp
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$subject = 'CN=Beacon Remote, O=Beacon Remote (self-signed)'
$pfxPath = Join-Path $Directory 'beacon-remote-codesign.pfx'
$passwordPath = Join-Path $Directory 'beacon-remote-codesign.password'
$cerPath = Join-Path $Directory 'beacon-remote-codesign.cer'

function Get-Sha256([byte[]]$bytes) {
    ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($bytes))).Replace('-', '')
}
function Protect-Directory([string]$folder) {
    New-Item -ItemType Directory -Force -Path $folder | Out-Null
    & icacls.exe $folder /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the signing folder to this user' }
}
function Read-CurrentCertificate {
    # Returns the certificate with its private key, from CI variables or the secrets folder; never from a store.
    if ($env:BEACON_SIGNING_PFX) {
        $bytes = [Convert]::FromBase64String($env:BEACON_SIGNING_PFX)
        $password = $env:BEACON_SIGNING_PFX_PASSWORD
    } else {
        if (-not (Test-Path -LiteralPath $pfxPath)) { throw "No signing certificate. Run: scripts\Beacon-Signing.ps1 -Action New" }
        $bytes = [System.IO.File]::ReadAllBytes($pfxPath)
        $password = (Get-Content -LiteralPath $passwordPath -Raw).Trim()
    }
    New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $bytes, $password, ([System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
}
function New-Certificate {
    if (Test-Path -LiteralPath $pfxPath) { throw "A signing certificate already exists in $Directory. Use -Action Renew or Revoke." }
    Protect-Directory $Directory
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -KeyAlgorithm RSA -KeyLength 3072 `
        -HashAlgorithm SHA256 -KeyExportPolicy Exportable -KeyUsage DigitalSignature -NotAfter (Get-Date).AddYears(3) `
        -CertStoreLocation 'Cert:\CurrentUser\My'
    try {
        $password = [Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Maximum 256 } | ForEach-Object { [byte]$_ })) -replace '[+/=]', 'x'
        $secure = ConvertTo-SecureString -String $password -AsPlainText -Force
        Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $secure | Out-Null
        Set-Content -LiteralPath $passwordPath -Value $password -NoNewline -Encoding ASCII
        Export-Certificate -Cert $cert -FilePath $cerPath -Type CERT | Out-Null
    } finally {
        # The key must live only in the protected .pfx, not in the user's certificate store.
        Remove-Item -LiteralPath "Cert:\CurrentUser\My\$($cert.Thumbprint)" -DeleteKey -ErrorAction SilentlyContinue
    }
    Show-Info
}
function Show-Info {
    $cert = Read-CurrentCertificate
    $left = [int]($cert.NotAfter - (Get-Date)).TotalDays
    Write-Host "Subject      $($cert.Subject)"
    Write-Host "SHA-256      $(Get-Sha256 $cert.RawData)"
    Write-Host "Thumbprint   $($cert.Thumbprint)"
    Write-Host "Valid until  $($cert.NotAfter.ToString('yyyy-MM-dd')) ($left days left)"
    if ($left -lt 90) { Write-Warning 'Fewer than 90 days left: run -Action Renew.' }
}
function Invoke-Archive([string]$folderName) {
    $target = Join-Path $Directory $folderName
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    foreach ($file in @($pfxPath, $passwordPath, $cerPath)) { if (Test-Path -LiteralPath $file) { Move-Item -LiteralPath $file -Destination $target } }
    return $target
}
function Sign-Files {
    if (-not $Path) { throw '-Path is required' }
    $cert = Read-CurrentCertificate
    foreach ($file in $Path) {
        $done = $false
        foreach ($server in $TimestampServer) {
            try {
                Set-AuthenticodeSignature -LiteralPath $file -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $server | Out-Null
                $signature = Get-AuthenticodeSignature -LiteralPath $file
                if ($signature.TimeStamperCertificate) { $done = $true; break }
            } catch { Write-Warning "Timestamp server $server failed: $($_.Exception.Message)" }
        }
        if (-not $done) {
            if (-not $AllowNoTimestamp) { throw "Could not timestamp $file. A signature without one stops being valid when the certificate expires." }
            Set-AuthenticodeSignature -LiteralPath $file -Certificate $cert -HashAlgorithm SHA256 | Out-Null
        }
    }
    Check-Files
}
function Check-Files {
    if (-not $Path) { throw '-Path is required' }
    $cert = Read-CurrentCertificate
    foreach ($file in $Path) {
        $signature = Get-AuthenticodeSignature -LiteralPath $file
        # A self-signed certificate reads as untrusted unless this computer trusts it; what matters here is that
        # the file is signed, unchanged since, and signed by this certificate.
        if ($signature.Status -in 'NotSigned', 'HashMismatch', 'Incompatible', 'NotSupportedFileFormat') { throw "$file is not validly signed ($($signature.Status))" }
        if (-not $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $cert.Thumbprint) { throw "$file is not signed with the current Beacon Remote certificate" }
        Write-Host "OK  $file  ($($signature.Status))"
    }
}
function Write-Package {
    if (-not $Output) { throw '-Output is required' }
    $cert = Read-CurrentCertificate
    New-Item -ItemType Directory -Force -Path $Output | Out-Null
    $cerOut = Join-Path $Output 'beacon-remote-signing.cer'
    [System.IO.File]::WriteAllBytes($cerOut, $cert.RawData)
    $revokedDir = Join-Path $Output 'revoked'
    New-Item -ItemType Directory -Force -Path $revokedDir | Out-Null
    $revoked = @()
    $source = Join-Path $Directory 'revoked'
    if (Test-Path -LiteralPath $source) {
        foreach ($file in Get-ChildItem -LiteralPath $source -Filter '*.cer') {
            $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
            [System.IO.File]::WriteAllBytes((Join-Path $revokedDir $file.Name), $bytes)
            $revoked += "@{ Sha256 = '$(Get-Sha256 $bytes)'; Base64 = '$([Convert]::ToBase64String($bytes))' }"
        }
    }
    $template = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\packaging\windows-trust\Trust-BeaconRemote.template.ps1') -Raw
    $script = $template.Replace('@@CERT_BASE64@@', [Convert]::ToBase64String($cert.RawData)).Replace('@@CERT_SHA256@@', (Get-Sha256 $cert.RawData)).
        Replace('@@NOT_AFTER@@', $cert.NotAfter.ToString('yyyy-MM-dd')).Replace('@@REVOKED@@', ($revoked -join ",`r`n    "))
    Set-Content -LiteralPath (Join-Path $Output 'Trust-BeaconRemote.ps1') -Value $script -Encoding UTF8
    Write-Host "Wrote $cerOut and Trust-BeaconRemote.ps1 (SHA-256 $(Get-Sha256 $cert.RawData))"
}

switch ($Action) {
    'New' { New-Certificate }
    'Info' { Show-Info }
    'Sign' { Sign-Files }
    'Verify' { Check-Files }
    'Package' { Write-Package }
    'Renew' {
        $old = Read-CurrentCertificate
        $folder = Invoke-Archive "previous\$((Get-Sha256 $old.RawData).Substring(0, 12))"
        Write-Host "Previous certificate kept in $folder"
        New-Certificate
        Write-Host 'Rebuild and publish: new installs trust the new certificate when approved; signed files stay valid.'
    }
    'Revoke' {
        $old = Read-CurrentCertificate
        $revokedDir = Join-Path $Directory 'revoked'
        New-Item -ItemType Directory -Force -Path $revokedDir | Out-Null
        [System.IO.File]::WriteAllBytes((Join-Path $revokedDir "$((Get-Sha256 $old.RawData).Substring(0, 16)).cer"), $old.RawData)
        Invoke-Archive "previous\revoked-$((Get-Sha256 $old.RawData).Substring(0, 12))" | Out-Null
        Write-Host 'Revoked. Run -Action New, rebuild and publish; installs and the trust script will remove and block the old certificate.'
    }
}
