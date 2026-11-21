param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$Run,
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{8}$')][string]$Probe
)
# Harmless interactive test target. No UI automation, consent approval, input
# injection, recording of arbitrary text, installed identities or system changes.
$ErrorActionPreference = 'Stop'
if ($env:COMPUTERNAME -ine 'SURFIENA') { throw 'This probe is restricted to the designated Surfiena device.' }
if (-not [Environment]::UserInteractive -or (Get-Process -Id $PID).SessionId -eq 0) { throw 'A signed-in interactive session is required.' }
$root = Join-Path $env:USERPROFILE "BeaconRemoteAcceptance\$Run"
$ancestor = [IO.Path]::GetFullPath($root)
while ($ancestor) {
    if ((Test-Path -LiteralPath $ancestor) -and ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked fixture paths are refused.' }
    $parent = Split-Path -Parent $ancestor
    if ($parent -eq $ancestor) { break }
    $ancestor = $parent
}
$owner = Get-Content -LiteralPath (Join-Path $root 'ownership.json') -Raw | ConvertFrom-Json
if ($owner.run -ne $Run -or $owner.computer -ine 'SURFIENA' -or $owner.kind -ne 'beacon-remote-device-fixture-v1') { throw 'Owned fixture metadata required.' }
$output = Join-Path $root "input-probe-$Probe.json"
$stop = Join-Path $root "input-probe-$Probe.stop"
if ((Test-Path -LiteralPath $output) -or (Test-Path -LiteralPath ($output + '.pending')) -or (Test-Path -LiteralPath $stop)) { throw 'Existing probe refused.' }
function Write-ProbeSnapshot([string]$Path, [string]$Value) {
    # Publish complete snapshots. A reader that briefly denies replacement must
    # leave the previous snapshot intact, not crash the interactive test window.
    $temporary = $Path + '.pending'
    try {
        [IO.File]::WriteAllText($temporary, $Value, [Text.Encoding]::UTF8)
        if (Test-Path -LiteralPath $Path) { [IO.File]::Replace($temporary, $Path, [NullString]::Value) }
        else { [IO.File]::Move($temporary, $Path) }
        return $true
    } catch [IO.IOException] { return $false }
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class BeaconInputProbe {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
}
'@
$form = New-Object Windows.Forms.Form
$form.Text = 'Beacon Remote input test'
$form.Size = New-Object Drawing.Size(640, 300)
$form.StartPosition = 'CenterScreen'
$label = New-Object Windows.Forms.Label
$label.Text = 'Click the box after approving control. The test types only: beacon'
$label.Dock = 'Top'
$label.Height = 55
$box = New-Object Windows.Forms.TextBox
$box.Multiline = $true
$box.Dock = 'Fill'
$box.MaxLength = 80
$box.Font = New-Object Drawing.Font('Segoe UI', 24)
$form.Controls.Add($box)
$form.Controls.Add($label)
$state = @{ down = 0; up = 0; shiftDownSeen = $false; shiftUpSeen = $false }
$box.Add_KeyDown({ param($sender, $event) $state.down++; if ($event.KeyCode -eq 'ShiftKey') { $state.shiftDownSeen = $true } })
$box.Add_KeyUp({ param($sender, $event) $state.up++; if ($event.KeyCode -eq 'ShiftKey') { $state.shiftUpSeen = $true } })
$deadline = [DateTime]::UtcNow.AddMinutes(5)
function Write-Probe([bool]$closed) {
    # Store booleans/counters only. Never retain text, key identities, screenshots
    # or input received by any other app.
    $value = @{ pid=$PID; session=(Get-Process -Id $PID).SessionId; at=[DateTime]::UtcNow.ToString('o'); closed=$closed;
       focused=($box.Focused -and [BeaconInputProbe]::GetForegroundWindow() -eq $form.Handle);
       expectedTextMatched=($box.Text -ceq 'beacon'); keyDownCount=$state.down; keyUpCount=$state.up;
       shiftDownSeen=$state.shiftDownSeen; shiftUpSeen=$state.shiftUpSeen;
       shiftHeld=([BeaconInputProbe]::GetAsyncKeyState(0x10) -lt 0)
    } | ConvertTo-Json -Compress
    [void](Write-ProbeSnapshot $output $value)
}
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 200
$timer.Add_Tick({ Write-Probe $false; if ([DateTime]::UtcNow -ge $deadline -or (Test-Path -LiteralPath $stop)) { $form.Close() } })
$form.Add_Shown({
    # A task-launched window is not foreground by default; raise it so the box
    # can take focus without an owner click.
    $form.TopMost = $true; $form.Activate(); $form.TopMost = $false
    $box.Focus() | Out-Null; $timer.Start()
})
try { [void]$form.ShowDialog() } finally { $timer.Stop(); Write-Probe $true; $timer.Dispose(); $form.Dispose() }
