param(
    [Parameter(Mandatory)][ValidateSet('Start', 'Press', 'WaitWindow', 'Crash', 'Resume', 'ExpireLocal', 'State', 'Reset', 'ChatText', 'Say', 'Consent')][string]$Action,
    [string]$Link,          # Start: the support link (https://.../#support=<token>)
    [string]$Installer,     # Start: the setup executable to run as the download (path or URL)
    [string]$Server,        # Start: a non-default server (local testing only)
    [string]$Title,         # Press / WaitWindow: part of a window title
    [string]$Button,        # Press: the button's text
    [string]$Text,          # Say: what the person types into the chat box
    [switch]$Sound,         # Consent: also tick "share this computer's sound"
    [string]$Mode = 'window', # Crash: window | all
    [int]$Seconds = 20
)
# The "second device" half of the acceptance scenarios (docs/testing.md). It plays the person being helped: it fetches
# the support program the way the download page does, runs it, answers its dialogs, breaks it on purpose, and reports
# what is left on the computer. Every action prints one line of JSON. It only ever touches Beacon Support's own folder.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$supportRoot = Join-Path $env:LOCALAPPDATA 'BeaconSupport'
$downloads = Join-Path $env:TEMP 'beacon-acceptance-downloads'

Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Dlg {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc p, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, StringBuilder l);
  // GetWindowText does not read another process's edit control; WM_GETTEXT does.
  static string Content(IntPtr h) { var s = new StringBuilder(8192); SendMessage(h, 0x000D, (IntPtr)8192, s); return s.ToString(); }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  static string Class(IntPtr h) { var s = new StringBuilder(64); GetClassName(h, s, 64); return s.ToString(); }
  [DllImport("user32.dll")] static extern int GetDlgCtrlID(IntPtr h);
  // Presses the control with this id (a check box in the consent window has no text to find it by).
  public static bool ClickId(string title, int id) {
    bool done = false;
    EnumWindows((w, _) => {
      if (!IsWindowVisible(w) || !Text(w).Contains(title)) return true;
      EnumChildWindows(w, (c, __) => {
        if (GetDlgCtrlID(c) == id) { SendMessage(c, 0x00F5, IntPtr.Zero, IntPtr.Zero); done = true; return false; }
        return true;
      }, IntPtr.Zero);
      return !done;
    }, IntPtr.Zero);
    return done;
  }
  // An Edit control by its id (105 = the conversation, 104 = the box the person types in) in the window with this title.
  public static string Edit(string title, int id, string set, bool write) {
    string result = null;
    EnumWindows((w, _) => {
      if (!IsWindowVisible(w) || !Text(w).Contains(title)) return true;
      EnumChildWindows(w, (c, __) => {
        if (Class(c) != "Edit") return true;
        if (GetDlgCtrlID(c) != id) return true;
        // PowerShell turns $null into "" for a string argument, so writing is an explicit flag.
        if (write) SendMessage(c, 0x000C, IntPtr.Zero, set);
        result = Content(c);
        return false;
      }, IntPtr.Zero);
      return result == null;
    }, IntPtr.Zero);
    return result;
  }
  static string Text(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
  public static bool Exists(string title) {
    bool found = false;
    EnumWindows((w, _) => { if (IsWindowVisible(w) && Text(w).Contains(title)) { found = true; return false; } return true; }, IntPtr.Zero);
    return found;
  }
  public static bool Click(string title, string button) {
    bool done = false;
    EnumWindows((w, _) => {
      if (!IsWindowVisible(w) || !Text(w).Contains(title)) return true;
      EnumChildWindows(w, (c, __) => {
        if (Text(c).Replace("&", "") == button) { SendMessage(c, 0x00F5, IntPtr.Zero, IntPtr.Zero); done = true; return false; }
        return true;
      }, IntPtr.Zero);
      return !done;
    }, IntPtr.Zero);
    return done;
  }
}
'@

function Out-Json($value) { $value | ConvertTo-Json -Compress -Depth 4 }
function Beacon-Processes { Get-Process -Name 'beacon-remote-*', 'BeaconSupport-*' -ErrorAction SilentlyContinue }
function Wait-Until([scriptblock]$condition, [int]$timeout) {
    $end = (Get-Date).AddSeconds($timeout)
    while ((Get-Date) -lt $end) { if (& $condition) { return $true }; Start-Sleep -Milliseconds 300 }
    return $false
}
function Run-Once-Command {
    $key = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -ErrorAction SilentlyContinue
    if ($key -and $key.PSObject.Properties.Name -contains 'BeaconSupportCleanup') { return $key.BeaconSupportCleanup }
    return $null
}

