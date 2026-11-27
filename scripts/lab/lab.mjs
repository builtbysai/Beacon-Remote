#!/usr/bin/env node
// Drives the test laptop's screen and keyboard from this computer, over the existing SSH connection.
//   node scripts/lab/lab.mjs install                   copy the helper to the laptop and start it
//   node scripts/lab/lab.mjs ping | status | windows | foreground
//   node scripts/lab/lab.mjs shot [--window "title"] [--raise] [--region x,y,w,h] [--scale 0.5] [--out file.png]
//   node scripts/lab/lab.mjs click X Y [--window "title"] [--right] [--double]    move X Y    drag X1 Y1 X2 Y2    scroll X Y DY
//   node scripts/lab/lab.mjs type "text" --window "title"    key ctrl+s --window "title"    raise "title"    close "title"
//   node scripts/lab/lab.mjs launch PATH [args...]     put FILE REMOTE_PATH     get REMOTE_PATH FILE
//   node scripts/lab/lab.mjs pause | resume | stop | uninstall
// Set LAB_HOST (default beacon-surfiena) to use another SSH alias. Coordinates are screen pixels on the laptop.
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";

// The direct cable (beacon-surfiena-link, 10.77.0.2) when it answers, otherwise the Tailscale route.
function pickHost() {
  if (process.env.LAB_HOST) return process.env.LAB_HOST;
  const probe = spawnSync(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=2",
      "beacon-surfiena-link",
      "exit",
    ],
    { encoding: "utf8" },
  );
  return probe.status === 0 ? "beacon-surfiena-link" : "beacon-surfiena";
}
const host = pickHost();
const here = dirname(fileURLToPath(import.meta.url));
const remoteRoot = "C:/Users/saiha/BeaconLab"; // the laptop's user profile; override with LAB_REMOTE_ROOT
const root = process.env.LAB_REMOTE_ROOT ?? remoteRoot;

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", ...options });
  if (result.status !== 0 && !options.allowFailure)
    throw new Error(
      `${program} ${args[0]} failed: ${(result.stderr || result.stdout).trim().slice(0, 400)}`,
    );
  return result;
}
// A PowerShell script on the laptop, sent as an encoded command so no quoting can change it.
function remotePowerShell(script) {
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const result = run(
    "ssh",
    [host, `powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`],
    { allowFailure: true },
  );
  return result.stdout
    .split("\n")
    .filter(
      (line) =>
        !/^(<Objs|<\/Objs|#< CLIXML)/.test(line) && !line.startsWith("<"),
    )
    .join("\n")
    .trim();
}
function sendCommand(command, timeoutMs = 20000) {
  const id = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const work = mkdtempSync(join(tmpdir(), "lab-"));
  // One SSH call does it all: write the command, wait for the helper's answer, and send back the answer (and image).
  const json = Buffer.from(JSON.stringify(command)).toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
$in = '${root}/spool/in'; $out = '${root}/spool/out'
$tmp = "$in/${id}.tmp"
[IO.File]::WriteAllBytes($tmp, [Convert]::FromBase64String('${json}'))
Rename-Item -LiteralPath $tmp -NewName '${id}.json'
$end = (Get-Date).AddMilliseconds(${timeoutMs})
while ((Get-Date) -lt $end -and -not (Test-Path "$out/${id}.json")) { Start-Sleep -Milliseconds 60 }
if (-not (Test-Path "$out/${id}.json")) { 'NOANSWER'; return }
Start-Sleep -Milliseconds 30
'ANSWER ' + [Convert]::ToBase64String([IO.File]::ReadAllBytes("$out/${id}.json"))
if (Test-Path "$out/${id}.png") { 'PNG ' + [Convert]::ToBase64String([IO.File]::ReadAllBytes("$out/${id}.png")) }
Remove-Item -Force -ErrorAction SilentlyContinue "$out/${id}.*"
`;
  try {
    const result = run(
      "ssh",
      [
        host,
        `powershell -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(script, "utf16le").toString("base64")}`,
      ],
      { allowFailure: true, maxBuffer: 256 * 1024 * 1024 },
    );
    const lines = (result.stdout ?? "").split("\n").map((line) => line.trim());
    if (
      lines.includes("NOANSWER") ||
      !lines.some((line) => line.startsWith("ANSWER "))
    )
      throw new Error(
        "The helper did not answer. Run `status`; if it is not running, start it at the laptop or run `install`.",
      );
    const answerLine = lines
      .find((line) => line.startsWith("ANSWER "))
      .slice(7);
    const answer = JSON.parse(
      Buffer.from(answerLine, "base64").toString("utf8").replace(/^\uFEFF/, ""),
    );
    const pngLine = lines.find((line) => line.startsWith("PNG "));
    if (pngLine) {
      const png = join(work, "answer.png");
      writeFileSync(png, Buffer.from(pngLine.slice(4), "base64"));
      answer.png = png;
    }
    return { answer, work };
  } catch (error) {
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
}

const [, , op, ...rest] = process.argv;
const flag = (name) => rest.includes(`--${name}`);
const option = (name) => {
  const at = rest.indexOf(`--${name}`);
  return at >= 0 ? rest[at + 1] : undefined;
};
const valued = new Set(["window", "region", "scale", "out"]);
// Keyboard input needs a target window so it can never land in whatever else is in front; --anywhere opts out.
const target = () => {
  if (!option("window") && !flag("anywhere"))
    throw new Error(
      'Name the window to type into with --window "title" (or pass --anywhere).',
    );
  return option("window");
};
const positional = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith("--")) {
    if (valued.has(rest[i].slice(2))) i++;
    continue;
  }
  positional.push(rest[i]);
}
const numbers = (count) => positional.slice(0, count).map(Number);

function finish(answer, work) {
  if (!answer.ok) {
    console.error(`Failed: ${answer.error}`);
    rmSync(work, { recursive: true, force: true });
    process.exit(1);
  }
  if (answer.png) {
    const out = option("out") ?? "lab-shot.png";
    copyFileSync(answer.png, out);
    console.log(
      JSON.stringify({
        saved: out,
        ...answer.image,
        origin: answer.origin,
        window: answer.window,
      }),
    );
  } else {
    delete answer.ok;
    console.log(JSON.stringify(answer, null, 2));
  }
  rmSync(work, { recursive: true, force: true });
}

switch (op) {
  case "install": {
    console.log(
      remotePowerShell(
        `New-Item -ItemType Directory -Force -Path '${root}' | Out-Null; 'ready'`,
      ),
    );
    for (const file of ["lab-agent.ps1", "Install-LabAgent.ps1"])
      run("scp", ["-q", join(here, file), `${host}:${root}/${file}`]);
    console.log(remotePowerShell(`& '${root}/Install-LabAgent.ps1'`));
    const { answer, work } = sendCommand({ op: "ping" }, 30000);
    finish(answer, work);
    break;
  }
  case "uninstall":
    console.log(remotePowerShell(`& '${root}/Install-LabAgent.ps1' -Remove`));
    break;
  case "status":
    console.log(
      remotePowerShell(
        `Get-Process powershell -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq '' } | Out-Null; if (Test-Path '${root}/PAUSE') { 'paused' } else { 'not paused' }; Get-Content '${root}/agent.log' -Tail 5 -ErrorAction SilentlyContinue`,
      ),
    );
    break;
  case "pause":
    console.log(
      remotePowerShell(
        `New-Item -ItemType File -Force -Path '${root}/PAUSE' | Out-Null; 'paused'`,
      ),
    );
    break;
  case "resume":
    console.log(
      remotePowerShell(
        `Remove-Item -Force -ErrorAction SilentlyContinue '${root}/PAUSE'; 'resumed'`,
      ),
    );
    break;
  case "put":
    run("scp", ["-q", rest[0], `${host}:${rest[1]}`]);
    console.log("copied");
    break;
  case "get":
    run("scp", ["-q", `${host}:${rest[0]}`, rest[1]]);
    console.log("copied");
    break;
  case "ping":
  case "windows":
  case "foreground":
  case "stop": {
    const { answer, work } = sendCommand({ op });
    finish(answer, work);
    break;
  }
  case "shot": {
    const command = { op: "screenshot" };
    if (option("window")) command.window = option("window");
    if (flag("raise")) command.raise = true;
    if (option("region"))
      command.region = option("region").split(",").map(Number);
    if (option("scale")) command.scale = Number(option("scale"));
    const { answer, work } = sendCommand(command);
    finish(answer, work);
    break;
  }
  case "click": {
    const [x, y] = numbers(2);
    const { answer, work } = sendCommand({
      op: "click",
      x,
      y,
      button: flag("right") ? "right" : "left",
      double: flag("double"),
      window: option("window"),
    });
    finish(answer, work);
    break;
  }
  case "move": {
    const [x, y] = numbers(2);
    const { answer, work } = sendCommand({ op: "move", x, y });
    finish(answer, work);
    break;
  }
  case "drag": {
    const [x1, y1, x2, y2] = numbers(4);
    const { answer, work } = sendCommand({ op: "drag", x1, y1, x2, y2 });
    finish(answer, work);
    break;
  }
  case "scroll": {
    const [x, y, dy] = numbers(3);
    const { answer, work } = sendCommand({ op: "scroll", x, y, dy });
    finish(answer, work);
    break;
  }
  case "type": {
    const { answer, work } = sendCommand({
      op: "type",
      text: positional[0] ?? "",
      window: target(),
    });
    finish(answer, work);
    break;
  }
  case "key": {
    const { answer, work } = sendCommand({
      op: "key",
      combo: positional[0],
      window: target(),
    });
    finish(answer, work);
    break;
  }
  case "raise":
  case "close": {
    const { answer, work } = sendCommand({ op, window: rest[0] });
    finish(answer, work);
    break;
  }
  case "launch": {
    const { answer, work } = sendCommand({
      op: "launch",
      path: rest[0],
      args: rest.slice(1),
    });
    finish(answer, work);
    break;
  }
  default:
    console.error(
      readFileSync(fileURLToPath(import.meta.url), "utf8")
        .split("\n")
        .slice(1, 11)
        .join("\n"),
    );
    process.exit(2);
}
