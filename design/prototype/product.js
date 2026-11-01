const storageGet = (key) => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
const storageSet = (key, value) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
};
const icon = (id, cl = "") =>
  `<svg class="icon ${cl}" aria-hidden="true"><use href="#ic-${id}"/></svg>`;
const brand = () =>
  `<a href="#home" data-go="home" class="brand brand-link"><img src="beacon-mark.svg" alt=""><span class="brandword">beacon<span>REMOTE</span></span></a>`;
const footer = () =>
  `<footer class="container shell-footer"><span>Beacon Remote · Frontend interaction prototype</span><span><a href="#security" data-go="security">Security</a><a href="#support" data-go="support">Support</a><a href="workspace/index.html">Workspace</a></span></footer>`;
const siteHeader = (minimal = false) =>
  `<header class="top">${brand()}${minimal ? "" : `<nav class="links" id="mobileLinks"><a href="#home" data-go="home">Overview</a><a href="#downloads" data-go="downloads">Download</a><a href="#support" data-go="support">Support</a><a href="#security" data-go="security">Security</a></nav>`}<div class="top-end"><button class="btn ghost icon-only" aria-label="Toggle light and dark appearance" data-action="theme">${icon("moon")}</button><a class="btn ghost label-btn" href="#signin" data-go="signin">Sign in</a><a class="btn blue" href="#signin" data-go="signin">Open workspace ${icon("arrow")}</a>${minimal ? "" : `<button class="btn ghost icon-only mobile-menu" aria-label="Open menu" aria-expanded="false" data-action="menu">${icon("menu")}</button>`}</div></header>`;
const subtop = (label = "") =>
  `<header class="subtop">${brand()}<span class="breadcrumb">/ ${label}</span><span class="spacer"></span><a class="btn ghost slim" href="#home" data-go="home">${icon("back", "small-icon")} Website</a><a class="btn ghost slim" href="workspace/index.html">Workspace ${icon("arrow", "small-icon")}</a></header>`;
const btn = (title, act, kind = "") =>
  `<button type="button" class="btn ${kind}" data-action="${act}">${title}</button>`;
const field = (name, id, type = "text", placeholder = "", val = "") =>
  `<div class="field"><label for="${id}" class="label">${name}</label><input class="input" id="${id}" name="${id}" type="${type}" placeholder="${placeholder}" value="${val}" ${type === "password" ? 'autocomplete="current-password"' : ""}></div>`;
const det = (label, val) =>
  `<div class="detail"><dt>${label}</dt><dd>${val}</dd></div>`;
const shell = (inner, nav = "") => `${siteHeader()}${inner}${footer()}`;
const authShell = (inner) =>
  `${siteHeader(true)}<main class="auth-page"><section class="auth-panel">${inner}</section></main>`;
const panel = (title, body, extra = "") =>
  `<section class="panel"><div class="panel-head"><h3>${title}</h3>${extra}</div><div class="panel-body">${body}</div></section>`;
const hostShell = (inside, notes = "") =>
  `${subtop("Windows host · Interactive preview")}<main class="host-background"><div class="win-stage">${notes ? `<div class="host-help-label">Windows agent preview · ${notes}</div>` : ""}${inside}</div><div class="win-taskbar" aria-hidden="true"><span class="win-start"><span></span><span></span><span></span><span></span></span><img src="beacon-mark.svg" alt=""><span class="win-app">▣</span><span class="win-app">◈</span><span class="win-clock">10:42 AM<br>10/10/2026</span></div></main>`;
const win = (body, title = "Beacon Remote") =>
  `<section class="win-panel" role="region" aria-label="${title}"><header class="win-titlebar"><img src="beacon-mark.svg" alt=""><span>${title}</span><div class="win-controls"><button aria-label="Minimize simulated window" data-action="minimize">−</button><button aria-label="Close simulated window" data-action="minimize">×</button></div></header><div class="win-body">${body}</div></section>`;
const hostPerson = () =>
  `<div class="host-person"><span class="avatar">AL</span><div><strong>Alex Morgan</strong><small>alex.morgan@example.test · Session S-84D2</small></div><span style="margin-left:auto;color:#64809e;font-size:10px">REQUESTER</span></div>`;
