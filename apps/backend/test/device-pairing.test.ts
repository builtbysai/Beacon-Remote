import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import type { Pool } from "pg";
import { registerDevicePairing } from "../src/device-pairing.js";

const publicKey = Buffer.alloc(32, 7).toString("base64");

function fixture(signedIn: boolean) {
  const queries: string[] = [];
  const client = {
    query: async (sql: string) => {
      queries.push(sql.split(" ").slice(0, 3).join(" "));
      if (sql.startsWith("SELECT count")) return { rows: [{ n: 0 }] };
      return { rows: [] };
    },
    release: () => undefined,
  };
  const pool = { connect: async () => client } as unknown as Pool;
  const app = Fastify();
  registerDevicePairing(
    app,
    pool,
    async () => (signedIn ? "account-1" : null),
    () => true,
  );
  return { app, queries };
}

const post = (app: ReturnType<typeof Fastify>, url: string, payload: object) =>
  app.inject({ method: "POST", url, payload });

test("a phone asks, a signed-in person approves, and the phone collects its machine once", async () => {
  const { app, queries } = fixture(true);
  const started = await post(app, "/api/device-pairing/start", {
    version: 1,
    name: "Pixel 7a",
    publicKey,
  });
  assert.equal(started.statusCode, 200);
  const { userCode, pollToken } = started.json();
  assert.match(userCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  const waiting = await post(app, "/api/device-pairing/poll", { pollToken });
  assert.equal(waiting.json().status, "pending");

  // Typed by hand: lower case and no dash still work.
  const typed = userCode.replace("-", "").toLowerCase();
  const looked = await post(app, "/api/device-pairing/lookup", {
    userCode: typed,
  });
  assert.equal(looked.json().name, "Pixel 7a");

  const approved = await post(app, "/api/device-pairing/approve", {
    userCode: typed,
  });
  assert.equal(approved.statusCode, 200);
  assert.ok(queries.some((q) => q.startsWith("INSERT INTO machines")));

  const done = await post(app, "/api/device-pairing/poll", { pollToken });
  assert.equal(done.json().status, "approved");
  assert.equal(done.json().machineId, approved.json().machineId);
  // The result is handed over once.
  const again = await post(app, "/api/device-pairing/poll", { pollToken });
  assert.equal(again.json().status, "expired");
  // An approved code cannot be approved twice.
  const twice = await post(app, "/api/device-pairing/approve", {
    userCode: typed,
  });
  assert.equal(twice.statusCode, 404);
});

test("only a signed-in account can look up or approve a code, and bad input is refused", async () => {
  const { app } = fixture(false);
  const started = await post(app, "/api/device-pairing/start", {
    version: 1,
    name: "Pixel 7a",
    publicKey,
  });
  const { userCode } = started.json();
  for (const route of ["lookup", "approve"])
    assert.equal(
      (await post(app, `/api/device-pairing/${route}`, { userCode }))
        .statusCode,
      401,
    );
  assert.equal(
    (
      await post(app, "/api/device-pairing/start", {
        version: 1,
        name: "",
        publicKey,
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await post(app, "/api/device-pairing/poll", { pollToken: "short" }))
      .statusCode,
    400,
  );
  const signed = fixture(true);
  assert.equal(
    (
      await post(signed.app, "/api/device-pairing/lookup", {
        userCode: "AAAA-BBBB",
      })
    ).statusCode,
    404,
  );
});
