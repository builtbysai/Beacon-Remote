import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { hash } from "@node-rs/argon2";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "owner-scoped pairing progress and cancellation serialize with native claim",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    assert.equal(new URL(url).hostname, "127.0.0.1");
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const origin = "https://remote.example.test";
    const app = await createApp(pool, {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      HOST: "127.0.0.1",
      PORT: 3017,
      NODE_ENV: "test",
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    const ids = [randomUUID(), randomUUID()];
    let address = 1;
    const post = (
      path: string,
      payload: object,
      cookie?: string,
      source = origin,
    ) =>
      app.inject({
        method: "POST",
        url: `/api/${path}`,
        headers: { origin: source, ...(cookie ? { cookie } : {}) },
        remoteAddress: `198.18.1.${address++}`,
        payload,
      });
    try {
      const password = randomBytes(24).toString("base64url");
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,$5),($3,$4,$5)",
        [
          ids[0],
          `${ids[0]}@example.test`,
          ids[1],
          `${ids[1]}@example.test`,
          await hash(password),
        ],
      );
      const cookies: string[] = [];
      for (const id of ids) {
        const response = await post("login", {
          email: `${id}@example.test`,
          password,
        });
        assert.equal(response.statusCode, 200);
        cookies.push(String(response.headers["set-cookie"]).split(";")[0]!);
      }
      const create = async () => {
        const response = await post("enrollments", {}, cookies[0]);
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(response.json().expiresInSeconds, 300);
        const code = response.json().code as string;
        assert.match(
          code,
          /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
        );
        return code;
      };
      const native = (
        code: string,
        publicKey = randomBytes(32).toString("base64"),
      ) =>
        post("agent/enroll", {
          version: 1,
          code,
          name: "Pairing test device",
          publicKey,
        });
      const status = (code: string, cookie = cookies[0]) =>
        post("enrollments/status", { code }, cookie);
      const cancel = (code: string, cookie = cookies[0]) =>
        post("enrollments/cancel", { code }, cookie);
      const first = await create();
      assert.equal(
        (await status(first.toLowerCase().replaceAll("-", " "))).json().state,
        "waiting",
      );
      assert.equal((await status(first, cookies[1])).statusCode, 404);
      assert.equal((await cancel(first, cookies[1])).statusCode, 404);
      assert.equal(
        (await post("enrollments/status", { code: first })).statusCode,
        401,
      );
      assert.equal(
        (
          await post(
            "enrollments/cancel",
            { code: first },
            cookies[0],
            "https://attacker.test",
          )
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await post(
            "enrollments/status",
            { code: first, other: true },
            cookies[0],
          )
        ).statusCode,
        400,
      );
      assert.equal(
        (await cancel(first.replaceAll("-", "").toLowerCase())).json().state,
        "cancelled",
      );
      // A rollback to a backend that only checks the original expiry guard
      // must still reject a cancelled invitation.
      const legacyClaim = await pool.query(
        "UPDATE enrollments SET claimed_at=now() WHERE code_hash=$1 AND claimed_at IS NULL AND expires_at>now() RETURNING account_id",
        [createHash("sha256").update(first).digest("hex")],
      );
      assert.equal(legacyClaim.rowCount, 0);
      assert.equal((await cancel(first)).json().state, "cancelled");
      assert.equal((await native(first)).statusCode, 403);

      const claimed = await create();
      const key = randomBytes(32).toString("base64");
      const enrolled = await native(
        claimed.replaceAll("-", "").toLowerCase(),
        key,
      );
      assert.equal(enrolled.statusCode, 200);
      const snapshot = await status(claimed);
      assert.equal(snapshot.headers["cache-control"], "no-store");
      assert.equal(snapshot.json().state, "claimed");
      assert.deepEqual(snapshot.json().machine, {
        id: enrolled.json().machineId,
        name: "Pairing test device",
      });
      assert.equal((await cancel(claimed)).json().state, "claimed");
      assert.equal((await native(claimed)).statusCode, 403);

      // A code issued before codes became eight symbols (twelve, in three groups) is still claimable, typed any way.
      const older = "AB3K-9PQ2-HXZ7";
      await pool.query(
        "INSERT INTO enrollments(code_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '5 minutes')",
        [createHash("sha256").update(older).digest("hex"), ids[0]],
      );
      assert.equal((await native("ab3k 9pq2 hxz7")).statusCode, 200);
      assert.equal((await native(older)).statusCode, 403);

      // Previously issued case-sensitive invitations still work. Normalizing
      // readable codes must never change the bytes of legacy bearer tokens.
      const legacy = "aB3_dE6-gH9_jK2-mN5_pQ8-rS1_tU4v";
      await pool.query(
        "INSERT INTO enrollments(code_hash,account_id,expires_at) VALUES ($1,$2,now()+interval '5 minutes')",
        [createHash("sha256").update(legacy).digest("hex"), ids[0]],
      );
      assert.equal((await native(legacy.toUpperCase())).statusCode, 403);
      assert.equal((await status(legacy)).json().state, "waiting");
      assert.equal((await native(legacy)).statusCode, 200);
      assert.equal((await native(legacy)).statusCode, 403);
      for (const malformed of [
        "AAAA-BBBB-0000",
        "AAAA-BBBB-1111",
        "abcd!efgh!jklm",
      ]) {
        // Ambiguous symbols and arbitrary punctuation are not readable codes.
        assert.equal((await native(malformed)).statusCode, 400);
      }

      const expired = await create();
      await pool.query(
        "UPDATE enrollments SET expires_at=now()-interval '1 second' WHERE code_hash=$1",
        [createHash("sha256").update(expired).digest("hex")],
      );
      assert.equal((await status(expired)).json().state, "expired");
      assert.equal((await native(expired)).statusCode, 403);
      for (let run = 0; run < 4; run++) {
        const code = await create();
        const [cancelled, claim] = await Promise.all([
          cancel(code),
          native(code),
        ]);
        assert.equal(cancelled.statusCode, 200);
        assert.ok([200, 403].includes(claim.statusCode));
        assert.equal(
          claim.statusCode === 200,
          cancelled.json().state === "claimed",
        );
        assert.equal((await status(code)).json().state, cancelled.json().state);
      }
      const rollback = await create();
      assert.equal((await native(rollback, key)).statusCode, 409);
      assert.equal((await status(rollback)).json().state, "waiting");
      await cancel(rollback);
      await pool.query("DELETE FROM machines WHERE id=$1", [
        enrolled.json().machineId,
      ]);
      assert.equal((await status(claimed)).json().state, "claimed");
      assert.equal((await status(claimed)).json().machine, null);
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [ids]);
      await pool.end();
    }
  },
);
