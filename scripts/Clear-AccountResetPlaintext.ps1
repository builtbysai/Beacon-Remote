# Remove only hashed plaintext files from named, successfully recovered reset
# runs after an actual completed database reset. Encrypted snapshots are retained.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string[]]$RunId,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$CompletedResetRun,
    [string]$RecoveryRoot = (Join-Path $env:USERPROFILE 'Beacon-Backups')
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Enter-Workspace.ps1')
function Assert-RealPath([string]$Path) {
    $candidate = [IO.Path]::GetFullPath($Path)
    while ($candidate) {
        if ((Get-Item -LiteralPath $candidate -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Plaintext cleanup refuses links and junctions.' }
        $parent = Split-Path -Parent $candidate
        if ($parent -eq $candidate) { break }
        $candidate = $parent
    }
}
$privateReset = Join-Path $env:BEACON_PRIVATE_DIR 'remote/account-reset'
$completedFile = Join-Path $privateReset "$CompletedResetRun/reset-receipt.json"
Assert-RealPath $completedFile
$completed = [IO.File]::ReadAllText($completedFile) | ConvertFrom-Json -AsHashtable
if (-not $completed.accountsDeleted -or -not $completed.backendHealthy -or $completed.databaseResults.Count -ne 4) { throw 'Completed, verified database reset receipt required.' }
foreach ($run in $RunId) {
    $source = Join-Path $privateReset $run
    $restored = Join-Path $RecoveryRoot "account-reset-restore-$run"
    $receiptFile = Join-Path $source 'recovery-receipt.json'
    Assert-RealPath $receiptFile
    Assert-RealPath $restored
    $receipt = [IO.File]::ReadAllText($receiptFile) | ConvertFrom-Json -AsHashtable
    if ($receipt.run -ne $run -or -not $receipt.restoreVerifiedAt -or $receipt.snapshot -notmatch '^[a-f0-9]{64}$') { throw 'Successful encrypted recovery receipt required for each run.' }
    $repository = Join-Path $RecoveryRoot 'workspace'
    $tool = Join-Path $RecoveryRoot 'restic.exe'
    $password = Join-Path $env:BEACON_PRIVATE_DIR 'shared/backup/workstation-password.txt'
    foreach ($path in @($repository,$tool,$password)) { Assert-RealPath $path }
    $snapshots = & $tool -r $repository --password-file $password snapshots $receipt.snapshot --json 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Cannot confirm the existing encrypted recovery snapshot.' }
    $snapshots = @($snapshots | ConvertFrom-Json)
    if ($snapshots.Count -ne 1 -or $snapshots[0].id -ne $receipt.snapshot) { throw 'Encrypted recovery snapshot does not match its receipt.' }
    $removed = @()
    foreach ($directory in @($source,$restored)) {
        $absoluteRoot = [IO.Path]::GetFullPath($directory).TrimEnd('\') + '\'
        foreach ($item in @($receipt.databases) + @($receipt.retainedFiles)) {
            if ($null -eq $item) { continue }
            if ($item.file -notmatch '^(local-development|local-test|hosted-production|hosted-acceptance)\.dump$|^retained-remote-[a-z0-9.-]+$' -or $item.sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Unreviewed plaintext file in receipt.' }
            $path = [IO.Path]::GetFullPath((Join-Path $directory $item.file))
            if (-not $path.StartsWith($absoluteRoot,[StringComparison]::OrdinalIgnoreCase)) { throw 'Plaintext path escaped its reviewed directory.' }
            if (-not (Test-Path -LiteralPath $path)) { continue }
            Assert-RealPath $path
            if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $item.sha256) { throw 'Plaintext file changed after verified recovery; preserved for inspection.' }
            Remove-Item -LiteralPath $path
            $removed += $path
        }
    }
    $cleanup = @{run=$run;completedResetRun=$CompletedResetRun;encryptedSnapshotRetained=$receipt.snapshot;removedFiles=$removed;completedAt=[DateTime]::UtcNow.ToString('o')}
    foreach ($directory in @($source,$restored)) {
        [IO.File]::WriteAllText((Join-Path $directory 'plaintext-cleanup-receipt.json'), (ConvertTo-Json -Depth 5 -InputObject $cleanup))
    }
    Write-Host "Removed $($removed.Count) verified plaintext backup/restore files for run $run; encrypted recovery retained."
}
