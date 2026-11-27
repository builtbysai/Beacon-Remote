import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";

// Logs never hold credentials, pixels or input (docs/security.md). A source-level guard: no log statement in the Rust
// hosts, the backend or the MCP server may name a secret-like value. It reads text, so it cannot prove a value is
// never logged some other way, but it stops the common mistake of logging a token, password or key by name.
const root = new URL("../../../", import.meta.url).pathname.replace(
  /^\/([A-Za-z]:)/,
  "$1",
);
const secretWord =
  /password|passcode|secret|token|cookie|private[_ ]?key|seed|signature|\bpin\b/i;
const rustLog =
  /\b(?:tracing::|log::)?(?:info|warn|error|debug|trace)!\(|\be?println!\(/;
const tsLog = /console\.(?:log|error|warn|info)\(|\b(?:request|app)\.log\./;

function* files(dir: string, extension: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (["node_modules", "target", "dist", "build", ".git"].includes(name))
      continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* files(path, extension);
    else if (name.endsWith(extension)) yield path;
  }
}

function offenders(dirs: string[], extension: string, log: RegExp): string[] {
  const found: string[] = [];
  for (const dir of dirs)
    for (const file of files(join(root, dir), extension)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (log.test(line) && secretWord.test(line))
            found.push(`${relative(root, file)}:${index + 1}: ${line.trim()}`);
        });
    }
  return found;
}

test("no Rust log statement names a secret-like value", () => {
  assert.deepEqual(offenders(["apps", "crates"], ".rs", rustLog), []);
});

test("no backend or MCP log statement names a secret-like value", () => {
  assert.deepEqual(
    offenders(["apps/backend/src", "tools/mcp/src"], ".ts", tsLog).concat(
      offenders(["tools/mcp/src"], ".mjs", tsLog),
    ),
    [],
  );
});
