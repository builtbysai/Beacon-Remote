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
        $env:TEST_DATABASE_URL = 'postgresql://remote_dev:development-only@127.0.0.1:5433/beacon_remote_test'
        foreach ($arguments in @(
            @('install', '--frozen-lockfile'),
            @('check'),
            @('audit', '--prod', '--audit-level', 'high')
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
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) {
        throw 'Native CI requires installed Microsoft C++ Build Tools and Windows SDK. Complete the authorized installer before rerunning.'
    }
    $installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installation) { throw 'No installed MSVC C++ workload found' }
    $developerEnvironment = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
    # Environment is imported only into this script process, never system settings.
    $lines = & $env:ComSpec /d /c "call `"$developerEnvironment`" >nul && set"
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize MSVC/Windows SDK environment' }
    foreach ($line in $lines) {
        if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
    }
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
