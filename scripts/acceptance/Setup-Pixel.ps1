[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Status', 'Prepare')][string]$Action,
    # The designated development phone. Another serial is refused.
    [ValidatePattern('^[A-Za-z0-9]+$')][string]$Serial = '34171JEHN07672',
    # Optional signed APK to install as an update (keeps the paired identity; never uninstalls).
    [string]$Apk
)
# Brings the designated Pixel to the state the acceptance runs need with the fewest phone taps.
# Only Beacon's own permissions and the test-friendly display settings are changed. It never enters
# the phone passcode, never pairs, and never turns on unattended access: those stay with the owner
# (pair code once, "Enable unattended access" once, unlock once per boot).
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$package = 'com.beaconremote.host'
$service = "$package/$package.ControlService"
$adb = Join-Path $env:LOCALAPPDATA 'Android\Sdk\platform-tools\adb.exe'
if (-not (Test-Path -LiteralPath $adb)) { throw 'adb not found in the Android SDK platform-tools' }
function Invoke-Phone([string[]]$Arguments) { (& $adb -s $Serial @Arguments | Out-String).Trim() }
$state = (& $adb devices | Select-String "^$Serial\s+(\w+)")
if (-not $state -or $state.Matches[0].Groups[1].Value -ne 'device') { throw "Pixel $Serial is not connected and authorized over USB" }

if ($Action -eq 'Prepare') {
    if ($Apk) {
        if (-not (Test-Path -LiteralPath $Apk -PathType Leaf)) { throw 'APK not found' }
        $output = & $adb -s $Serial install -r $Apk | Out-String
        if ($output -notmatch 'Success') { throw "APK install failed: $output" }
    }
    if ((Invoke-Phone @('shell', 'pm', 'list', 'packages', $package)) -notmatch $package) { throw 'Beacon Remote is not installed; install the APK first (-Apk)' }
    # Android 13+ blocks accessibility for sideloaded apps until restricted settings are allowed.
    Invoke-Phone @('shell', 'cmd', 'appops', 'set', $package, 'ACCESS_RESTRICTED_SETTINGS', 'allow') | Out-Null
    Invoke-Phone @('shell', 'pm', 'grant', $package, 'android.permission.POST_NOTIFICATIONS') | Out-Null
    # Add Beacon's service to the enabled list without removing the owner's other services.
    $enabled = Invoke-Phone @('shell', 'settings', 'get', 'secure', 'enabled_accessibility_services')
    $list = if ($enabled -and $enabled -ne 'null') { @($enabled -split ':') } else { @() }
    if ($list -notcontains $service) { $list += $service }
    Invoke-Phone @('shell', 'settings', 'put', 'secure', 'enabled_accessibility_services', ($list -join ':')) | Out-Null
    Invoke-Phone @('shell', 'settings', 'put', 'secure', 'accessibility_enabled', '1') | Out-Null
    # Keep the phone awake long enough for a test, and let Beacon run in the background.
    Invoke-Phone @('shell', 'settings', 'put', 'system', 'screen_off_timeout', '1800000') | Out-Null
    Invoke-Phone @('shell', 'dumpsys', 'deviceidle', 'whitelist', "+$package") | Out-Null
    # While plugged in over USB or AC the screen stays on, so a long test is not interrupted by the lock.
    Invoke-Phone @('shell', 'settings', 'put', 'global', 'stay_on_while_plugged_in', '3') | Out-Null
}

$accessibility = Invoke-Phone @('shell', 'settings', 'get', 'secure', 'enabled_accessibility_services')
$status = [ordered]@{
    serial            = $Serial
    installed         = ((Invoke-Phone @('shell', 'pm', 'list', 'packages', $package)) -match $package)
    version           = ((Invoke-Phone @('shell', 'dumpsys', 'package', $package) | Select-String 'versionName=(\S+)' | Select-Object -First 1).Matches.Groups[1].Value)
    accessibilityOn   = ($accessibility -split ':' -contains $service)
    screenTimeoutMs   = Invoke-Phone @('shell', 'settings', 'get', 'system', 'screen_off_timeout')
    stayOnWhilePlugged = Invoke-Phone @('shell', 'settings', 'get', 'global', 'stay_on_while_plugged_in')
    awake             = ((Invoke-Phone @('shell', 'dumpsys', 'power')) -match 'mWakefulness=Awake')
    unlocked          = ((Invoke-Phone @('shell', 'dumpsys', 'window')) -match 'isKeyguardShowing=false')
    serviceRunning    = [bool](Invoke-Phone @('shell', 'pidof', $package))
}
$status | ConvertTo-Json
$todo = @()
if (-not $status.installed) { $todo += 'Install the APK: -Action Prepare -Apk <path>' }
if (-not $status.unlocked) { $todo += 'Unlock the phone (the agent never enters the passcode)' }
if ($status.installed) { $todo += 'Owner, once: pair with a one-use code and tap "Enable unattended access" in the Beacon app' }
$todo | ForEach-Object { "TODO: $_" }
