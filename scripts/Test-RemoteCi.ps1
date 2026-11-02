[CmdletBinding(DefaultParameterSetName = 'All')]
param(
    [Parameter(ParameterSetName = 'ControlPlane')]
    [switch]$ControlPlaneOnly,
    [Parameter(ParameterSetName = 'Native')]
    [switch]$NativeOnly
)

$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path $PSScriptRoot -Parent
Push-Location $repositoryRoot
$previousEnvironment = @{}
Get-ChildItem Env: | ForEach-Object { $previousEnvironment[$_.Name] = $_.Value }
try {
    if (-not $NativeOnly) {
        # Fixed Remote test database, never inherited View or production credentials.
        $localTestDatabase = & node --input-type=module -e "import { readLocalDatabase, localDatabaseUrl } from './scripts/local-database.mjs'; const { password } = await readLocalDatabase(); console.log(localDatabaseUrl(password, 'beacon_remote_test'));"
        if ($LASTEXITCODE -ne 0) { throw 'Cannot load the private local test database configuration.' }
        $env:TEST_DATABASE_URL = $localTestDatabase.Trim()
        foreach ($arguments in @(
            @('install', '--frozen-lockfile'),
            @('check'),
            @('audit', '--audit-level', 'high')
        )) {
            & pnpm.cmd @arguments
            if ($LASTEXITCODE -ne 0) { throw "Remote control-plane check failed: $($arguments -join ' ')" }
        }
    }
    & cargo fmt --all -- --check
    if ($LASTEXITCODE -ne 0) { throw 'Rust formatting failed' }
    if ($ControlPlaneOnly) {
        Write-Host 'Control-plane checks passed. Native compilation, Clippy and tests were explicitly not run.'
        return
    }
    . (Join-Path $PSScriptRoot 'Native-Toolchain.ps1')
    Initialize-BeaconNativeToolchain
    foreach ($arguments in @(
        @('clippy', '--workspace', '--all-targets', '--locked', '--', '-D', 'warnings'),
        @('test', '--workspace', '--locked'),
        @('build', '--workspace', '--release', '--locked')
    )) {
        & cargo @arguments
        if ($LASTEXITCODE -ne 0) { throw "Remote native check failed: $($arguments -join ' ')" }
    }
    if ($NativeOnly) {
        Write-Host 'Local Remote native CI commands passed. Control-plane checks were explicitly not run; real desktop acceptance is a separate gate.'
    } else {
        Write-Host 'Local Remote control-plane and native CI commands passed. Real desktop acceptance is a separate gate.'
    }
} finally {
    foreach ($variable in @(Get-ChildItem Env:)) {
        if (-not $previousEnvironment.ContainsKey($variable.Name)) {
            [Environment]::SetEnvironmentVariable($variable.Name, $null, 'Process')
        }
    }
    foreach ($name in $previousEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
    }
    Pop-Location
}
