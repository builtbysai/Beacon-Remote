# Non-destructive preparation for the owner-requested Remote account reset.
# Dumps only the four named Remote DBs. Restores encrypted copies into NEW local
# disposable DBs, never a live product DB. Does not reset accounts or prune backups.
[CmdletBinding()]
param(
    [string]$RecoveryRoot = (Join-Path $env:USERPROFILE 'Beacon-Backups'),
    [switch]$RequireQuiescent,
    [ValidatePattern('^[a-f0-9]{32}$')][string]$RunId = ([guid]::NewGuid().ToString('N'))
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Enter-Workspace.ps1')
function Assert-RealPath([string]$Path) {
    $candidate = [IO.Path]::GetFullPath($Path)
    while ($candidate) {
        if (Test-Path -LiteralPath $candidate) {
            if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'Account-reset backup paths must not traverse links or junctions.'
            }
        }
        $parent = Split-Path -Parent $candidate
        if ($parent -eq $candidate) { break }
        $candidate = $parent
    }
}
function New-PrivateDirectory([string]$Path) {
    Assert-RealPath $Path
    if (Test-Path -LiteralPath $Path) { throw 'Refusing to reuse a backup/restore directory.' }
    New-Item -ItemType Directory -Path $Path | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Path /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not restrict the private backup directory.' }
}
function Save-Binary([string]$Executable, [string[]]$Arguments, [string]$Destination) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    $stream = [IO.File]::Open($Destination, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
    try {
        if (-not $process.Start()) { throw 'Cannot start scoped backup process.' }
        $errors = $process.StandardError.ReadToEndAsync()
        $process.StandardOutput.BaseStream.CopyTo($stream)
        $stream.Flush($true)
        $process.WaitForExit()
        $diagnostics = $errors.GetAwaiter().GetResult()
        if ($process.ExitCode -ne 0) {
            [IO.File]::WriteAllText($Destination + '.error.txt', $diagnostics)
            throw 'Scoped backup process failed; diagnostics remain private.'
        }
    } finally { $stream.Dispose(); $process.Dispose() }
    if ((Get-Item -LiteralPath $Destination).Length -gt 33554432) {
        throw 'Dump exceeds the reviewed 32 MiB budget. Preserve it for inspection.'
    }
}
function Run-Docker([string[]]$Arguments) {
    $output = & docker @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) { throw 'Scoped local backup/restore Docker operation failed.' }
    return $output
}
$RecoveryRoot = [IO.Path]::GetFullPath($RecoveryRoot)
$repository = Join-Path $RecoveryRoot 'workspace'
$restic = Join-Path $RecoveryRoot 'restic.exe'
$password = Join-Path $env:BEACON_PRIVATE_DIR 'shared/backup/workstation-password.txt'
foreach ($path in @($repository, $restic, $password)) {
    Assert-RealPath $path
    if (-not (Test-Path -LiteralPath $path)) { throw 'Existing encrypted backup tool/repository/password required.' }
}
$run = $RunId
$source = Join-Path $env:BEACON_PRIVATE_DIR "remote/account-reset/$run"
$restored = Join-Path $RecoveryRoot "account-reset-restore-$run"
if ([IO.Path]::GetPathRoot($source) -eq [IO.Path]::GetPathRoot($repository)) {
    throw 'Account-reset recovery must use the independent backup drive.'
}
New-PrivateDirectory $source
New-PrivateDirectory $restored
$targets = @(
    @{ Label='local-development'; Database='beacon_remote_dev'; Hosted=$false },
    @{ Label='local-test'; Database='beacon_remote_test'; Hosted=$false },
    @{ Label='hosted-production'; Database='beacon_remote'; Hosted=$true },
    @{ Label='hosted-acceptance'; Database='beacon_remote_acceptance_20261010'; Hosted=$true }
)
$manifest = @()
$retainedFiles = @()
foreach ($relative in @(
    'remote/local/accounts/development.json',
    'remote/local/accounts/temporary-development.json',
    'remote/local/accounts/temporary-development.json.pending',
    'remote/local/accounts/support.json',
    'remote/production/accounts/initial-account.json',
    'remote/production/accounts/test.json',
    'remote/acceptance/android/login.json',
    'remote/local/database.dump',
    'remote/local/test-database.dump',
    'remote/acceptance/android/database.dump'
)) {
    $original = Join-Path $env:BEACON_PRIVATE_DIR $relative
    Assert-RealPath $original
    if (-not (Test-Path -LiteralPath $original)) { continue }
    if (-not (Test-Path -LiteralPath $original -PathType Leaf)) { throw 'Expected retained private file is not a file.' }
    $file = 'retained-' + ($relative -replace '[/\\]','-')
    $copy = Join-Path $source $file
    Copy-Item -LiteralPath $original -Destination $copy
    $hash = (Get-FileHash -LiteralPath $original -Algorithm SHA256).Hash.ToLowerInvariant()
    if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash.ToLowerInvariant() -ne $hash) { throw 'Retained private file changed while being captured.' }
    $retainedFiles += @{relative=$relative;file=$file;sha256=$hash}
}
foreach ($target in $targets) {
    if ($RequireQuiescent) {
        $query = "SELECT count(*) FROM pg_stat_activity WHERE datname='$($target.Database)' AND backend_type='client backend'"
        if ($target.Hosted) {
            $connections = $query | & ssh.exe -o BatchMode=yes -o ConnectTimeout=15 beacon-oracle sudo -n docker exec -i beacon-remote-postgres-1 psql -U remote_admin -d postgres -X -A -t -v ON_ERROR_STOP=1
            if ($LASTEXITCODE -ne 0) { throw 'Cannot verify hosted database quiescence.' }
        } else {
            $connections = Run-Docker @('exec','beacon-remote-dev-postgres-1','psql','-U','remote_dev','-d','postgres','-X','-A','-t','-v','ON_ERROR_STOP=1','-c',$query)
        }
        if (($connections -join '').Trim() -ne '0') { throw 'A selected Remote database still has client connections. No writer was terminated.' }
    }
    $dump = Join-Path $source ($target.Label + '.dump')
    $arguments = @('exec', 'beacon-remote-dev-postgres-1', 'pg_dump', '-U', 'remote_dev', '-d', $target.Database, '--format=custom', '--no-owner', '--no-privileges')
    if ($target.Hosted) {
        $arguments = @('-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'beacon-oracle', 'sudo', '-n', 'docker', 'exec', 'beacon-remote-postgres-1', 'pg_dump', '-U', 'remote_admin', '-d', $target.Database, '--format=custom', '--no-owner', '--no-privileges')
        Save-Binary 'ssh.exe' $arguments $dump
    } else { Save-Binary 'docker.exe' $arguments $dump }
    $manifest += @{ environment=$target.Label; database=$target.Database; file=($target.Label+'.dump'); sha256=(Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant() }
    Write-Host "Captured $($target.Label) database; no account contents displayed."
}
[IO.File]::WriteAllText((Join-Path $source 'manifest.json'), (ConvertTo-Json -Depth 5 -InputObject @{version=1;run=$run;createdAt=[DateTime]::UtcNow.ToString('o');databases=$manifest;retainedFiles=$retainedFiles}))
$backup = & $restic -r $repository --password-file $password backup $source --tag beacon-remote-account-reset --tag pre-reset --json 2>$null
if ($LASTEXITCODE -ne 0) { throw 'Encrypted backup failed. No reset was attempted.' }
$summary = @($backup | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object message_type -eq 'summary')
$snapshot = $summary[-1].snapshot_id
if ($snapshot -notmatch '^[a-f0-9]{8,64}$') { throw 'Cannot identify the completed encrypted snapshot.' }
# Restore only this owned subtree; original ACLs are restricted and no live paths
# are overwritten. This also reads/verifies the actual encrypted backup data.
$subtree = '/' + ($source -replace ':','' -replace '\\','/').TrimStart('/')
& $restic -r $repository --password-file $password restore "${snapshot}:$subtree" --target $restored --verify --quiet | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'Encrypted backup restore failed. No reset was attempted.' }
foreach ($item in $retainedFiles) {
    if ((Get-FileHash -LiteralPath (Join-Path $restored $item.file) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) {
        throw 'Restored retained private file does not match its captured hash.'
    }
}
foreach ($item in $manifest) {
    $dump = Join-Path $restored $item.file
    if ((Get-FileHash -LiteralPath $dump -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) {
        throw 'Restored dump does not match its captured hash.'
    }
    $databaseName = 'beacon_remote_reset_restore_' + [guid]::NewGuid().ToString('N')
    $containerDump = '/tmp/beacon-remote-reset-' + $run + '-' + $item.environment + '.dump'
    $created = $false
    $copied = $false
    try {
        Run-Docker @('exec','beacon-remote-dev-postgres-1','createdb','-U','remote_dev',$databaseName) | Out-Null
        $created = $true
        Run-Docker @('cp',$dump,('beacon-remote-dev-postgres-1:' + $containerDump)) | Out-Null
        $copied = $true
        Run-Docker @('exec','beacon-remote-dev-postgres-1','chmod','600',$containerDump) | Out-Null
        Run-Docker @('exec','beacon-remote-dev-postgres-1','pg_restore','-U','remote_dev','-d',$databaseName,'--exit-on-error','--no-owner','--no-privileges',$containerDump) | Out-Null
        $counts = Run-Docker @('exec','beacon-remote-dev-postgres-1','psql','-U','remote_dev','-d',$databaseName,'-X','-A','-t','-v','ON_ERROR_STOP=1','-c',"SELECT json_build_object('accounts',(SELECT count(*) FROM accounts),'machines',(SELECT count(*) FROM machines),'browserSessions',(SELECT count(*) FROM browser_sessions),'invitations',(SELECT count(*) FROM account_invitations))")
        $item.restoredCounts = ($counts -join '') | ConvertFrom-Json
        Write-Host "Encrypted recovery and separate-database restore passed for $($item.environment)."
    } finally {
        # Only exact newly created fixtures are removed; no recursive cleanup,
        # termination of other connections, database replacement or volume removal.
        if ($created) { Run-Docker @('exec','beacon-remote-dev-postgres-1','dropdb','-U','remote_dev',$databaseName) | Out-Null }
        if ($copied) { Run-Docker @('exec','beacon-remote-dev-postgres-1','rm','--',$containerDump) | Out-Null }
    }
}
$receipt = @{version=1;run=$run;snapshot=$snapshot;sourceDirectory=$source;restoreDirectory=$restored;restoreVerifiedAt=[DateTime]::UtcNow.ToString('o');databases=$manifest;retainedFiles=$retainedFiles;liveWritesQuiesced=$RequireQuiescent.IsPresent;accountsDeleted=$false}
$json = ConvertTo-Json -Depth 7 -InputObject $receipt
[IO.File]::WriteAllText((Join-Path $source 'recovery-receipt.json'), $json)
[IO.File]::WriteAllText((Join-Path $restored 'recovery-receipt.json'), $json)
Write-Host "Remote pre-reset recovery verified. Run $run; snapshot $snapshot. No accounts deleted. Quiescence checks requested: $($RequireQuiescent.IsPresent)."
