import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("the device fixture and its generated limited launcher parse; other computers are refused before setup", () => {
  const source = fileURLToPath(
    new URL("./acceptance/Windows-HostFixture.ps1", import.meta.url),
  );
  const powershell = process.platform === "win32" ? "powershell.exe" : "pwsh";
  const invoke = (script) =>
    execFileSync(
      powershell,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      {
        windowsHide: true,
        encoding: "utf8",
        timeout: 20000,
        stdio: "pipe",
        env: { ...process.env, BEACON_FIXTURE_TEST_SOURCE: source },
      },
    );
  assert.throws(
    () =>
      invoke(
        "$ErrorActionPreference='Stop'; throw 'Expected fixture runner failure'; Write-Output 'PASS'",
      ),
    (error) => error.status !== 0,
  );
  const result = invoke(String.raw`
$ErrorActionPreference = 'Stop'
$source = $env:BEACON_FIXTURE_TEST_SOURCE
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Fixture parsing failed' }
$probeSource = Join-Path (Split-Path $source) 'Windows-InputProbe.ps1'
$probeTokens = $null; $probeErrors = $null
$probeAst = [Management.Automation.Language.Parser]::ParseFile($probeSource, [ref]$probeTokens, [ref]$probeErrors)
if ($probeErrors.Count) { throw 'Input probe parsing failed' }
$assignment = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$code' }, $true)
if (-not $assignment) { throw 'Generated launcher missing' }
$root = Join-Path ([IO.Path]::GetTempPath()) 'SyntheticFixture'
$bin = Join-Path $root 'versions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$candidate = [pscustomobject]@{ source = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
$taskName = 'BeaconRemoteAcceptance_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_bbbbbbbb'
$launcher = Invoke-Expression $assignment.Right.Extent.Text
$tokens = $null; $errors = $null
[Management.Automation.Language.Parser]::ParseInput($launcher, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw 'Generated launcher parsing failed' }
if ($launcher -notmatch [regex]::Escape((Join-Path $bin 'beacon-remote-host.exe'))) { throw 'Launcher lost the pinned binary path' }
if ($launcher -notmatch 'Presence ready in') { throw 'Safe timing collector missing' }
if ($env:OS -eq 'Windows_NT') {
  $writer = $probeAst.Find({ param($item) $item -is [Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -eq 'Write-ProbeSnapshot' }, $true)
  if (-not $writer) { throw 'Atomic probe writer missing' }
  Invoke-Expression $writer.Extent.Text
  $snapshot = Join-Path ([IO.Path]::GetTempPath()) ('Beacon-probe-lock-' + [guid]::NewGuid().ToString('N') + '.json')
  $reader = $null
  try {
    if (-not (Write-ProbeSnapshot $snapshot '{"revision":1}')) { throw 'Initial snapshot failed' }
    $reader = [IO.File]::Open($snapshot, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    if (Write-ProbeSnapshot $snapshot '{"revision":2}') { throw 'Locked snapshot unexpectedly replaced' }
    if (([IO.File]::ReadAllText($snapshot) | ConvertFrom-Json).revision -ne 1) { throw 'Snapshot was damaged while a reader held it' }
    $reader.Dispose(); $reader = $null
    if (-not (Write-ProbeSnapshot $snapshot '{"revision":2}')) { throw 'Snapshot did not recover after reader released it' }
    if (([IO.File]::ReadAllText($snapshot) | ConvertFrom-Json).revision -ne 2) { throw 'Recovered snapshot invalid' }
  } finally {
    if ($reader) { $reader.Dispose() }
    foreach ($file in @($snapshot, ($snapshot + '.pending'))) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
  }
  # Exercise the actual bootstrap expression with a real console child, a path
  # containing spaces and a completion marker. No device/profile/task is used.
  $probeRoot = Join-Path ([IO.Path]::GetTempPath()) ('Beacon hidden launch ' + [guid]::NewGuid().ToString('N'))
  [IO.Directory]::CreateDirectory($probeRoot) | Out-Null
  $marker = Join-Path $probeRoot 'result.txt'
  $bootstrap = Join-Path $probeRoot 'launcher.vbs'
  $probe = '$ErrorActionPreference="Stop"; Add-Type -TypeDefinition ''using System; using System.Runtime.InteropServices; public static class LaunchProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window); }''; if ([LaunchProbe]::IsWindowVisible([LaunchProbe]::GetConsoleWindow())) { throw "Unexpected visible console" }; [IO.File]::WriteAllText(''' + $marker.Replace("'", "''") + ''', "hidden")'
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($probe))
  foreach ($name in @('$shell', '$command', '$script')) {
    $node = $ast.Find({ param($item) $item -is [Management.Automation.Language.AssignmentStatementAst] -and $item.Left.Extent.Text -eq $name }, $true)
    if (-not $node) { throw 'Windowless bootstrap missing' }
    Set-Variable -Name $name.Substring(1) -Value (Invoke-Expression $node.Right.Extent.Text)
  }
  $process = New-Object Diagnostics.Process
  try {
    [IO.File]::WriteAllText($bootstrap, $script, [Text.Encoding]::Unicode)
    $process.StartInfo.FileName = Join-Path $env:SystemRoot 'System32/wscript.exe'
    $process.StartInfo.Arguments = '//B //NoLogo "' + $bootstrap + '"'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    [void]$process.Start()
    if (-not $process.WaitForExit(15000)) { $process.Kill(); throw 'Windowless bootstrap timed out' }
    if ($process.ExitCode -ne 0 -or -not (Test-Path -LiteralPath $marker) -or [IO.File]::ReadAllText($marker) -ne 'hidden') { throw 'Windowless bootstrap failed' }
  } finally {
    $process.Dispose()
    foreach ($file in @($bootstrap, $marker)) { if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file } }
    Remove-Item -LiteralPath $probeRoot
  }
}
if ($env:COMPUTERNAME -ieq 'SURFIENA') { throw 'Do not run the refusal test on the designated device' }
$refused = $false
try { & $source -Action Prepare -Run 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } catch { $refused = $_.Exception.Message -like '*restricted to the designated Surfiena*' }
if (-not $refused) { throw 'Wrong-device setup was not refused' }
$refused = $false
try { & $probeSource -Run 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' -Probe 'bbbbbbbb' } catch { $refused = $_.Exception.Message -like '*restricted to the designated Surfiena*' }
if (-not $refused) { throw 'Wrong-device input probe was not refused' }
Write-Output 'PASS: launcher syntax and wrong-device refusal'
`);
  assert.match(result, /PASS: launcher syntax and wrong-device refusal/);
});