switch ($Action) {
    'Start' {
        if ($Link -notmatch '#support=([A-Za-z0-9_-]{32})$') { throw 'Link must end in #support=<32 character token>' }
        $token = $Matches[1]
        New-Item -ItemType Directory -Force $downloads | Out-Null
        # The download page names the file after the link; so does this.
        $file = Join-Path $downloads "BeaconSupport-$token.exe"
        if ($Installer -match '^https?://') { Invoke-WebRequest -UseBasicParsing -Uri $Installer -OutFile $file } else { Copy-Item -LiteralPath $Installer -Destination $file -Force }
        if ($Server) { $env:BEACON_SERVER = $Server }
        Start-Process -FilePath $file
        $answered = Wait-Until { [Dlg]::Click('Temporary support', 'Yes') } $Seconds
        Out-Json @{ started = $true; answeredYes = $answered; file = $file }
    }
    'Press' { Out-Json @{ pressed = (Wait-Until { [Dlg]::Click($Title, $Button) } $Seconds) } }
    'ChatText' { Out-Json @{ text = [Dlg]::Edit('Temporary support', 105, '', $false) } }
    'Say' {
        [void][Dlg]::Edit('Temporary support', 104, $Text, $true)
        Out-Json @{ sent = (Wait-Until { [Dlg]::Click('Temporary support', 'Send') } 5) }
    }
    'Consent' {
        # The person reads the request and allows it, optionally sharing sound too (control id 205 in the window).
        $found = Wait-Until { [Dlg]::Exists('incoming connection request') } $Seconds
        if (-not $found) { Out-Json @{ allowed = $false; reason = 'no request appeared' }; return }
        if ($Sound) { [void][Dlg]::ClickId('incoming connection request', 205) }
        Out-Json @{ allowed = (Wait-Until { [Dlg]::Click('incoming connection request', 'Allow once') } 5); sound = [bool]$Sound }
    }
    'WaitWindow' { Out-Json @{ found = (Wait-Until { [Dlg]::Exists($Title) } $Seconds) } }
    'Crash' {
        if ($Mode -eq 'all') { Beacon-Processes | Stop-Process -Force }
        else { Get-Process -Name 'beacon-remote-host' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Stop-Process -Force }
        Out-Json @{ crashed = $Mode }
    }
    'Resume' {
        # What Windows does at the next sign-in after a restart.
        $command = Run-Once-Command
        if (-not $command) { Out-Json @{ resumed = $false; reason = 'no RunOnce entry' }; return }
        [void][System.Diagnostics.Process]::Start('cmd.exe', "/c start `"`" $command")
        Out-Json @{ resumed = $true }
    }
    'ExpireLocal' {
        $record = Get-ChildItem (Join-Path $supportRoot '*\support.json') | Select-Object -First 1
        $value = Get-Content $record.FullName -Raw | ConvertFrom-Json
        $value.deadline_millis = 1000
        $value | ConvertTo-Json -Compress | Set-Content $record.FullName -Encoding ascii
        Out-Json @{ expired = $true }
    }
    'State' {
        $runOnce = [bool](Run-Once-Command)
        Out-Json @{
            folder = (Test-Path $supportRoot) -and [bool](Get-ChildItem $supportRoot -ErrorAction SilentlyContinue)
            processes = @(Beacon-Processes | ForEach-Object { $_.ProcessName }).Count
            windowOpen = [Dlg]::Exists('Temporary support')
            runOnce = $runOnce
            downloads = @(Get-ChildItem $downloads -Filter 'BeaconSupport-*.exe' -ErrorAction SilentlyContinue).Count
        }
    }
    'Reset' {
        # Between scenarios: leave nothing behind, even if one failed halfway.
        Beacon-Processes | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 1
        if (Test-Path $supportRoot) { Remove-Item $supportRoot -Recurse -Force -ErrorAction SilentlyContinue }
        Remove-Item $downloads -Recurse -Force -ErrorAction SilentlyContinue
        Remove-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\RunOnce' -Name BeaconSupportCleanup -ErrorAction SilentlyContinue
        Out-Json @{ reset = $true }
    }
}
