# Owner-requested Remote-only account reset. This is not a deployment or a
# general cleanup tool. No recursive deletion, force-disconnect or image change.
[CmdletBinding()]
param([switch]$Execute)
$ErrorActionPreference = 'Stop'
if (-not $Execute) { throw 'Use -Execute only for the owner-authorized clean-slate Remote account reset.' }
. (Join-Path $PSScriptRoot 'Enter-Workspace.ps1')
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object LocalPort -in @(3010,5174,5175))
if ($listeners.Count) { throw 'Local Remote app ports still have listeners. Verify their owners; no listener was terminated.' }
function Read-Remote([string]$Command) {
    $value = & ssh.exe -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 beacon-oracle $Command
    if ($LASTEXITCODE -ne 0) { throw 'Scoped Remote server operation failed.' }
    return ($value -join "`n").Trim()
}
function Database-Query([string]$DatabaseName, [bool]$Hosted, [string]$Sql) {
    if ($DatabaseName -notin @('beacon_remote_dev','beacon_remote_test','beacon_remote','beacon_remote_acceptance_20261010')) { throw 'Unreviewed reset database.' }
    if ($Hosted) {
        $value = $Sql | & ssh.exe -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=2 beacon-oracle sudo -n docker exec -i beacon-remote-postgres-1 psql -U remote_admin -d $DatabaseName -X -A -t -v ON_ERROR_STOP=1
    } else {
        $value = $Sql | & docker.exe exec -i beacon-remote-dev-postgres-1 psql -U remote_dev -d $DatabaseName -X -A -t -v ON_ERROR_STOP=1
    }
    if ($LASTEXITCODE -ne 0) { throw 'Scoped account reset database operation failed; inspect transaction state before retry.' }
    return ($value -join "`n").Trim()
}
function Remove-VerifiedFile([string]$Path, [string]$Hash, [string]$Root) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($rootPath, [StringComparison]::OrdinalIgnoreCase)) { throw 'Cleanup path escaped its reviewed root.' }
    $candidate = $absolute
    while ($candidate) {
        if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Cleanup refuses links and junctions.' }
        $parent = Split-Path -Parent $candidate
        if ($parent -eq $candidate) { break }
        $candidate = $parent
    }
    if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { throw 'Cleanup expected a single inventoried file.' }
    if ((Get-FileHash -LiteralPath $absolute -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Hash) { throw 'Private data changed after backup; cleanup refused.' }
    Remove-Item -LiteralPath $absolute
}
$receipt = $null
$stopped = $false
$image = Read-Remote "sudo -n docker inspect beacon-remote-backend-1 --format '{{.Image}}'"
if ($image -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Cannot verify the existing Remote backend image.' }
$running = Read-Remote "sudo -n docker inspect beacon-remote-backend-1 --format '{{.State.Running}}'"
if ($running -notin @('true','false')) { throw 'Cannot verify the existing Remote backend state.' }
$countsSql = "SELECT json_build_object('accounts',(SELECT count(*) FROM accounts),'machines',(SELECT count(*) FROM machines),'browserSessions',(SELECT count(*) FROM browser_sessions),'invitations',(SELECT count(*) FROM account_invitations));"
$retiredLogins = @()
foreach ($name in @('test.json','initial-account.json')) {
    $path = Join-Path $env:BEACON_PRIVATE_DIR ('remote/production/accounts/' + $name)
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try { $login = [IO.File]::ReadAllText($path) | ConvertFrom-Json } catch { throw 'Cannot parse a private retired login record.' }
        if ($login.origin -ne 'https://remote.builtbysai.com' -or -not ($login.email -is [string]) -or -not ($login.password -is [string])) { throw 'Unexpected private retired login record.' }
        $retiredLogins += @{email=$login.email;password=$login.password}
        $login = $null
    }
}
try {
    if ($running -eq 'true') {
        Read-Remote 'sudo -n docker stop --time 30 beacon-remote-backend-1' | Out-Null
        $stopped = $true
        if ((Read-Remote "sudo -n docker inspect beacon-remote-backend-1 --format '{{.State.Running}}'") -ne 'false') { throw 'Remote backend did not stop.' }
        Write-Host 'Only the verified Remote backend was stopped for the reset.'
    }
    if ((Read-Remote "sudo -n docker inspect beacon-remote-acceptance-backend --format '{{.State.Running}}'") -ne 'false') { throw 'Paused acceptance is unexpectedly running; no acceptance process was stopped.' }
    $run = [guid]::NewGuid().ToString('N')
    & (Join-Path $PSScriptRoot 'Backup-AccountReset.ps1') -RequireQuiescent -RunId $run | Out-Host
    $receiptFile = Join-Path $env:BEACON_PRIVATE_DIR "remote/account-reset/$run/recovery-receipt.json"
    $receipt = [IO.File]::ReadAllText($receiptFile) | ConvertFrom-Json -AsHashtable
    if (-not ($receipt -is [hashtable]) -or -not $receipt.liveWritesQuiesced -or $receipt.databases.Count -ne 4) { throw 'Final quiesced recovery receipt unavailable.' }
    $receipt.backendImage = $image
    $receipt.databaseResults = @()
    $reset = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../apps/backend/scripts/reset-account-data.sql'))
    foreach ($item in $receipt.databases) {
        $hosted = $item.environment -like 'hosted-*'
        $before = Database-Query $item.database $hosted $countsSql | ConvertFrom-Json
        foreach ($field in @('accounts','machines','browserSessions','invitations')) {
            if ($before.$field -ne $item.restoredCounts.$field) { throw 'Data changed since the quiesced snapshot; reset refused.' }
        }
        $selection = "SET beacon.account_reset_database = '$($item.database)'; SET beacon.account_reset_recovery = 'RESTORE_VERIFIED';"
        Database-Query $item.database $hosted ($selection + "`n" + $reset) | Out-Host
        $after = Database-Query $item.database $hosted $countsSql | ConvertFrom-Json
        foreach ($field in @('accounts','machines','browserSessions','invitations')) {
            if ($after.$field -ne 0) { throw 'Post-reset account verification failed.' }
        }
        # The SQL additionally checks every present reviewed account-data store,
        # not just these independent post-commit aggregate checks.
        $receipt.databaseResults += @{database=$item.database;environment=$item.environment;before=$before;after=$after;committedAt=[DateTime]::UtcNow.ToString('o')}
        [IO.File]::WriteAllText((Join-Path $receipt.sourceDirectory 'reset-receipt.json'), (ConvertTo-Json -Depth 9 -InputObject $receipt))
        Write-Host "Reset committed and independently checked for $($item.environment)."
    }
    $receipt.accountsDeleted = $true
    $receipt.privateFilesRemoved = @()
    foreach ($item in $receipt.retainedFiles) {
        $path = Join-Path $env:BEACON_PRIVATE_DIR $item.relative
        Remove-VerifiedFile $path $item.sha256 (Join-Path $env:BEACON_PRIVATE_DIR 'remote')
        $receipt.privateFilesRemoved += $item.relative
    }
    # Remove only new plaintext staging/restore files whose encrypted copies
    # were hash-verified. Metadata receipts and encrypted recovery are retained.
    foreach ($directory in @($receipt.sourceDirectory,$receipt.restoreDirectory)) {
        foreach ($item in @($receipt.databases) + @($receipt.retainedFiles)) {
            Remove-VerifiedFile (Join-Path $directory $item.file) $item.sha256 $directory
        }
    }
    $receipt.completedAt = [DateTime]::UtcNow.ToString('o')
} finally {
    if ($stopped) {
        Read-Remote 'sudo -n docker start beacon-remote-backend-1' | Out-Null
        $restartedImage = Read-Remote "sudo -n docker inspect beacon-remote-backend-1 --format '{{.Image}}'"
        if ($restartedImage -ne $image) { throw 'Unexpected Remote backend image change during maintenance.' }
        Write-Host 'The same Remote backend container/image was restarted; no code was deployed.'
    }
    if ($receipt -is [hashtable]) {
        $receipt.backendRestarted = $stopped
        foreach ($directory in @($receipt.sourceDirectory,$receipt.restoreDirectory)) {
            [IO.File]::WriteAllText((Join-Path $directory 'reset-receipt.json'), (ConvertTo-Json -Depth 9 -InputObject $receipt))
        }
    }
}
if ($stopped) {
    $healthy = $false
    for ($attempt = 0; $attempt -lt 15; $attempt++) {
        if ((Read-Remote "sudo -n docker inspect beacon-remote-backend-1 --format '{{.State.Health.Status}}'") -eq 'healthy') { $healthy = $true; break }
        Start-Sleep -Seconds 2
    }
    if (-not $healthy) { throw 'The unchanged Remote backend restarted but health is not yet confirmed.' }
    $refused = 0
    try {
        foreach ($login in $retiredLogins) {
            try {
                $response = Invoke-WebRequest -Uri 'https://remote.builtbysai.com/api/login' -Method Post -Headers @{Origin='https://remote.builtbysai.com'} -ContentType 'application/json' -Body (ConvertTo-Json -InputObject $login -Compress) -SkipHttpErrorCheck -MaximumRedirection 0 -TimeoutSec 20
            } catch { throw 'Retired login verification request failed; credentials were not logged.' }
            if ([int]$response.StatusCode -ne 401 -or $response.Headers['Set-Cookie']) { throw 'A retired login did not receive the expected unauthenticated refusal.' }
            $refused++
        }
    } finally { $retiredLogins = $null; $login = $null }
    $receipt.retiredProductionLoginsRefused = $refused
    $receipt.backendHealthy = $true
    foreach ($directory in @($receipt.sourceDirectory,$receipt.restoreDirectory)) {
        [IO.File]::WriteAllText((Join-Path $directory 'reset-receipt.json'), (ConvertTo-Json -Depth 9 -InputObject $receipt))
    }
    Write-Host "The unchanged backend is healthy; $refused retired production logins were refused without issuing cookies."
}
Write-Host 'All four Remote database resets committed. Encrypted recovery and historical/provider copies still need tracked retention/cleanup; no irreversible-erasure claim is made.'
