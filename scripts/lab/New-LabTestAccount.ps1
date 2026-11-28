# Elevated, on the lab laptop: creates the standard (non-admin) local account BeaconTest for Beacon Remote sign-in
# testing. Reads the generated password from a staged file, deletes that file, and records only the outcome.
param([Parameter(Mandatory)][string]$Lab)
$ErrorActionPreference = 'Stop'
$lab = $Lab
$secret = Join-Path $lab 'test-user.secret'
$out = Join-Path $lab 'create-test-user.txt'
try {
    $password = ConvertTo-SecureString ([IO.File]::ReadAllText($secret)) -AsPlainText -Force
    Remove-Item -LiteralPath $secret -Force
    if (Get-LocalUser -Name 'BeaconTest' -ErrorAction SilentlyContinue) {
        Set-LocalUser -Name 'BeaconTest' -Password $password
        $note = 'existing account, password reset'
    } else {
        New-LocalUser -Name 'BeaconTest' -Password $password -FullName 'Beacon Test' `
            -Description 'Beacon Remote lab sign-in testing' -PasswordNeverExpires -AccountNeverExpires | Out-Null
        Add-LocalGroupMember -Group 'Users' -Member 'BeaconTest'
        $note = 'created'
    }
    $groups = (Get-LocalGroup | Where-Object { (Get-LocalGroupMember $_ -ErrorAction SilentlyContinue).Name -match '\\BeaconTest$' }).Name -join ','
    "ok $note groups=$groups" | Set-Content $out -Encoding utf8
} catch {
    Remove-Item -LiteralPath $secret -Force -ErrorAction SilentlyContinue
    "failed $($_.Exception.Message)" | Set-Content $out -Encoding utf8
}