const note = (txt) => `<div class="inline-notice">${txt}</div>`;
const code = "482 913";
function home() {
  return shell(
    `<main><section class="container public-hero"><div><div class="eyeline">BEACON / REMOTE</div><h1>Remote access for your computers.</h1><p class="desc">Connect to an enrolled Windows computer from your browser. For one-time help, start an attended support session instead.</p><div class="button-row"><a class="btn blue" href="#signin" data-go="signin">Open my computers ${icon("arrow")}</a><a class="btn" href="#downloads" data-go="downloads">${icon("down")} Download for Windows</a></div><p class="small-caption">Self-hosted control plane · Direct connection when available · Relay fallback</p></div><div class="hero-canvas" aria-label="Sample device inventory interface"><div class="screen"><div class="windowbar"><span class="win-dot"></span><span class="win-dot"></span><span class="win-dot"></span><span class="righttext">remote.builtbysai.com</span></div><div class="screen-content"><aside class="screen-side"><div class="side-item sel">${icon("monitor")} Computers</div><div class="side-item">${icon("clock")} Sessions</div><div class="side-item">${icon("users")} Assist</div><div class="side-item">${icon("shield")} Activity</div></aside><div class="screen-main"><div class="screen-main-title">Computers <span style="font-size:9px;color:#6882a4;font-weight:500">6 online</span></div><div class="screen-grid"><div class="mini-computer active">${icon("monitor", "mini-device")}<strong>STUDIO-WS</strong><em>Online</em><span class="mini-connect">Remote</span></div><div class="mini-computer">${icon("laptop", "mini-device")}<strong>ZBOOK-15</strong><em>Online</em></div><div class="mini-computer">${icon("monitor", "mini-device")}<strong>HOME-PC</strong><em>Online</em></div><div class="mini-computer">${icon("monitor", "mini-device")}<strong>FRONTDESK-02</strong><em>Online</em></div><div class="mini-computer">${icon("monitor", "mini-device")}<strong>LAB-NODE-03</strong><em>Offline</em></div></div><div style="font-size:9px;color:#8193aa;margin-top:14px">EXAMPLE DATA · NOT CONNECTED</div></div></div></div></div></section><div class="flowbar"><div class="container flowbar-inner"><div class="flowcell"><span class="num">01</span><span>Install the Windows host</span></div><div class="flowcell"><span class="num">02</span><span>Pair with your account</span></div><div class="flowcell"><span class="num">03</span><span>Connect from the browser</span></div></div></div><section class="container public-section"><div class="section-head"><h2>Access and support</h2><a href="#support" class="inline-link" data-go="support">Get support ${icon("arrow", "small-icon")}</a></div><div class="feature-strip"><div class="feature">${icon("monitor")}<h3>Unattended access</h3><p>Your enrolled computers appear in the workspace. Access follows each computer's configured permissions.</p></div><div class="feature">${icon("users")}<h3>Attended support</h3><p>One-time support code. The person at the computer approves screen viewing or control.</p></div><div class="feature">${icon("shield")}<h3>Connection controls</h3><p>Device identity, revocation, session history and a visible stop-sharing control on the host.</p></div></div></section><div class="container public-callout"><div><h2>Set up your first computer</h2><p>Windows host installer and account pairing.</p></div><a class="btn blue" href="#downloads" data-go="downloads">Download for Windows ${icon("arrow")}</a></div></main>`,
  );
}
function signin() {
  return authShell(
    `<div class="auth-icon">${icon("lock")}</div><h1>Sign in</h1><p class="intro">Continue to your Beacon Remote workspace.</p><form id="loginForm"><div class="field"><label class="label" for="email">Email address</label><input id="email" name="email" class="input" type="email" autocomplete="username" value="demo@example.test" required></div><div class="field"><div class="flex-between"><label class="label" for="password">Password</label><a class="inline-link tiny" href="#forgot" data-go="forgot">Forgot password?</a></div><div class="password-wrap"><input id="password" name="password" class="input" type="password" autocomplete="current-password" placeholder="Enter password" required><button type="button" aria-label="Show password" data-action="password">${icon("eye")}</button></div></div><div class="flex-between" style="margin-bottom:22px"><label class="checkbox-line"><input type="checkbox" checked> Keep me signed in</label><span class="muted tiny">Demo flow</span></div><button type="submit" class="btn blue full">Continue ${icon("arrow", "small-icon")}</button></form><div class="bottom">New to Beacon Remote? <a class="inline-link" href="#signup" data-go="signup">Create an account</a></div>`,
  );
}
function signup() {
  return authShell(
    `<div class="auth-icon">${icon("user")}</div><h1>Create account</h1><p class="intro">Use an email address you control.</p><form id="signupForm">${field("Email address", "newemail", "email", "name@example.com")}${field("Password", "newpassword", "password", "Minimum 12 characters")}${field("Confirm password", "confirm", "password", "Repeat password")}<label class="checkbox-line" style="margin-bottom:20px"><input type="checkbox" id="terms" required> I agree to the terms and privacy policy</label><button class="btn blue full" type="submit">Create account</button></form><div class="bottom">Already have an account? <a href="#signin" data-go="signin" class="inline-link">Sign in</a></div>`,
  );
}
function forgot() {
  return authShell(
    `<div class="auth-icon">${icon("key")}</div><h1>Reset password</h1><p class="intro">Enter your email. A reset link will be sent if the address has an account.</p><form id="resetForm">${field("Email address", "resetemail", "email", "name@example.com")}<button class="btn blue full" type="submit">Request reset link</button></form><div class="bottom"><a href="#signin" data-go="signin" class="inline-link">Return to sign in</a></div>`,
  );
}
function resetSent() {
  return authShell(
    `<div class="auth-icon">${icon("mail")}</div><h1>Check your email</h1><p class="intro">If an account matches that address, you'll receive password reset instructions.</p><div class="inline-notice">Demo only. No email was sent.</div><button class="btn full" data-action="resetBack">Back to sign in</button>`,
  );
}
function verify() {
  return authShell(
    `<div class="auth-icon">${icon("mail")}</div><h1>Verify your email</h1><p class="intro">A verification link would be sent to the email you entered.</p>${note("Demo only. No email was sent or account created.")}<button class="btn blue full" data-action="verifyDemo">Continue to sign in</button>`,
  );
}
function mfa() {
  return authShell(
    `<div class="auth-icon">${icon("shield")}</div><h1>Two-step verification</h1><p class="intro">Enter the 6-digit code from your authenticator app.</p><form id="mfaForm"><label class="label" for="mfa0">Authenticator code</label><div class="code-grid">${Array.from({ length: 6 }, (_, i) => `<input id="mfa${i}" data-otp="${i}" type="text" inputmode="numeric" pattern="[0-9]" maxlength="1" autocomplete="${i === 0 ? "one-time-code" : "off"}" aria-label="Digit ${i + 1}" required>`).join("")}</div><button class="btn blue full" type="submit">Verify and continue</button></form><div class="flex-between" style="margin-top:22px"><a class="inline-link tiny" href="#recovery-code" data-go="recovery-code">Use recovery code</a><a class="inline-link tiny" href="#signin" data-go="signin">Cancel</a></div>`,
  );
}
function recoveryCode() {
  return authShell(
    `<div class="auth-icon">${icon("key")}</div><h1>Recovery code</h1><p class="intro">Enter one unused recovery code from your security settings.</p><form id="recoveryForm">${field("Recovery code", "recovery", "text", "XXXX-XXXX")}<button class="btn blue full" type="submit">Continue</button></form><div class="bottom"><a href="#mfa" data-go="mfa" class="inline-link">Use authenticator instead</a></div>`,
  );
}
function download() {
  return `${subtop("Download")}<main class="work"><div class="heading"><div><h1>Install Beacon Remote</h1><p>Install the host on the computer you want to access.</p></div><span class="tag">Windows 10 / 11 · x64</span></div><div class="columns"><div>${panel("Windows host", `<div class="device-tile"><span class="square-icon">${icon("monitor")}</span><div><div class="name">Beacon Remote for Windows</div><p>Service + interactive session helper · x64</p></div></div><div style="margin:18px 0">${btn(`${icon("down")} Download installer`, "downloadDemo", "blue")} <span class="tiny muted" style="margin-left:10px">Prototype · installer not included</span></div><div class="timeline-list"><div class="timeline-step"><span class="stepmark">1</span><div><strong>Run the installer</strong><p>Windows requests elevation if needed. The Windows UAC dialog is shown by the operating system, not this website.</p></div></div><div class="timeline-step"><span class="stepmark">2</span><div><strong>Start the host</strong><p>Service: <code class="mono">BeaconRemoteService</code>. The signed-in Windows session runs the capture/input helper.</p></div></div><div class="timeline-step"><span class="stepmark">3</span><div><strong>Pair this computer</strong><p>Enter the time-limited pairing code in your account. Configure who can connect.</p></div></div></div><div style="margin-top:18px"><a href="#enroll" data-go="enroll" class="btn blue">Preview pairing ${icon("arrow")}</a></div>`)}</div><div>${panel("Installer information", `${det("Package", "Windows x64")}${det("Service", '<span class="mono">BeaconRemoteService</span>')}${det("Startup", "Automatic (delayed) · proposed")}${det("Session helper", "Signed-in user session")}${det("Publisher", "Built by Sai · signing pending")}${det("Version", "0.3.7-demo (sample)")}${note("No executable is supplied in this prototype. Actual signatures and SHA-256 checksums must come from release artifacts.")}`)}</div></div></main>`;
}
function enroll() {
  return `${subtop("Pair computer")}<main class="work"><div class="heading"><div><h1>Pair a computer</h1><p>Enter the code shown by Beacon Remote on the Windows host.</p></div><a class="btn" href="#downloads" data-go="downloads">${icon("back")} Installer</a></div><div class="columns"><div>${panel("Pairing request", `<form id="pairForm"><div class="field"><label class="label" for="pairCode">Pairing code</label><input class="input code-entry" id="pairCode" inputmode="numeric" placeholder="000 000" maxlength="7" autocomplete="off" required value="${code}"><p class="fieldhelp">Time-limited. Generated on the host. Sample code for this prototype: ${code}.</p></div><div class="field"><label class="label" for="pairName">Computer name</label><input class="input" id="pairName" value="DESKTOP-SAMPLE" maxlength="44" required></div><div class="field"><label class="label" for="accessMode">Access policy</label><select class="input" id="accessMode"><option>Ask for approval for each session</option><option>Allow unattended access to my account</option></select></div><button class="btn blue" type="submit">Pair computer ${icon("arrow")}</button></form>`)}</div><div>${panel("From the Windows host", `<div class="device-tile"><span class="square-icon">${icon("monitor")}</span><div><div class="name">DESKTOP-SAMPLE</div><p>Windows 11 Pro · Host 0.3.7-demo</p></div></div><p class="muted tiny" style="margin:16px 0 8px">Pairing code shown on this computer</p><div class="number">${code}</div><div class="status">${icon("clock", "small-icon")} Sample code · no server validation</div><div style="margin-top:18px"><a class="inline-link" href="#host" data-go="host">Open Windows host preview ${icon("arrow", "small-icon")}</a></div>`)}</div></div></main>`;
}
function paired() {
  return `${subtop("Paired")}<main class="narrow-work">${panel("Computer added", `<div style="display:flex;align-items:center;gap:12px;margin-bottom:20px"><span class="square-icon" style="background:var(--greenwash);color:var(--green)">${icon("check")}</span><div><h2>DESKTOP-SAMPLE</h2><p class="tiny muted">Saved to Personal workspace · simulated result</p></div></div><div class="device-tile"><span class="square-icon">${icon("monitor")}</span><div><div class="name">DESKTOP-SAMPLE</div><p>Windows 11 Pro · Pending first heartbeat</p></div><span class="tag" style="margin-left:auto">Pending</span></div><div style="margin-top:22px" class="button-row"><a class="btn blue" href="workspace/index.html">View computers ${icon("arrow")}</a><a class="btn" href="#host" data-go="host">Open host</a></div>`)}</main>`;
}
function support() {
  return `${subtop("Support")}<main class="work"><div class="heading"><div><h1>Remote support</h1><p>Join a one-time support session or create a code for someone else.</p></div></div><div class="columns"><div>${panel("Enter a support code", `<form id="joinForm"><div class="field"><label class="label" for="supportCode">Six-digit code</label><input id="supportCode" class="input code-entry" inputmode="numeric" placeholder="000 000" maxlength="7" autocomplete="off" value="${code}" required><p class="fieldhelp">Only enter a code shared by someone you trust.</p></div><button class="btn blue" type="submit">Continue ${icon("arrow")}</button></form><p class="tiny muted" style="margin-top:18px">Demo code: ${code}. A real code must be validated by the server.</p>`)}</div><div>${panel("Need help on this computer?", `<p class="muted" style="font-size:12px;margin-bottom:16px">The person helping you will request access. You can allow viewing only, allow control, or decline.</p><div class="timeline-list"><div class="timeline-step"><span class="stepmark">1</span><div><strong>Open Beacon Remote host</strong><p>Install or launch the Windows support helper.</p></div></div><div class="timeline-step"><span class="stepmark">2</span><div><strong>Share a support code</strong><p>Do not share account passwords.</p></div></div><div class="timeline-step"><span class="stepmark">3</span><div><strong>Approve access locally</strong><p>Permission ends when the session stops.</p></div></div></div><div style="margin-top:16px"><a class="btn" href="#host" data-go="host">Show host interface</a></div>`)}</div></div></main>`;
}
function waiting() {
  return `${subtop("Attended support")}<main class="narrow-work">${panel("Waiting for approval", `<div class="recovery-visual"><span class="square-icon" style="width:50px;height:50px">${icon("clock")}</span><div><h2>Request sent to DESKTOP-SAMPLE</h2><p>The person at the computer must approve screen access. The session will not start until they do.</p></div><span class="tag">Pending · 01:24 remaining (sample)</span></div><div class="button-row" style="justify-content:center"><a href="#host-request" data-go="host-request" class="btn blue">Preview host approval</a>${btn("Cancel request", "cancelWaiting")}</div><div class="line" style="margin:23px 0"></div><div class="detail"><dt>Requester</dt><dd>Alex Morgan · alex.morgan@example.test</dd></div><div class="detail"><dt>Request</dt><dd>View or control after explicit permission</dd></div><div class="detail"><dt>Session</dt><dd class="mono">S-84D2 · Demo</dd></div>`)}</main>`;
}
function host() {
  return hostShell(
    win(
      `<div class="flex-between"><div><h2>This computer</h2><p style="margin-top:7px">Beacon Remote is running.</p></div><span class="host-pill"><span class="dot on"></span> Online</span></div><div class="host-scope"><strong>DESKTOP-SAMPLE</strong><div>${icon("monitor", "small-icon")} Windows 11 Pro</div><div>${icon("shield", "small-icon")} Agent 0.3.7-demo · Service running (sample)</div><div>${icon("lock", "small-icon")} Paired to Personal workspace</div></div><div class="split-actions" style="margin:19px 0">${btn("Show pairing code", "showHostCode")} ${btn("Simulate incoming request", "requestIncoming", "blue")}</div><div class="line" style="margin:20px 0"></div><div class="detail"><dt>Host</dt><dd class="mono">DESKTOP-SAMPLE</dd></div><div class="detail"><dt>Machine ID</dt><dd class="mono">BR-001-7E2C</dd></div><div class="detail"><dt>Access policy</dt><dd>Prompt for attended sessions</dd></div><div class="detail"><dt>Session status</dt><dd>Idle · No current controller</dd></div><p class="host-security">This is the host application, not a browser-based Windows security dialog.</p>`,
    ),
    "tray / idle",
  );
}
function hostRequest() {
  return hostShell(
    win(
      `<div class="flex-between" style="gap:12px"><h2>Incoming connection request</h2><span class="tag" style="color:#8b5f20;border-color:#edd39b;background:#fff8e8">Attended</span></div><p style="margin-top:9px">Someone is requesting access to this computer.</p>${hostPerson()}<div class="host-scope"><strong>Access requested</strong><div>${icon("eye", "small-icon")} View this desktop</div><div>${icon("monitor", "small-icon")} Optional mouse and keyboard control</div><div style="color:#78859a">${icon("lock", "small-icon")} File transfer and administration not included</div></div><div class="host-request-options"><label class="option selected"><input type="radio" name="grant" value="view" checked><div><strong>View only</strong><span>See the screen. No input.</span></div></label><label class="option"><input type="radio" name="grant" value="control"><div><strong>Allow control</strong><span>Mouse and keyboard access.</span></div></label></div><div class="host-controls">${btn("Decline", "denyHost")}${btn("Allow once", "approveHost", "blue")}</div><p class="host-security">Session <span class="mono">S-84D2</span> · Request expires without approval · No persistent permission is granted.</p>`,
    ),
    "incoming request",
  );
}
function activeHost(paused = false) {
  return hostShell(
    `<div class="host-banner"><span class="dot on"></span><strong>${paused ? "Sharing paused" : "Screen sharing active"}</strong><span style="opacity:.8">Alex Morgan · ${session.mode === "control" ? "View and control" : "View only"}</span>${paused ? btn(`${icon("play")} Resume`, "resumeHost") : btn(`${icon("pause")} Pause`, "pauseHost")}${btn(`${icon("stop")} Stop sharing`, "stopHost", "red")}</div>${win(`<div class="flex-between"><div><h2>${paused ? "Screen sharing paused" : "Someone is connected"}</h2><p style="margin-top:6px">${paused ? "The other person cannot see or control your computer." : "Screen sharing is active on this Windows desktop."}</p></div><span class="host-pill"><span class="dot ${paused ? "" : "on"}"></span>${paused ? "Paused" : "Connected"}</span></div>${hostPerson()}<div class="host-scope"><strong>Current permissions</strong><div>${icon("eye", "small-icon")} Screen view ${paused ? "(paused)" : "enabled"}</div><div>${icon("monitor", "small-icon")} Keyboard and mouse ${paused ? "(paused)" : session.mode === "control" ? "enabled" : "disabled"}</div><div>${icon("lock", "small-icon")} Clipboard and file transfer unavailable</div></div><div class="host-controls" style="justify-content:space-between"><span style="font-size:11px;color:#66758a">Session S-84D2 · Demo</span>${paused ? btn("Resume sharing", "resumeHost", "blue") : btn("Pause sharing", "pauseHost")}${btn("Stop", "stopHost", "red")}</div><p class="host-security">Stop sharing immediately revokes screen and input permission for this session.</p>`, "Beacon Remote — Session")}`,
    "active host session",
  );
}
function hostUpgrade() {
  return hostShell(
    win(
      `<h2>Control permission requested</h2><p style="margin-top:8px">Alex Morgan can currently view your desktop and is asking to use your mouse and keyboard.</p>${hostPerson()}<div class="host-scope"><strong>Requested change</strong><div>${icon("check", "small-icon")} Screen view (already allowed)</div><div>${icon("monitor", "small-icon")} Mouse and keyboard control (new request)</div><div>${icon("lock", "small-icon")} No change to file or admin permissions</div></div><div class="host-controls">${btn("Keep view only", "denyUpgrade")}${btn("Allow control once", "approveUpgrade", "blue")}</div><p class="host-security">Declining keeps the existing view-only session active. This permission is not saved.</p>`,
    ),
    "permission escalation",
  );
}
function hostDeclined() {
  return hostShell(
    win(
      `<div style="text-align:center;padding:11px 0 19px"><span class="square-icon" style="margin:auto auto 16px;color:#b6373d">${icon("x")}</span><h2>Request declined</h2><p style="margin-top:9px">No screen or input access was granted.</p></div><div class="host-controls">${btn("Return to host", "hostBack", "blue")}</div>`,
    ),
    "request result",
  );
}
function stoppedHost() {
  return hostShell(
    win(
      `<div style="text-align:center;padding:11px 0 20px"><span class="square-icon" style="margin:auto auto 16px;color:#058360">${icon("check")}</span><h2>Sharing stopped</h2><p style="margin-top:9px">Alex Morgan no longer has access to this desktop.</p></div><div class="detail"><dt>Session</dt><dd class="mono">S-84D2</dd></div><div class="detail"><dt>End reason</dt><dd>Stopped by local user</dd></div><div class="detail"><dt>Access</dt><dd>Revoked</dd></div><div class="host-controls" style="margin-top:20px">${btn("Done", "hostBack", "blue")}</div>`,
    ),
    "session ended",
  );
}
function hostCode() {
  return hostShell(
    win(
      `<div class="flex-between"><h2>Pair this computer</h2><span class="tag" style="color:#058360">Awaiting account</span></div><p style="margin-top:9px">Enter this code in your Beacon Remote account on another device.</p><div class="number" style="text-align:center;color:#152840;margin:25px 0">${code}</div><p style="text-align:center">Sample code · Expires in 10 minutes (example)</p><div class="host-controls" style="margin-top:24px">${btn("Back", "hostBack")}${btn("Open pairing page", "hostPair", "blue")}</div>`,
    ),
    "pairing code",
  );
}
function security() {
  return `${subtop("Account / Security")}<main class="work"><div class="heading"><div><h1>Account security</h1><p>Sign-in methods, trusted devices and active sessions.</p></div><span class="tag">Personal workspace</span></div><div class="columns"><div>${panel("Sign-in and verification", `<div class="panel-line"><div><div class="name">Authenticator app</div><div class="tiny muted">Two-step verification</div></div><span class="tag green">Enabled (sample)</span></div><div class="panel-line"><div><div class="name">Recovery codes</div><div class="tiny muted">Store codes outside your account.</div></div>${btn("Regenerate", "regenRecovery")}</div><div class="panel-line"><div><div class="name">Password</div><div class="tiny muted">Last changed Oct 1, 2026 (sample)</div></div><a class="btn slim" href="#forgot" data-go="forgot">Change</a></div><div class="panel-line"><div><div class="name">Require approval</div><div class="tiny muted">Attended remote support requests.</div></div><span class="tag">Always</span></div>`)}</div><div>${panel("Account", `${det("Email", "demo@example.test")}${det("Workspace", "Personal")}${det("Active web sessions", "2 (sample)")}${det("Account ID", '<span class="mono">U-1038-DEMO</span>')}${note("All account records on this page are demonstration data. No credentials or sessions are managed.")}`)}</div></div><div style="height:18px"></div>${panel("Devices and sessions", `<div class="auth-devices"><div class="state-row"><div class="state-ico">${icon("monitor")}</div><div><strong>Chrome · Windows 11</strong><p>Current browser · 10.0.0.21 (sample)</p></div><span class="tag green" style="margin-left:auto">Current</span></div><div class="state-row"><div class="state-ico">${icon("laptop")}</div><div><strong>Edge · ZBook 15</strong><p>Last used 2 hours ago · 10.0.0.44 (sample)</p></div>${btn("Revoke", "revokeDevice")}</div><div class="state-row"><div class="state-ico">${icon("monitor")}</div><div><strong>DESKTOP-SAMPLE</strong><p>Host machine · BR-001-7E2C</p></div>${btn("Remove pairing", "revokePairing")}</div></div>`)}</main>`;
}
function connected() {
  return `${subtop("Connect")}<main class="narrow-work">${panel("Connecting to STUDIO-WS", `<div class="recovery-visual"><span class="square-icon" style="width:54px;height:54px">${icon("refresh")}</span><div><h2>Establishing encrypted connection</h2><p>Authentication accepted. Negotiating direct WebRTC transport; the relay will be used if direct connectivity is unavailable.</p></div></div><div class="progress-line"><span></span></div><div class="detail"><dt>Host</dt><dd class="mono">BR-001-7E2C</dd></div><div class="detail"><dt>Requested</dt><dd>Desktop view and control</dd></div><div class="detail"><dt>Stage</dt><dd>ICE connectivity checks · simulated</dd></div><div style="margin-top:18px" class="button-row">${btn("Simulate connected", "finishConnect", "blue")}${btn("Connection lost", "lostConnect")}${btn("Cancel", "cancelConnect")}</div>`)}</main>`;
}
function reconnect() {
  return `${subtop("Remote session")}<main class="narrow-work">${panel("Reconnecting", `<div class="recovery-visual"><span class="square-icon" style="width:52px;height:52px;color:var(--blue)">${icon("refresh")}</span><div><h2>Connection interrupted</h2><p>The host may be switching networks, rebooting, or temporarily unreachable. Input is paused until the session is re-established.</p></div><span class="tag">Attempt 2 of 5 · 8 seconds (sample)</span></div><div class="detail"><dt>Last route</dt><dd>Direct UDP</dd></div><div class="detail"><dt>Fallback</dt><dd>TURN relay if permitted</dd></div><div class="detail"><dt>Security</dt><dd>Authorization rechecked before resuming control</dd></div><div class="button-row" style="margin-top:18px">${btn("Retry now", "retryConnect", "blue")}${btn("End session", "endConnect")}</div>`)}</main>`;
}
function ended() {
  return `${subtop("Remote session")}<main class="narrow-work">${panel("Session ended", `<div class="recovery-visual"><span class="square-icon" style="width:54px;height:54px;color:var(--green)">${icon("check")}</span><div><h2>Disconnected from STUDIO-WS</h2><p>Screen sharing and remote input have stopped.</p></div></div><div class="detail"><dt>Session ID</dt><dd class="mono">S-84D2</dd></div><div class="detail"><dt>End reason</dt><dd>Local or remote disconnect · sample</dd></div><div class="detail"><dt>Duration</dt><dd>04:32 · sample</dd></div><div class="button-row" style="margin-top:20px"><a class="btn blue" href="workspace/index.html">My computers</a>${btn("New connection", "restartConnect")}</div>`)}</main>`;
}
function errors() {
  return `${subtop("Connection states")}<main class="work"><div class="heading"><div><h1>Connection states</h1><p>Offline, expired, unauthorized, and reconnecting screens.</p></div></div><div class="columns"><div>${panel("Session unavailable", `<div class="recovery-visual"><span class="square-icon" style="width:52px;height:52px;color:var(--red)">${icon("alert")}</span><div><h2>Computer offline</h2><p>DESKTOP-SAMPLE last checked in 2 hours ago. Check power, network connection, and host-service status.</p></div></div><div class="button-row">${btn("Retry", "retryConnect", "blue")}<a href="workspace/index.html" class="btn">Back to computers</a></div>`)}</div><div>${panel("Examples", `<div class="state-row"><span class="state-ico">${icon("clock")}</span><div><strong>Support code expired</strong><p>Generate a new code on the host.</p></div>${btn("Preview", "expiredCode")}</div><div class="state-row"><span class="state-ico">${icon("lock")}</span><div><strong>Authorization denied</strong><p>Desktop access not granted by policy or user.</p></div>${btn("Preview", "accessDenied")}</div><div class="state-row"><span class="state-ico">${icon("refresh")}</span><div><strong>Connection interrupted</strong><p>Return to connection negotiation.</p></div><a class="btn slim" href="#reconnect" data-go="reconnect">Preview</a></div><div class="state-row"><span class="state-ico">${icon("check")}</span><div><strong>Session ended</strong><p>Remote input fully released.</p></div><a class="btn slim" href="#ended" data-go="ended">Preview</a></div>`)}</div></div></main>`;
}
function simpleError(type) {
  let m =
    type === "expired"
      ? [
          "Code expired",
          "The support code has expired or was already used. Ask for a new code.",
        ]
      : [
          "Access not granted",
          "This connection was declined or your account is not authorized. No access was established.",
        ];
  return `${subtop("Support")}<main class="narrow-work">${panel(type === "expired" ? "Expired code" : "Authorization", `<div class="recovery-visual"><span class="square-icon" style="width:54px;height:54px;color:var(--red)">${icon(type === "expired" ? "clock" : "lock")}</span><div><h2>${m[0]}</h2><p>${m[1]}</p></div></div><div class="button-row" style="justify-content:center"><a class="btn blue" href="#support" data-go="support">Back to support</a><a class="btn" href="#errors" data-go="errors">All states</a></div>`)}</main>`;
}
const PAGES = {
  home,
  signin,
  signup,
  forgot,
  "reset-sent": resetSent,
  verify,
  mfa,
  "recovery-code": recoveryCode,
  downloads: download,
  enroll,
  paired,
  support,
  waiting,
  host,
  "host-request": hostRequest,
  "host-active": () => activeHost(false),
  "host-paused": () => activeHost(true),
  "host-upgrade": hostUpgrade,
  "host-declined": hostDeclined,
  "host-stopped": stoppedHost,
  "host-code": hostCode,
  security,
  connecting: connected,
  reconnect,
  ended,
  errors,
  "code-expired": () => simpleError("expired"),
  "access-denied": () => simpleError("denied"),
};
const PROTO_GROUPS = [
  [
    "Public site",
    [
      ["home", "Landing"],
      ["downloads", "Windows download"],
      ["support", "Enter support code"],
    ],
  ],
  [
    "Account",
    [
      ["signin", "Sign in"],
      ["signup", "Create account"],
      ["verify", "Verify email"],
      ["forgot", "Password reset"],
      ["reset-sent", "Reset requested"],
      ["mfa", "Authenticator challenge"],
      ["recovery-code", "Recovery code"],
      ["security", "Account security"],
    ],
  ],
  [
    "Windows host",
    [
      ["host", "System tray / idle"],
      ["host-code", "Pairing code"],
      ["host-request", "Incoming approval"],
      ["host-active", "Active sharing"],
      ["host-paused", "Paused"],
      ["host-upgrade", "Request control"],
      ["host-declined", "Declined"],
      ["host-stopped", "Stopped"],
    ],
  ],
  [
    "Access lifecycle",
    [
      ["enroll", "Web pairing"],
      ["paired", "Computer paired"],
      ["waiting", "Awaiting approval"],
      ["connecting", "Connection negotiation"],
      ["reconnect", "Reconnecting"],
      ["ended", "Session ended"],
      ["errors", "Failure states"],
      ["code-expired", "Code expired"],
      ["access-denied", "Access denied"],
    ],
  ],
];
let route = "home",
  menuOpen = false,
  session = { mode: "view" };
