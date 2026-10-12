[CmdletBinding()]
param([ValidateSet('pair', 'run')][string]$Command = 'run')
$ErrorActionPreference = 'Stop'
# Development packages never inherit an input capability enablement flag.
Remove-Item Env:REMOTE_DEV_CONTROL -ErrorAction SilentlyContinue
try {
    & (Join-Path $PSScriptRoot 'beacon-remote-agent.exe') $Command
    if ($LASTEXITCODE -ne 0) { throw "Beacon Remote exited with code $LASTEXITCODE" }
} catch {
    Write-Error $_ -ErrorAction Continue
    Read-Host 'Press Enter to close'
    exit 1
}
