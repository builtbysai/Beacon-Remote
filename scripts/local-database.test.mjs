import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname, basename } from "node:path";
import test from "node:test";
import { readLocalDatabase, localDatabaseUrl } from "./local-database.mjs";

async function fixture(t, value) {
  const directory = await mkdtemp(join(tmpdir(), "beacon-local-db-"));
  t.after(async () => {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("beacon-local-db-"));
    await rm(directory, { recursive: true });
  });
  const file = join(directory, "database.json");
  if (value !== undefined) await writeFile(file, JSON.stringify(value));
  return file;
}

test("private passwords are encoded while development and test targets stay local", async (t) => {
  const password = "fixture:@/ password";
  const file = await fixture(t, { password });
  const selected = await readLocalDatabase({ file });
  assert.equal(selected.password, password);
  for (const database of ["beacon_remote_dev", "beacon_remote_test"]) {
    const url = new URL(localDatabaseUrl(selected.password, database));
    assert.equal(url.hostname, "127.0.0.1");
    assert.equal(url.port, "5433");
    assert.equal(url.username, "remote_dev");
    assert.equal(decodeURIComponent(url.password), password);
    assert.equal(url.pathname, `/${database}`);
  }
  assert.throws(() => localDatabaseUrl(password, "beacon_remote"));
});

test("an explicitly missing configuration fails instead of reverting to a public password", async (t) => {
  const file = await fixture(t);
  await assert.rejects(readLocalDatabase({ file }), /Cannot read the selected/);
});

test("malformed private JSON cannot leak its contents through an error cause", async (t) => {
  const file = await fixture(t);
  const secret = "fixture-password-must-not-appear-in-diagnostics";
  await writeFile(file, `{"password":"${secret}",invalid}`);
  await assert.rejects(readLocalDatabase({ file }), (error) => {
    assert.equal(error.cause, undefined);
    assert.equal(String(error.stack).includes(secret), false);
    return true;
  });
});

test("private settings cannot inject database targets or other environment values", async (t) => {
  for (const settings of [
    null,
    [],
    { password: "" },
    { password: "fixture", DATABASE_URL: "postgresql://hosted/production" },
  ]) {
    const file = await fixture(t, settings);
    await assert.rejects(readLocalDatabase({ file }), /must contain only/);
  }
});