const toast = (msg) => {
  const el = document.querySelector("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (el.hidden = true), 3600);
};
const navigate = (p) => {
  window.location.hash = p;
};
function render() {
  route = decodeURIComponent(location.hash.slice(1)) || "home";
  if (!PAGES[route]) route = "home";
  document.title =
    ({
      home: "Remote access",
      signin: "Sign in",
      signup: "Create account",
      "host-request": "Incoming connection",
      security: "Account security",
    }[route] ||
      route.replaceAll("-", " ").replace(/^./, (s) => s.toUpperCase())) +
    " · Beacon Remote";
  document.querySelector("#root").innerHTML = PAGES[route]();
  document.documentElement.dataset.page = route;
  let proto = document.createElement("button");
  proto.type = "button";
  proto.className = "prototrigger";
  proto.innerHTML =
    icon("menu") +
    ' Screens <span style="opacity:.55">' +
    Object.keys(PAGES).length +
    "</span>";
  proto.dataset.action = "proto";
  proto.setAttribute("aria-label", "Browse prototype screens");
  document.querySelector("#root").append(proto);
  document.querySelector("#toast").hidden = true;
  scrollTo({ top: 0, behavior: "instant" });
  updateThemeIcon();
}
const closeProto = () => document.querySelector(".proto-overlay")?.remove();
function openProto() {
  closeProto();
  let el = document.createElement("div");
  el.className = "proto-overlay";
  el.innerHTML = `<aside class="proto-panel" role="dialog" aria-modal="true" aria-label="Prototype screens"><header><div><div class="caps" style="margin-bottom:5px">BEACON REMOTE</div><h2>Screen explorer</h2></div><button class="btn icon-only" data-action="closeProto" aria-label="Close screens">${icon("x")}</button></header><p class="muted tiny">Select a screen to inspect a workflow. All accounts, devices, and requests here are simulated.</p><div class="group-title">Production workspace</div><a class="proto-link" href="workspace/index.html">${icon("monitor")}<strong>V6 workspace</strong><span>Existing prototype →</span></a>${PROTO_GROUPS.map(([group, items]) => `<div class="group-title">${group}</div>${items.map(([slug, label]) => `<button class="proto-link ${route === slug ? "proto-current" : ""}" data-go="${slug}">${icon(slug.startsWith("host") ? "monitor" : slug === "signin" ? "lock" : slug === "home" ? "arrow" : "chevron")}<strong>${label}</strong><span>${slug}</span></button>`).join("")}`).join("")}</aside>`;
  document.body.append(el);
  el.addEventListener("click", (e) => {
    if (e.target === el) closeProto();
  });
}
function updateThemeIcon() {
  let dark = document.documentElement.getAttribute("data-theme") === "dark";
  let b = document.querySelector('[data-action="theme"]');
  if (b) b.innerHTML = icon(dark ? "sun" : "moon");
}
const confirmInline = (title, body, yesaction) => {
  let el = document.createElement("div");
  el.className = "proto-overlay";
  el.innerHTML = `<div class="auth-panel" style="margin:auto;width:min(430px,calc(100% - 24px));border-radius:10px"><h2 style="margin-bottom:12px">${title}</h2><p class="muted" style="font-size:12px;margin-bottom:22px">${body}</p><div class="button-row" style="justify-content:flex-end">${btn("Cancel", "closeProto")}${btn("Confirm", yesaction, "red")}</div></div>`;
  el.addEventListener("click", (e) => {
    if (e.target === el) el.remove();
  });
  el.classList.add("confirmation");
  document.body.append(el);
};
function action(a) {
  switch (a) {
    case "theme": {
      let current =
        document.documentElement.getAttribute("data-theme") || "light";
      let next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      storageSet("beacon-proto-theme", next);
      updateThemeIcon();
      break;
    }
    case "menu": {
      let menu = document.querySelector("#mobileLinks");
      if (menu) menu.classList.toggle("open");
      break;
    }
    case "proto":
      openProto();
      break;
    case "closeProto":
      document.querySelector(".proto-overlay")?.remove();
      break;
    case "password": {
      let i = document.querySelector("#password");
      if (i) i.type = i.type === "password" ? "text" : "password";
      break;
    }
    case "resetBack":
    case "verifyDemo":
      navigate("signin");
      break;
    case "downloadDemo":
      toast(
        "Installer unavailable in frontend prototype. No file was downloaded.",
      );
      break;
    case "showHostCode":
      navigate("host-code");
      break;
    case "requestIncoming":
      navigate("host-request");
      break;
    case "hostBack":
      navigate("host");
      break;
    case "hostPair":
      navigate("enroll");
      break;
    case "denyHost":
      navigate("host-declined");
      break;
    case "approveHost": {
      session.mode =
        document.querySelector("input[name=grant]:checked")?.value || "view";
      navigate("host-active");
      break;
    }
    case "pauseHost":
      navigate("host-paused");
      break;
    case "resumeHost":
      navigate("host-active");
      break;
    case "stopHost":
      navigate("host-stopped");
      break;
    case "approveUpgrade":
      session.mode = "control";
      navigate("host-active");
      break;
    case "denyUpgrade":
      session.mode = "view";
      navigate("host-active");
      toast("Control declined; view-only session remains active.");
      break;
    case "cancelWaiting":
      navigate("support");
      break;
    case "expiredCode":
      navigate("code-expired");
      break;
    case "accessDenied":
      navigate("access-denied");
      break;
    case "finishConnect":
      window.location.href = "workspace/index.html";
      break;
    case "lostConnect":
      navigate("reconnect");
      break;
    case "endConnect":
    case "cancelConnect":
      navigate("ended");
      break;
    case "retryConnect":
    case "restartConnect":
      navigate("connecting");
      break;
    case "revokeDevice":
      confirmInline(
        "Revoke browser session?",
        "This would sign out Edge on ZBook 15. The current browser stays signed in.",
        "revokeConfirmed",
      );
      break;
    case "revokePairing":
      confirmInline(
        "Remove computer pairing?",
        "This would revoke DESKTOP-SAMPLE’s enrolled credentials. Remote access stops until it is paired again.",
        "revokeConfirmed",
      );
      break;
    case "regenRecovery":
      confirmInline(
        "Replace recovery codes?",
        "Previously issued recovery codes would become invalid. Save the new codes before leaving.",
        "regenConfirmed",
      );
      break;
    case "revokeConfirmed":
    case "regenConfirmed":
      document.querySelector(".confirmation")?.remove();
      toast(
        "Demo action only. No credentials, pairings, or codes were changed.",
      );
      break;
    case "minimize":
      toast("Simulated Windows window. No native application was minimized.");
      break;
    default:
      toast("This action is part of the prototype only.");
  }
}
document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-go]");
  if (nav) {
    e.preventDefault();
    const p = nav.dataset.go;
    closeProto();
    navigate(p);
    return;
  }
  const b = e.target.closest("[data-action]");
  if (b) {
    e.preventDefault();
    action(b.dataset.action);
  }
});
document.addEventListener("change", (e) => {
  if (e.target.name === "grant") {
    document
      .querySelectorAll(".option")
      .forEach((el) => el.classList.toggle("selected", el.contains(e.target)));
  }
});
document.addEventListener("submit", (e) => {
  e.preventDefault();
  let id = e.target.id;
  if (id === "loginForm") {
    const email = document.querySelector("#email").value;
    if (email.includes("@")) navigate("mfa");
    else toast("Enter a valid email address.");
  } else if (id === "signupForm") {
    const p = document.querySelector("#newpassword").value,
      c = document.querySelector("#confirm").value;
    if (p.length < 12 || p !== c) {
      toast("Passwords must match and contain at least 12 characters.");
      return;
    }
    navigate("verify");
  } else if (id === "resetForm") navigate("reset-sent");
  else if (id === "mfaForm") {
    let code = Array.from(document.querySelectorAll("[data-otp]"))
      .map((x) => x.value)
      .join("");
    if (code.length === 6) {
      toast("Demo verification only. Redirecting to workspace.");
      setTimeout(() => (location.href = "workspace/index.html"), 350);
    } else toast("Enter all six digits.");
  } else if (id === "recoveryForm") {
    if (document.querySelector("#recovery").value.trim())
      location.href = "workspace/index.html";
    else toast("Enter a recovery code.");
  } else if (id === "pairForm") {
    let v = document.querySelector("#pairCode").value.replace(/\D/g, "");
    if (v === "482913") navigate("paired");
    else toast("Demo accepts sample pairing code 482 913 only.");
  } else if (id === "joinForm") {
    let v = document.querySelector("#supportCode").value.replace(/\D/g, "");
    if (v === "482913") navigate("waiting");
    else navigate("code-expired");
  }
});
document.addEventListener("input", (e) => {
  if (e.target.matches("[data-otp]")) {
    e.target.value = e.target.value.replace(/\D/g, "").slice(0, 1);
    if (e.target.value) {
      let n = Number(e.target.dataset.otp);
      document.querySelector(`[data-otp="${n + 1}"]`)?.focus();
    }
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelector(".proto-overlay")?.remove();
  }
  if (
    e.key === "Backspace" &&
    e.target.matches("[data-otp]") &&
    !e.target.value
  ) {
    let n = Number(e.target.dataset.otp);
    document.querySelector(`[data-otp="${n - 1}"]`)?.focus();
  }
});
addEventListener("hashchange", render);
document.documentElement.dataset.theme =
  storageGet("beacon-proto-theme") || "light";
render();
