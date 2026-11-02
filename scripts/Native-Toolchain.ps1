# Dot-source to make the installed native toolchain available in this process only.
function Initialize-BeaconNativeToolchain {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path -LiteralPath $vswhere)) { throw 'Installed MSVC C++ Build Tools and Windows SDK are required.' }
    $installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if (-not $installation) { throw 'No installed MSVC C++ workload found.' }
    $developerEnvironment = Join-Path $installation 'VC\Auxiliary\Build\vcvars64.bat'
    $lines = & $env:ComSpec /d /c "call `"$developerEnvironment`" >nul && set"
    if ($LASTEXITCODE -ne 0) { throw 'Could not initialize MSVC/Windows SDK environment.' }
    foreach ($line in $lines) {
        if ($line -match '^([^=]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
    }
    if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
        $vsCmake = Join-Path $installation 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin'
        if (Test-Path -LiteralPath $vsCmake) { [Environment]::SetEnvironmentVariable('PATH', "$vsCmake;$env:PATH", 'Process') }
    }
}
