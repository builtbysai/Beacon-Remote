import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "the session's own viewer reports measured quality, bounded and rate limited, and the history summarises it",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const origin = "https://remote.example.test";
    const app = await createApp(pool, {
      DATABASE_URL: url,
      WEB_ORIGIN: origin,
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3020,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const viewer = randomUUID();
    const stranger = randomUUID();
    const machine = randomUUID();
    const session = randomUUID();
    const cookie = (token: string) => ({
      origin,
      cookie: `remote_session=${token}`,
    });
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const viewerToken = randomBytes(32).toString("base64url");
    const strangerToken = randomBytes(32).toString("base64url");
    const sample = (rttMs: number, route = "Direct") => ({
      route,
      height: 1080,
      fps: 30,
      rttMs,
      lossPct: 0.5,
    });
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture'),($3,$4,'fixture')",
        [
          viewer,
          `${viewer}@example.test`,
          stranger,
          `${stranger}@example.test`,
        ],
      );
      for (const [id, token] of [
        [viewer, viewerToken],
        [stranger, strangerToken],
      ] as const)
        await pool.query(
          "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
          [digest(token), id],
        );
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Quality PC',$3)",
        [machine, viewer, randomBytes(32)],
      );
      await pool.query(
        "INSERT INTO view_sessions(id,account_id,machine_id,source,token_hash,status,capability) VALUES ($1,$2,$3,'desktop',$4,'active','desktop:view')",
        [session, viewer, machine, randomBytes(32).toString("hex")],
      );
      let address = 1;
      const post = (token: string, body: unknown, id = session) =>
        app.inject({
          method: "POST",
          url: `/api/sessions/${id}/quality`,
          headers: cookie(token),
          remoteAddress: `203.0.113.${address++}`,
          payload: body as object,
        });

      assert.equal((await post(viewerToken, sample(20))).statusCode, 204);
      // Inside the gap: accepted as a request, stored as nothing.
      assert.equal((await post(viewerToken, sample(900))).statusCode, 202);
      // Someone else's session, bad numbers and unknown fields are refused.
      assert.equal((await post(strangerToken, sample(20))).statusCode, 202);
      assert.equal(
        (await post(viewerToken, { ...sample(20), height: -5 })).statusCode,
        400,
      );
      assert.equal(
        (await post(viewerToken, { ...sample(20), extra: 1 })).statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: `/api/sessions/${session}/quality`,
            headers: { origin },
            payload: sample(20),
          })
        ).statusCode,
        401,
      );
      // Spread out two more samples (the gap is real time, so backdate the first ones).
      await pool.query(
        "UPDATE session_quality SET sampled_at=now()-interval '30 seconds' WHERE session_id=$1",
        [session],
      );
      assert.equal((await post(viewerToken, sample(60))).statusCode, 204);
      await pool.query(
        "UPDATE session_quality SET sampled_at=now()-interval '20 seconds' WHERE session_id=$1 AND rtt_ms=60",
        [session],
      );
      assert.equal(
        (await post(viewerToken, sample(100, "Relayed"))).statusCode,
        204,
      );

      const history = await app.inject({
        method: "GET",
        url: "/api/sessions",
        headers: cookie(viewerToken),
      });
      const found = history
        .json()
        .sessions.find((row: { id: string }) => row.id === session);
      assert.equal(found.quality.samples, 3);
      assert.equal(found.quality.height, 1080);
      assert.equal(found.quality.fps, 30);
      assert.equal(found.quality.rttMs, 60);
      assert.equal(found.quality.route, "Direct");
      assert.equal(found.quality.lossPct, 0.5);

      // An ended session takes no more samples.
      await pool.query("UPDATE view_sessions SET status='ended' WHERE id=$1", [
        session,
      ]);
      await pool.query(
        "UPDATE session_quality SET sampled_at=now()-interval '1 minute' WHERE session_id=$1",
        [session],
      );
      assert.equal((await post(viewerToken, sample(10))).statusCode, 202);
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id IN ($1,$2)", [
        viewer,
        stranger,
      ]);
      await pool.end();
    }
  },
);
