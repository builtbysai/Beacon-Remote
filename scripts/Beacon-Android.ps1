[CmdletBinding()]
param(
    # New: create the release key once. Build: a signed release APK in dist\. Info: the key's fingerprint.
    [Parameter(Mandatory)][ValidateSet('New', 'Build', 'Info')][string]$Action
)
# Signing the Android host with its own key (docs/android-distribution.md). The key and its password live under
# the user's secrets folder, never in the repository, and Android only installs updates signed by the same key,
# so back that folder up. The key is created once and never replaced silently.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$secrets = Join-Path $env:USERPROFILE '.beacon\secrets\remote-android'
$keystore = Join-Path $secrets 'beacon-remote-host.jks'
$passwordFile = Join-Path $secrets 'store-password.txt'
$javaHome = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Android\Android Studio\jbr' }
$keytool = Join-Path $javaHome 'bin\keytool.exe'
if (-not (Test-Path -LiteralPath $keytool)) { throw "keytool not found under $javaHome; set JAVA_HOME to a JDK" }

switch ($Action) {
    'New' {
        if (Test-Path -LiteralPath $keystore) { throw "A release key already exists at $keystore. It is not replaced: phones would have to uninstall and pair again." }
        New-Item -ItemType Directory -Force $secrets | Out-Null
        $bytes = New-Object byte[] 24
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $password = [Convert]::ToBase64String($bytes).Replace('+', 'A').Replace('/', 'B').Replace('=', 'C')
        Set-Content -LiteralPath $passwordFile -Value $password -NoNewline -Encoding ascii
        # Owner-only access for both files.
        foreach ($file in @($passwordFile)) { icacls $file /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null }
        & $keytool -genkeypair -v -keystore $keystore -alias beacon -keyalg RSA -keysize 3072 -validity 9125 `
            -storepass $password -keypass $password -dname 'CN=Beacon Remote Host, O=Beacon' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'keytool failed' }
        icacls $keystore /inheritance:r /grant:r "${env:USERNAME}:(R,W)" | Out-Null
        "Created $keystore. Back up the folder $secrets (the key and its password); nothing can replace them."
    }
    'Info' {
        & $keytool -list -v -keystore $keystore -storepass (Get-Content -LiteralPath $passwordFile -Raw) -alias beacon | Select-String 'SHA256|Valid'
    }
    'Build' {
        if (-not (Test-Path -LiteralPath $keystore)) { throw 'No release key yet. Run: scripts\Beacon-Android.ps1 -Action New' }
        $commit = (git -C $root rev-parse --short=8 HEAD).Trim()
        if (git -C $root status --porcelain -- apps/android-host) { throw 'Commit the Android host first so the build matches a commit' }
        $env:JAVA_HOME = $javaHome
        $env:BEACON_ANDROID_KEYSTORE = $keystore
        $env:BEACON_ANDROID_STORE_PASSWORD = (Get-Content -LiteralPath $passwordFile -Raw)
        try {
            Push-Location (Join-Path $root 'apps\android-host')
            & .\gradlew.bat :app:testDebugUnitTest :app:assembleRelease
            if ($LASTEXITCODE -ne 0) { throw 'Android release build failed' }
        } finally {
            Pop-Location
            Remove-Item Env:BEACON_ANDROID_KEYSTORE, Env:BEACON_ANDROID_STORE_PASSWORD -ErrorAction SilentlyContinue
        }
        $apk = Join-Path $root 'apps\android-host\app\build\outputs\apk\release\app-release.apk'
        if (-not (Test-Path -LiteralPath $apk)) { throw 'The release APK was not produced (is it unsigned? check the key)' }
        $dist = Join-Path $root 'dist'
        New-Item -ItemType Directory -Force $dist | Out-Null
        $out = Join-Path $dist "BeaconRemoteHost-$commit.apk"
        Copy-Item -LiteralPath $apk -Destination $out -Force
        $sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk\build-tools'
        $apksigner = Get-ChildItem $sdk -Recurse -Filter apksigner.bat -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1
        if ($apksigner) { & $apksigner.FullName verify --print-certs $out | Select-String 'SHA-256|Verifies' }
        Get-FileHash -Algorithm SHA256 -LiteralPath $out | Format-List
        "Signed APK: $out"
    }
}
