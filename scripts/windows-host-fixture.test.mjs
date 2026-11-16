import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("the device fixture and its generated limited launcher parse; other computers are refused before setup", () => {
  const source = fileURLToPath(
    new URL("./acceptance/Windows-HostFixture.ps1", import.meta.url),
  );
  const result = execFileSync(
    process.platform === "win32" ? "powershell.exe" : "pwsh",
    ["-NoProfile", "-NonInteractive", "-Command", "-"],
    {
      windowsHide: true,
      encoding: "utf8",
      timeout: 20000,
      env: { ...process.env, BEACON_FIXTURE_TEST_SOURCE: source },
      input: String.raw`
$ErrorActionPreference = 'Stop'
$source = $env:BEACON_FIXTURE_TEST_SOURCE
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Fixture parsing failed' }
$assignment = $ast.Find({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left.Extent.Text -eq '$code' }, $true)
if (-not $assignment) { throw 'Generated launcher missing' }
$root = Join-Path ([IO.Path]::GetTempPath()) 'SyntheticFixture'
$bin = Join-Path $root 'versions/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$candidate = [pscustomobject]@{ source = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }
$launcher = Invoke-Expression $assignment.Right.Extent.Text
$tokens = $null; $errors = $null
[Management.Automation.Language.Parser]::ParseInput($launcher, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw 'Generated launcher parsing failed' }
if ($launcher -notmatch [regex]::Escape((Join-Path $bin 'beacon-remote-host.exe'))) { throw 'Launcher lost the pinned binary path' }
if ($launcher -notmatch 'Presence ready in') { throw 'Safe timing collector missing' }
if ($env:COMPUTERNAME -ieq 'SURFIENA') { throw 'Do not run the refusal test on the designated device' }
$refused = $false
try { & $source -Action Prepare -Run 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' } catch { $refused = $_.Exception.Message -like '*restricted to the designated Surfiena*' }
if (-not $refused) { throw 'Wrong-device setup was not refused' }
Write-Output 'PASS: launcher syntax and wrong-device refusal'
`,
    },
  );
  assert.match(result, /PASS: launcher syntax and wrong-device refusal/);
});
