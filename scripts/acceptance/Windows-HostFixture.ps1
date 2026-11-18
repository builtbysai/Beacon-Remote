param(
    [Parameter(Mandatory)][ValidateSet('Prepare', 'Stage', 'Pair', 'Show', 'Status', 'Stop')][string]$Action,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$Run,
    [ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
    [ValidatePattern('^[A-Fa-f0-9]{64}$')][string]$ArchiveSha256,
    [ValidatePattern('^[A-Fa-f0-9]{40}$')][string]$SignerThumbprint,
    [switch]$Resume
)
# Deliberate owner-approved Surfiena fixture. No installed identity, service,
# startup entry, certificate store or permission is changed. Approval stays local.
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ine 'SURFIENA') { throw 'This fixture is restricted to the designated Surfiena device.' }
$root = Join-Path $env:USERPROFILE "BeaconRemoteAcceptance\$Run"
$bin = Join-Path $root 'bin'
$fixtureProfile = Join-Path $root 'profile'
$taskName = "BeaconRemoteAcceptance_$Run"
function Assert-PlainPath([string]$Path) {
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked fixture paths are refused.' }
        $parent = Split-Path -Parent $current
        if ($parent -eq $current) { break }
        $current = $parent
    }
}
Assert-PlainPath $root
if ($Action -eq 'Prepare') {
    if (Test-Path -LiteralPath $root) { throw 'Existing fixture directory refused.' }
    New-Item -ItemType Directory -Path $root | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $root /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Private fixture permissions could not be established.' }
    @{ run = $Run; computer = $env:COMPUTERNAME; kind = 'beacon-remote-device-fixture-v1' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'ownership.json') -Encoding utf8
    Write-Output '{"prepared":true,"installedIdentityChanged":false}'
    return
}
$owner = Get-Content -LiteralPath (Join-Path $root 'ownership.json') -Raw | ConvertFrom-Json
if ($owner.run -ne $Run -or $owner.computer -ine 'SURFIENA' -or $owner.kind -ne 'beacon-remote-device-fixture-v1') { throw 'Owned fixture metadata required.' }
$candidateFile = Join-Path $root 'candidate.json'
$candidate = if (Test-Path -LiteralPath $candidateFile) { Get-Content -LiteralPath $candidateFile -Raw | ConvertFrom-Json } else { $null }
if ($candidate -and $candidate.binaryDirectory) {
    if ($candidate.binaryDirectory -notmatch '^versions\\[a-f0-9]{40}$') { throw 'Unexpected candidate directory.' }
    $bin = Join-Path $root $candidate.binaryDirectory
    Assert-PlainPath $bin
}
function Get-OwnedHost {
    $record = Join-Path $root 'host-process.json'
    if (-not (Test-Path -LiteralPath $record)) { return $null }
    $saved = Get-Content -LiteralPath $record -Raw | ConvertFrom-Json
    $process = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
    if (-not $process) { return $null }
    $prefix = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
    if (-not $process.Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($process.Path) -ine 'beacon-remote-host.exe') { return $null }
    if ([Math]::Abs(($process.StartTime.ToUniversalTime() - [DateTime]::Parse($saved.startedAt).ToUniversalTime()).TotalSeconds) -gt 10) { return $null }
    return $process
}
if ($Action -eq 'Stage') {
    if (-not $Commit -or -not $ArchiveSha256 -or -not $SignerThumbprint) { throw 'Pinned source, archive checksum and signer are required.' }
    $relativeBin = "versions\$Commit"
    $bin = Join-Path $root $relativeBin
    Assert-PlainPath $bin
    if (Test-Path -LiteralPath $bin) { throw 'Existing fixture binaries refused.' }
    $archive = Join-Path $root "package-$Commit.zip"
    if (-not (Test-Path -LiteralPath $archive)) { $archive = Join-Path $root 'package.zip' }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ine $ArchiveSha256) { throw 'Archive checksum mismatch.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    try {
        $names = @('beacon-remote-agent.exe', 'beacon-remote-host.exe', 'beacon-remote-session.exe', 'Install.ps1', 'Uninstall.ps1', 'README.txt', 'manifest.json')
        if ($zip.Entries.Count -ne $names.Count) { throw 'Unexpected archive shape.' }
        foreach ($entry in $zip.Entries) { if ($entry.FullName -notin $names) { throw 'Unexpected archive path.' } }
        if (@($zip.Entries.FullName | Select-Object -Unique).Count -ne $names.Count) { throw 'Duplicate archive entries refused.' }
    } finally { $zip.Dispose() }
    Expand-Archive -LiteralPath $archive -DestinationPath $bin
    $manifest = Get-Content -LiteralPath (Join-Path $bin 'manifest.json') -Raw | ConvertFrom-Json
    if ($manifest.commit -ne $Commit -or @($manifest.features).Count -ne 0) { throw 'Expected ordinary-host candidate; sign-in capability is separate.' }
    foreach ($file in $manifest.files) {
        if ($file.name -notin @('beacon-remote-agent.exe', 'beacon-remote-host.exe', 'beacon-remote-session.exe', 'Uninstall.ps1')) { throw 'Unexpected payload path.' }
        $path = Join-Path $bin $file.name
        if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ine $file.sha256) { throw 'Payload checksum mismatch.' }
        if ($file.name.EndsWith('.exe')) {
            $signature = Get-AuthenticodeSignature -LiteralPath $path
            if ($signature.SignerCertificate.Thumbprint -ine $SignerThumbprint -or -not $signature.TimeStamperCertificate) { throw 'Candidate signer or timestamp mismatch.' }
        }
    }
    if (-not (Test-Path -LiteralPath $fixtureProfile)) { New-Item -ItemType Directory -Path $fixtureProfile | Out-Null }
    if ($candidate) { $candidate | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root ('candidate-history-' + [guid]::NewGuid().ToString('N') + '.json')) -Encoding utf8 }
    @{ source = $Commit; binaryDirectory = $relativeBin; archiveSha256 = $ArchiveSha256; signer = $SignerThumbprint; variant = 'default' } | ConvertTo-Json | Set-Content -LiteralPath $candidateFile -Encoding utf8
    Write-Output '{"verified":true,"installedIdentityChanged":false}'
    return
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'candidate.json'))) { throw 'Verified candidate required.' }
Assert-PlainPath $fixtureProfile
if ($Action -eq 'Pair') {
    if (Test-Path -LiteralPath (Join-Path $fixtureProfile 'BeaconRemote\identity.dpapi')) { throw 'Existing fixture identity refused.' }
    $inputText = [Console]::In.ReadToEnd()
    $lines = @($inputText -split '\r?\n' | Where-Object { $_ })
    if ($lines.Count -ne 3 -or $lines[0] -ne 'https://remote-test.builtbysai.com' -or $lines[1] -ne 'Surfiena acceptance') { throw 'Only the isolated test pairing is allowed.' }
    $process = New-Object Diagnostics.Process
    $process.StartInfo.FileName = Join-Path $bin 'beacon-remote-agent.exe'
    $process.StartInfo.Arguments = 'pair'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.EnvironmentVariables['LOCALAPPDATA'] = $fixtureProfile
    $process.StartInfo.RedirectStandardInput = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        [void]$process.Start()
        $output = $process.StandardOutput.ReadToEndAsync()
        $errors = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.Write($inputText)
        $process.StandardInput.Close()
        $inputText = $null
        if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Fixture pairing timed out.' }
        $process.WaitForExit()
        [IO.File]::WriteAllText((Join-Path $root 'pair-output.log'), $output.Result)
        [IO.File]::WriteAllText((Join-Path $root 'pair-error.log'), $errors.Result)
        if ($process.ExitCode -ne 0) { throw 'Pairing failed; diagnostics remain private on the device.' }
    } finally { $process.Dispose() }
    Write-Output '{"paired":true}'
    return
}
if ($Action -eq 'Show') {
    if (-not (Test-Path -LiteralPath (Join-Path $fixtureProfile 'BeaconRemote\identity.dpapi'))) { throw 'Pair the fixture first.' }
    $launchFile = Join-Path $root 'launch.json'
    $previousTask = if (Test-Path -LiteralPath $launchFile) { (Get-Content -LiteralPath $launchFile -Raw | ConvertFrom-Json).taskName } else { $taskName }
    if ($previousTask -notmatch "^BeaconRemoteAcceptance_${Run}(_[a-f0-9]{8})?$") { throw 'Unexpected prior fixture task.' }
    $prior = Get-ScheduledTask -TaskName $previousTask -ErrorAction SilentlyContinue
    if ($prior -and $prior.State -eq 'Running') { throw 'Stop the current owned host before another launch.' }
    if (Get-OwnedHost) { throw 'The owned host process has not exited yet.' }
    $stopFile = Join-Path $root 'STOP'
    if (Test-Path -LiteralPath $stopFile) {
        if (-not $Resume -or [IO.File]::ReadAllText($stopFile) -ne 'stop') { throw 'Explicit resume of this stopped fixture is required.' }
        Move-Item -LiteralPath $stopFile -Destination (Join-Path $root ('STOP-before-' + [guid]::NewGuid().ToString('N') + '.txt'))
    }
    $taskName = "BeaconRemoteAcceptance_${Run}_$([guid]::NewGuid().ToString('N').Substring(0,8))"
    # The existing signed-in user's LIMITED interactive token supplies the desktop.
    # No Session 0 capture, consent clicking, UAC automation or elevated task.
    $code = @"
`$ErrorActionPreference='Stop'
`$root='$($root.Replace("'", "''"))'
`$env:LOCALAPPDATA=Join-Path `$root 'profile'
`$start=New-Object Diagnostics.ProcessStartInfo
`$start.FileName='$((Join-Path $bin 'beacon-remote-host.exe').Replace("'", "''"))'
`$start.UseShellExecute=`$false
`$start.CreateNoWindow=`$true
`$start.WindowStyle=[Diagnostics.ProcessWindowStyle]::Normal
`$start.RedirectStandardOutput=`$true
`$start.RedirectStandardError=`$true
`$child=New-Object Diagnostics.Process
`$child.StartInfo=`$start
[void]`$child.Start()
`$line=`$child.StandardOutput.ReadLineAsync()
`$errorLine=`$child.StandardError.ReadLineAsync()
`$traceName='media-timings-$($taskName.Split('_')[-1]).jsonl'
@{pid=`$child.Id;session=(Get-Process -Id `$child.Id).SessionId;userInteractive=[Environment]::UserInteractive;startedAt=[DateTime]::UtcNow.ToString('o');traceFile=`$traceName;source='$($candidate.source)'} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path `$root 'host-process.json') -Encoding utf8
try {
 `$deadline=[DateTime]::UtcNow.AddMinutes(35)
 while(-not `$child.HasExited -and [DateTime]::UtcNow -lt `$deadline -and -not(Test-Path -LiteralPath (Join-Path `$root 'STOP'))){
  if(`$line -and `$line.IsCompleted){
   `$value=`$line.Result
   if(`$null -ne `$value){
    if(`$value -match '^Presence ready in ([0-9]+) ms\.`$'){@{elapsedMillis=[long]`$Matches[1];at=[DateTime]::UtcNow.ToString('o');source='$($candidate.source)'}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path `$root 'presence-timing.json') -Encoding utf8}
    # Only fixed numeric/state timing messages and a short list of fixed stop and permission messages are retained. Drop every other
    # stdout/stderr line, including any controller, candidate, SDP or grant data.
    if(`$value -match '^(Media offer ready: generation [0-9]+, setup [0-9]+ ms\.|First video packet sent: generation [0-9]+, [0-9]+ ms\.|Native (ICE state|ICE gathering|peer connection state): generation [0-9]+, [A-Za-z]+, [0-9]+ ms\.|Native ICE error: generation [0-9]+, code [0-9]+, [0-9]+ ms\.|Signaling stopped: [a-z ]+\.|(Drive|Print) channel stopped: [a-z ]+\.|Viewer [a-z]+ permission added for this connection\.)`$'){@{at=[DateTime]::UtcNow.ToString('o');event=`$value}|ConvertTo-Json -Compress|Add-Content -LiteralPath (Join-Path `$root `$traceName) -Encoding utf8}
    `$line=`$child.StandardOutput.ReadLineAsync()
   }else{`$line=`$null}
  }
  if(`$errorLine -and `$errorLine.IsCompleted){if(`$null -ne `$errorLine.Result){`$errorLine=`$child.StandardError.ReadLineAsync()}else{`$errorLine=`$null}}
  Start-Sleep -Milliseconds 100
 }
} finally { if(-not `$child.HasExited){ `$child.Kill(); `$child.WaitForExit() }; `$child.Dispose() }
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($code))
    # A console-subsystem task can cause Windows Terminal to create a blank
    # window before PowerShell applies -WindowStyle Hidden. Start through the
    # inbox windowless script host; hide only this owned launcher, not Beacon.
    $bootstrap = Join-Path $root ('launch-' + $taskName.Split('_')[-1] + '.vbs')
    Assert-PlainPath $bootstrap
    if (Test-Path -LiteralPath $bootstrap) { throw 'Existing launch bootstrap refused.' }
    $shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $command = '"' + $shell + '" -NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand ' + $encoded
    $script = 'CreateObject("WScript.Shell").Run "' + $command.Replace('"', '""') + '", 0, True'
    [IO.File]::WriteAllText($bootstrap, $script, [Text.Encoding]::Unicode)
    $taskAction = New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\wscript.exe') -Argument ('//B //NoLogo "' + $bootstrap + '"')
    $principal = New-ScheduledTaskPrincipal -UserId ([Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 40)
    Register-ScheduledTask -TaskName $taskName -Action $taskAction -Principal $principal -Settings $settings | Out-Null
    @{taskName=$taskName;source=$candidate.source;startedAt=[DateTime]::UtcNow.ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $launchFile -Encoding utf8
    Start-ScheduledTask -TaskName $taskName
    Write-Output '{"interactiveLaunchRequested":true,"limitedUser":true,"boundedMinutes":35}'
    return
}
if ($Action -eq 'Stop') {
    [IO.File]::WriteAllText((Join-Path $root 'STOP'), 'stop')
    Write-Output '{"stopRequested":true}'
    return
}
$state = if (Test-Path -LiteralPath (Join-Path $root 'host-process.json')) { Get-Content -LiteralPath (Join-Path $root 'host-process.json') -Raw | ConvertFrom-Json } else { $null }
$launchFile = Join-Path $root 'launch.json'
if (Test-Path -LiteralPath $launchFile) { $taskName = (Get-Content -LiteralPath $launchFile -Raw | ConvertFrom-Json).taskName }
if ($taskName -notmatch "^BeaconRemoteAcceptance_${Run}(_[a-f0-9]{8})?$") { throw 'Unexpected fixture task.' }
$timing = if (Test-Path -LiteralPath (Join-Path $root 'presence-timing.json')) { Get-Content -LiteralPath (Join-Path $root 'presence-timing.json') -Raw | ConvertFrom-Json } else { $null }
@{ paired = (Test-Path -LiteralPath (Join-Path $fixtureProfile 'BeaconRemote\identity.dpapi')); host = $state; hostRunning=[bool](Get-OwnedHost); presenceTiming=$timing; task = (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty State) } | ConvertTo-Json -Compress
