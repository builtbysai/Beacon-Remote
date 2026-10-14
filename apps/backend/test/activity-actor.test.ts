import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test(
  "a helper's connection shows in the owner's activity with the helper named, and in the helper's own without",
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
      PORT: 3024,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const person = async () => {
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [id, `${id}@example.test`],
      );
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [sha(token), id],
      );
      return {
        id,
        email: `${id}@example.test`,
        headers: { origin, cookie: `remote_session=${token}` },
      };
    };
    const owner = await person();
    const helper = await person();
    const events = async (who: typeof owner) =>
      (
        await app.inject({
          method: "GET",
          url: "/api/activity",
          headers: who.headers,
        })
      ).json().events as { action: string; actor: string | null }[];
    try {
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,last_seen_at) VALUES ($1,$2,'Desk',$3,now())",
        [randomUUID(), owner.id, randomBytes(32)],
      );
      await app.inject({
        method: "POST",
        url: "/api/team",
        headers: owner.headers,
        payload: { email: helper.email, role: "viewer" },
      });
      const shared = (
        await app.inject({
          method: "GET",
          url: "/api/shared",
          headers: helper.headers,
        })
      ).json().shared;
      const started = await app.inject({
        method: "POST",
        url: `/api/relationships/${shared[0].id}/sessions`,
        headers: helper.headers,
        payload: { capability: "desktop:view" },
      });
      assert.equal(started.statusCode, 200);

      const action = "desktop.view.requested:desktop";
      const seenByOwner = (await events(owner)).filter(
        (event) => event.action === action,
      );
      assert.equal(seenByOwner.length, 1);
      assert.equal(seenByOwner[0]!.actor, helper.email);
      const seenByHelper = (await events(helper)).filter(
        (event) => event.action === action,
      );
      assert.equal(seenByHelper.length, 1);
      assert.equal(seenByHelper[0]!.actor, null);
    } finally {
      for (const who of [owner, helper])
        await pool.query("DELETE FROM accounts WHERE id=$1", [who.id]);
      await app.close();
      await pool.end();
    }
  },
);
