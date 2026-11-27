# Beacon lab helper. Runs in the signed-in user's own desktop session on the test laptop and does what an SSH session
# cannot: look at the screen and press keys and mouse buttons. It has no network port. It only reads command files that
# the same Windows user (over SSH) places in its spool folder, and answers with files next to them.
#
# Visible: a tray icon says it is running; its menu pauses or stops it. Everything runs as this user, so it cannot touch
# elevated (administrator) windows, the UAC prompt, the lock screen or the Windows sign-in screen.
#
# Folder layout under -Root (default %USERPROFILE%\BeaconLab):
#   spool\in\<id>.json   commands, oldest first       spool\out\<id>.json + <id>.png   answers
#   PAUSE  (file)        refuse input and screenshots  STOP (file)  exit
#   agent.log            one line per command (typed text is never logged, only its length)
param([string]$Root = (Join-Path $env:USERPROFILE 'BeaconLab'))
$ErrorActionPreference = 'Stop'
$version = 1
Add-Type -AssemblyName System.Windows.Forms, System.Drawing
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class Lab {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc proc, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern short VkKeyScan(char ch);
  delegate bool EnumProc(IntPtr h, IntPtr p);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT { public int dx, dy; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KEYBDINPUT { public ushort vk, scan; public uint flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct INPUTUNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public INPUTUNION u; }
  public class Win { public long Handle; public string Title; public string Class; public uint Pid; public int L, T, R, B; }
  public static List<Win> Windows() {
    var list = new List<Win>();
    EnumWindows((h, p) => {
      if (!IsWindowVisible(h)) return true;
      var t = new StringBuilder(256); GetWindowText(h, t, 256);
      if (t.Length == 0) return true;
      var c = new StringBuilder(128); GetClassName(h, c, 128);
      RECT r; GetWindowRect(h, out r);
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(new Win { Handle = h.ToInt64(), Title = t.ToString(), Class = c.ToString(), Pid = pid, L = r.L, T = r.T, R = r.R, B = r.B });
      return true;
    }, IntPtr.Zero);
    return list;
  }
  static INPUT Key(ushort vk, ushort scan, uint flags) {
    var i = new INPUT { type = 1 };
    i.u.ki = new KEYBDINPUT { vk = vk, scan = scan, flags = flags };
    return i;
  }
  public static void TypeText(string text) {
    var inputs = new List<INPUT>();
    foreach (char ch in text) {
      short scan = VkKeyScan(ch);
      int vk = scan & 0xFF, state = (scan >> 8) & 0xFF;
      // Plain keys (with Shift) go in as real key presses, which every app accepts; anything else as Unicode.
      if (scan != -1 && vk != 0xFF && (state & 6) == 0) {
        if ((state & 1) != 0) inputs.Add(Key(0x10, 0, 0));
        inputs.Add(Key((ushort)vk, 0, 0));
        inputs.Add(Key((ushort)vk, 0, 0x0002));
        if ((state & 1) != 0) inputs.Add(Key(0x10, 0, 0x0002));
      } else {
        inputs.Add(Key(0, ch, 0x0004));
        inputs.Add(Key(0, ch, 0x0004 | 0x0002));
      }
    }
    if (inputs.Count > 0) SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Press(ushort[] modifiers, ushort vk, bool extended) {
    var inputs = new List<INPUT>();
    foreach (var m in modifiers) inputs.Add(Key(m, 0, 0));
    inputs.Add(Key(vk, 0, extended ? 0x0001u : 0u));
    inputs.Add(Key(vk, 0, (extended ? 0x0001u : 0u) | 0x0002u));
    for (int i = modifiers.Length - 1; i >= 0; i--) inputs.Add(Key(modifiers[i], 0, 0x0002));
    SendInput((uint)inputs.Count, inputs.ToArray(), Marshal.SizeOf(typeof(INPUT)));
  }
}
'@
[void][Lab]::SetProcessDPIAware()

$spoolIn = Join-Path $Root 'spool\in'
$spoolOut = Join-Path $Root 'spool\out'
$log = Join-Path $Root 'agent.log'
foreach ($d in $spoolIn, $spoolOut) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
# Only this user (and the system) may use the folder.
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $Root /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
$mutex = New-Object Threading.Mutex($false, "Local\BeaconLabAgent-$sid")
if (-not $mutex.WaitOne(0)) { return }

function Write-Log([string]$line) {
    Add-Content -LiteralPath $log -Value ("{0:o} {1}" -f (Get-Date), $line) -Encoding utf8
    if ((Get-Item -LiteralPath $log).Length -gt 2MB) { Move-Item -LiteralPath $log -Destination "$log.old" -Force }
}
$keys = @{
    enter = 0x0D; esc = 0x1B; escape = 0x1B; tab = 0x09; space = 0x20; backspace = 0x08; delete = 0x2E; del = 0x2E
    left = 0x25; up = 0x26; right = 0x27; down = 0x28; home = 0x24; end = 0x23; pageup = 0x21; pagedown = 0x22
    insert = 0x2D; win = 0x5B; ctrl = 0x11; alt = 0x12; shift = 0x10
}
1..12 | ForEach-Object { $keys["f$_"] = 0x6F + $_ }
$extended = 'left', 'up', 'right', 'down', 'home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'del'

function Find-Window([string]$title) {
    $match = [Lab]::Windows() | Where-Object { $_.Title -like "*$title*" } | Select-Object -First 1
    if (-not $match) { throw "No visible window with a title containing '$title'." }
    $match
}
function Save-Shot($rect, [string]$path, [double]$scale, $handle) {
    $w = $rect.R - $rect.L; $h = $rect.B - $rect.T
    if ($w -le 0 -or $h -le 0) { throw 'Empty region.' }
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp)
    $printed = $false
    if ($handle) {
        # Ask the window to draw itself, so other windows lying over it are not captured.
        $hdc = $g.GetHdc()
        $printed = [Lab]::PrintWindow([IntPtr]$handle, $hdc, 2)
        $g.ReleaseHdc($hdc)
    }
    if (-not $printed) { $g.CopyFromScreen($rect.L, $rect.T, 0, 0, $bmp.Size) }
    $g.Dispose()
    if ($scale -gt 0 -and $scale -ne 1) {
        $small = New-Object Drawing.Bitmap ([int]($w * $scale)), ([int]($h * $scale))
        $sg = [Drawing.Graphics]::FromImage($small)
        $sg.InterpolationMode = 'HighQualityBicubic'
        $sg.DrawImage($bmp, 0, 0, $small.Width, $small.Height)
        $sg.Dispose(); $bmp.Dispose(); $bmp = $small
    }
    $bmp.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    $size = @{ width = $bmp.Width; height = $bmp.Height; windowOnly = $printed }
    $bmp.Dispose()
    $size
}
# Input goes only to the window the caller names: it is raised, and the call fails if another window still has the focus.
function Confirm-Focus($cmd) {
    if (-not $cmd.window) { return }
    $win = Find-Window $cmd.window
    [void][Lab]::ShowWindow([IntPtr]$win.Handle, 9)
    [void][Lab]::SetForegroundWindow([IntPtr]$win.Handle)
    Start-Sleep -Milliseconds 250
    if ([Lab]::GetForegroundWindow().ToInt64() -ne $win.Handle) { throw "The window '$($win.Title)' could not take the focus; nothing was sent." }
    $win
}
function Invoke-Op($cmd) {
    $paused = Test-Path -LiteralPath (Join-Path $Root 'PAUSE')
    $result = @{ ok = $true }
    switch ($cmd.op) {
        'ping' {
            $result.user = "$env:USERDOMAIN\$env:USERNAME"; $result.computer = $env:COMPUTERNAME
            $result.session = (Get-Process -Id $PID).SessionId; $result.version = $version
            $result.paused = $paused
            $screen = [Windows.Forms.SystemInformation]::VirtualScreen
            $result.screen = @{ left = $screen.Left; top = $screen.Top; width = $screen.Width; height = $screen.Height }
        }
        'stop' { $result.stopping = $true; $script:stopRequested = $true }
        default {
            if ($paused) { throw 'Paused by the person at this computer.' }
            switch ($cmd.op) {
                'windows' {
                    $result.windows = @([Lab]::Windows() | ForEach-Object {
                        @{ handle = $_.Handle; title = $_.Title; class = $_.Class; pid = $_.Pid; left = $_.L; top = $_.T; width = $_.R - $_.L; height = $_.B - $_.T }
                    })
                }
                'screenshot' {
                    $png = Join-Path $spoolOut "$($cmd.id).png"
                    $handle = $null
                    if ($cmd.window) {
                        $win = Find-Window $cmd.window
                        $handle = $win.Handle
                        if ($cmd.raise) { [void][Lab]::ShowWindow([IntPtr]$win.Handle, 9); [void][Lab]::SetForegroundWindow([IntPtr]$win.Handle); Start-Sleep -Milliseconds 400; $win = Find-Window $cmd.window; $handle = $win.Handle }
                        $rect = @{ L = $win.L; T = $win.T; R = $win.R; B = $win.B }
                        $result.window = $win.Title
                    } elseif ($cmd.region) {
                        $r = $cmd.region
                        $rect = @{ L = [int]$r[0]; T = [int]$r[1]; R = [int]$r[0] + [int]$r[2]; B = [int]$r[1] + [int]$r[3] }
                    } else {
                        $s = [Windows.Forms.SystemInformation]::VirtualScreen
                        $rect = @{ L = $s.Left; T = $s.Top; R = $s.Right; B = $s.Bottom }
                    }
                    $result.image = Save-Shot $rect $png ([double]$cmd.scale) $handle
                    $result.origin = @{ x = $rect.L; y = $rect.T }
                }
                'move' { [void][Lab]::SetCursorPos([int]$cmd.x, [int]$cmd.y) }
                'click' {
                    $target = Confirm-Focus $cmd
                    if ($target -and ($cmd.x -lt $target.L -or $cmd.x -ge $target.R -or $cmd.y -lt $target.T -or $cmd.y -ge $target.B)) { throw 'The click is outside the named window.' }
                    [void][Lab]::SetCursorPos([int]$cmd.x, [int]$cmd.y)
                    Start-Sleep -Milliseconds 40
                    $down, $up = switch ($cmd.button) { 'right' { 0x0008, 0x0010 } 'middle' { 0x0020, 0x0040 } default { 0x0002, 0x0004 } }
                    $times = if ($cmd.double) { 2 } else { 1 }
                    1..$times | ForEach-Object {
                        [Lab]::mouse_event($down, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 30
                        [Lab]::mouse_event($up, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60
                    }
                }
                'drag' {
                    [void][Lab]::SetCursorPos([int]$cmd.x1, [int]$cmd.y1); Start-Sleep -Milliseconds 60
                    [Lab]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
                    foreach ($step in 1..10) {
                        [void][Lab]::SetCursorPos([int]($cmd.x1 + ($cmd.x2 - $cmd.x1) * $step / 10), [int]($cmd.y1 + ($cmd.y2 - $cmd.y1) * $step / 10))
                        Start-Sleep -Milliseconds 20
                    }
                    [Lab]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
                }
                'scroll' {
                    [void][Lab]::SetCursorPos([int]$cmd.x, [int]$cmd.y)
                    [Lab]::mouse_event(0x0800, 0, 0, [int]$cmd.dy, [UIntPtr]::Zero)
                }
                'type' { [void](Confirm-Focus $cmd); [Lab]::TypeText([string]$cmd.text) }
                'key' {
                    [void](Confirm-Focus $cmd)
                    $parts = @(([string]$cmd.combo).ToLower().Split('+') | ForEach-Object { $_.Trim() })
                    $last = $parts[-1]
                    $modifierNames = if ($parts.Count -gt 1) { $parts[0..($parts.Count - 2)] } else { @() }
                    $mods = @($modifierNames | Where-Object { $_ } | ForEach-Object {
                        if (-not $keys.ContainsKey($_)) { throw "Unknown modifier '$_'." }
                        [uint16]$keys[$_]
                    })
                    $vk = if ($keys.ContainsKey($last)) { [uint16]$keys[$last] }
                          elseif ($last.Length -eq 1) { [uint16][char]$last.ToUpper() }
                          else { throw "Unknown key '$last'." }
                    [Lab]::Press($mods, $vk, ($extended -contains $last))
                }
                'launch' {
                    $p = if ($cmd.args) { Start-Process -FilePath $cmd.path -ArgumentList @($cmd.args) -PassThru } else { Start-Process -FilePath $cmd.path -PassThru }
                    $result.pid = $p.Id
                }
                'close' { [void][Lab]::PostMessage([IntPtr](Find-Window $cmd.window).Handle, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero) }
                'foreground' {
                    $handle = [Lab]::GetForegroundWindow().ToInt64()
                    $front = [Lab]::Windows() | Where-Object { $_.Handle -eq $handle } | Select-Object -First 1
                    $result.title = if ($front) { $front.Title } else { '' }
                    $result.class = if ($front) { $front.Class } else { '' }
                }
                'raise' { $win = Find-Window $cmd.window; [void][Lab]::ShowWindow([IntPtr]$win.Handle, 9); [void][Lab]::SetForegroundWindow([IntPtr]$win.Handle) }
                default { throw "Unknown op '$($cmd.op)'." }
            }
        }
    }
    $result
}

$script:stopRequested = $false
function Process-Spool {
    if (Test-Path -LiteralPath (Join-Path $Root 'STOP')) { $script:stopRequested = $true; return }
    Get-ChildItem -LiteralPath $spoolIn -Filter '*.json' | Sort-Object LastWriteTime | Select-Object -First 4 | ForEach-Object {
        $id = $_.BaseName
        try {
            $cmd = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
            $cmd | Add-Member -NotePropertyName id -NotePropertyValue $id -Force
            $detail = if ($cmd.op -eq 'type') { "len=$(([string]$cmd.text).Length)" } else { ($cmd | Select-Object * -ExcludeProperty id | ConvertTo-Json -Compress) }
            Write-Log "$id $($cmd.op) $detail"
            $answer = Invoke-Op $cmd
        } catch {
            $answer = @{ ok = $false; error = $_.Exception.Message }
            Write-Log "$id failed: $($_.Exception.Message)"
        }
        $answer | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $spoolOut "$id.json") -Encoding utf8
        Remove-Item -LiteralPath $_.FullName -Force
    }
    # Answers nobody collected go after an hour.
    Get-ChildItem -LiteralPath $spoolOut -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddHours(-1) } | Remove-Item -Force -ErrorAction SilentlyContinue
}

[Windows.Forms.Application]::EnableVisualStyles()
$tray = New-Object Windows.Forms.NotifyIcon
$tray.Icon = [Drawing.SystemIcons]::Shield
$tray.Text = 'Beacon lab helper (test laptop)'
$menu = New-Object Windows.Forms.ContextMenuStrip
$pause = $menu.Items.Add('Pause (refuse input and screenshots)')
$stop = $menu.Items.Add('Stop the lab helper')
$tray.ContextMenuStrip = $menu
$pause.Add_Click({
    $flag = Join-Path $Root 'PAUSE'
    if (Test-Path -LiteralPath $flag) { Remove-Item -LiteralPath $flag -Force; $pause.Text = 'Pause (refuse input and screenshots)' }
    else { New-Item -ItemType File -Path $flag | Out-Null; $pause.Text = 'Resume' }
})
$stop.Add_Click({ $script:stopRequested = $true })
$tray.Visible = $true
Write-Log "started v$version as $env:USERDOMAIN\$env:USERNAME session $((Get-Process -Id $PID).SessionId)"
$timer = New-Object Windows.Forms.Timer
$timer.Interval = 150
$timer.Add_Tick({
    try { Process-Spool } catch { Write-Log "loop error: $($_.Exception.Message)" }
    if ($script:stopRequested) { $timer.Stop(); [Windows.Forms.Application]::ExitThread() }
})
$timer.Start()
try { [Windows.Forms.Application]::Run() } finally {
    $tray.Visible = $false; $tray.Dispose()
    Write-Log 'stopped'
    Remove-Item -LiteralPath (Join-Path $Root 'STOP') -Force -ErrorAction SilentlyContinue
    $mutex.ReleaseMutex()
}
