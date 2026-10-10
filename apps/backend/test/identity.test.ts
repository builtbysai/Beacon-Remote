import { readFile } from "node:fs/promises";
import { createHash, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { hash } from "@node-rs/argon2";
import { createApp } from "../src/app.js";
import { heartbeatMessage } from "../../../packages/protocol/src/index.js";

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "login limits reject spoofed forwarded IPs and preserve trusted proxy client isolation",
  { skip: !databaseUrl },
  async () => {
    assert.match(new URL(databaseUrl!).pathname, /_test$/);
    const pool = new Pool({ connectionString: databaseUrl });
    await pool.query(
      await readFile(
        new URL("../migrations/001_identity.sql", import.meta.url),
        "utf8",
      ),
    );
    const app = await createApp(pool, {
      DATABASE_URL: databaseUrl!,
      WEB_ORIGIN: "https://remote.example.test",
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3010,
      TRUST_PROXY_CIDR: "172.30.88.0/28",
    });
    const attempt = (remoteAddress: string, forwarded: string) =>
      app.inject({
        method: "POST",
        url: "/api/login",
        remoteAddress,
        headers: {
          origin: "https://remote.example.test",
          "x-forwarded-for": forwarded,
        },
        payload: {
          email: `${randomUUID()}@example.test`,
          password: "test-only-missing-account",
        },
      });
    try {
      for (let i = 0; i < 8; i++)
        assert.equal(
          (await attempt("203.0.113.10", `198.51.100.${i + 1}`)).statusCode,
          401,
        );
      assert.equal(
        (await attempt("203.0.113.10", "198.51.100.99")).statusCode,
        429,
      );
      for (let i = 0; i < 8; i++)
        assert.equal(
          (await attempt("172.30.88.2", "198.51.100.150")).statusCode,
          401,
        );
      assert.equal(
        (await attempt("172.30.88.2", "198.51.100.150")).statusCode,
        429,
      );
      assert.equal(
        (await attempt("172.30.88.2", "198.51.100.151")).statusCode,
        401,
      );
    } finally {
      await app.close();
      await pool.end();
    }
  },
);
test(
  "one-use enrollment, authenticated presence, account isolation, replay and revocation",
  { skip: !databaseUrl },
  async () => {
    const url = new URL(databaseUrl!);
    assert.match(url.pathname, /_test$/); // Never clear a development or live database.
    const pool = new Pool({ connectionString: databaseUrl });
    const app = await createApp(pool, {
      DATABASE_URL: databaseUrl!,
      WEB_ORIGIN: "http://127.0.0.1:5174",
      HOST: "127.0.0.1",
      PORT: 3010,
      NODE_ENV: "test",
    });
    const first = randomUUID();
    const second = randomUUID();
    const firstEmail = `${first}@example.test`;
    const secondEmail = `${second}@example.test`;
    try {
      await pool.query(
        await readFile(
          new URL("../migrations/001_identity.sql", import.meta.url),
          "utf8",
        ),
      );
      const password = "test-only-long-password";
      const passwordHash = await hash(password);
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$3),($4,$5,$3)",
        [first, firstEmail, passwordHash, second, secondEmail],
      );
      async function login(email: string) {
        const result = await app.inject({
          method: "POST",
          url: "/api/login",
          headers: { origin: "http://127.0.0.1:5174" },
          payload: { email, password },
        });
        assert.equal(result.statusCode, 200);
        const token = result.cookies.find(
          (c) => c.name === "remote_session",
        )!.value;
        return {
          cookie: `remote_session=${token}`,
          origin: "http://127.0.0.1:5174",
        };
      }
      const firstHeaders = await login(firstEmail);
      const secondHeaders = await login(secondEmail);
      assert.equal(
        (await app.inject({ method: "GET", url: "/api/machines" })).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/enrollments",
            headers: { ...firstHeaders, origin: "https://attacker.test" },
            payload: {},
          })
        ).statusCode,
        403,
      );
      const pairing = await app.inject({
        method: "POST",
        url: "/api/enrollments",
        headers: firstHeaders,
        payload: {},
      });
      const code = pairing.json().code as string;
      const keys = generateKeyPairSync("ed25519");
      const publicKey = keys.publicKey
        .export({ type: "spki", format: "der" })
        .subarray(-32)
        .toString("base64");
      const enroll = { version: 1, code, name: "Office PC", publicKey };
      const enrolled = await app.inject({
        method: "POST",
        url: "/api/agent/enroll",
        payload: enroll,
      });
      assert.equal(enrolled.statusCode, 200);
      const machineId = enrolled.json().machineId as string;
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/enroll",
            payload: enroll,
          })
        ).statusCode,
        403,
      );
      const initial = (
        await app.inject({
          method: "GET",
          url: "/api/machines",
          headers: firstHeaders,
        })
      ).json();
      assert.equal(initial.machines[0].online, false);
      const beat = () => {
        const timestamp = Date.now();
        const nonce = randomUUID();
        return {
          version: 1,
          machineId,
          timestamp,
          nonce,
          signature: sign(
            null,
            Buffer.from(heartbeatMessage(machineId, timestamp, nonce)),
            keys.privateKey,
          ).toString("base64"),
        };
      };
      const message = beat();
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/heartbeat",
            payload: {
              ...message,
              signature: Buffer.alloc(64).toString("base64"),
            },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/heartbeat",
            payload: message,
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/heartbeat",
            payload: message,
          })
        ).statusCode,
        409,
      );
      const inventory = (
        await app.inject({
          method: "GET",
          url: "/api/machines",
          headers: firstHeaders,
        })
      ).json();
      assert.equal(inventory.machines[0].online, true);
      assert.deepEqual(
        (
          await app.inject({
            method: "GET",
            url: "/api/machines",
            headers: secondHeaders,
          })
        ).json().machines,
        [],
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/machines/${machineId}/revoke`,
            headers: secondHeaders,
            payload: {},
          })
        ).statusCode,
        404,
      );
      await pool.query(
        "UPDATE machines SET last_seen_at=now()-interval '46 seconds' WHERE id=$1",
        [machineId],
      );
      assert.equal(
        (
          await app.inject({
            method: "GET",
            url: "/api/machines",
            headers: firstHeaders,
          })
        ).json().machines[0].online,
        false,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/machines/${machineId}/revoke`,
            headers: firstHeaders,
            payload: {},
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/heartbeat",
            payload: beat(),
          })
        ).statusCode,
        401,
      );
      const audit = await pool.query(
        "SELECT action FROM audit_events WHERE machine_id=$1 ORDER BY id",
        [machineId],
      );
      assert.deepEqual(
        audit.rows.map((row) => row.action),
        ["machine.enrolled", "machine.revoked"],
      );
      const expires = await app.inject({
        method: "POST",
        url: "/api/enrollments",
        headers: firstHeaders,
        payload: {},
      });
      const expiredCode = expires.json().code as string;
      await pool.query(
        "UPDATE enrollments SET expires_at=now()-interval '1 second' WHERE code_hash=$1",
        [createHash("sha256").update(expiredCode).digest("hex")],
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/agent/enroll",
            payload: { ...enroll, code: expiredCode },
          })
        ).statusCode,
        403,
      );
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [
        [first, second],
      ]);
      await app.close();
      await pool.end();
    }
  },
);
