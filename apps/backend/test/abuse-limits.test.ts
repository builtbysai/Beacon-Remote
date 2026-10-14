import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test(
  "one account cannot pile up pairing codes, computers or helpers without bound",
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
      PORT: 3022,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    await app.ready();
    const account = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const headers = { origin, cookie: `remote_session=${token}` };
    const made: string[] = [];
    const account$ = (id: string) => {
      made.push(id);
      return pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'fixture')",
        [id, `${id}@example.test`],
      );
    };
    try {
      await account$(account);
      await pool.query(
        "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '1 hour')",
        [sha(token), account],
      );

      // Pairing codes: the tenth waits, the eleventh is refused until one is used or expires.
      for (let i = 0; i < 9; i++)
        await pool.query(
          "INSERT INTO enrollments VALUES ($1,$2,now()+interval '5 minutes',NULL)",
          [sha(randomUUID()), account],
        );
      const pair = () =>
        app.inject({
          method: "POST",
          url: "/api/enrollments",
          headers,
          payload: {},
        });
      assert.equal((await pair()).statusCode, 200);
      assert.equal((await pair()).statusCode, 429);

      // Computers: at the limit, even a valid code does not add another.
      for (let i = 0; i < 50; i++)
        await pool.query(
          "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Fixture',$3)",
          [randomUUID(), account, randomBytes(32)],
        );
      const code = randomBytes(24).toString("base64url");
      await pool.query(
        "INSERT INTO enrollments VALUES ($1,$2,now()+interval '5 minutes',NULL)",
        [sha(code), account],
      );
      const enrolled = await app.inject({
        method: "POST",
        url: "/api/agent/enroll",
        payload: {
          version: 1,
          code,
          name: "One too many",
          publicKey: randomBytes(32).toString("base64"),
        },
      });
      assert.equal(enrolled.statusCode, 403);

      // Helpers: a computer can be shared with at most twenty accounts at once.
      const machine = randomUUID();
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,'Shared',$3)",
        [machine, account, randomBytes(32)],
      );
      const helpers: string[] = [];
      for (let i = 0; i < 21; i++) {
        const id = randomUUID();
        helpers.push(id);
        await account$(id);
      }
      const share = (helper: string) =>
        app.inject({
          method: "POST",
          url: `/api/machines/${machine}/relationships`,
          headers,
          payload: {
            email: `${helper}@example.test`,
            capability: "desktop:view",
            days: 7,
          },
        });
      for (const helper of helpers.slice(0, 20))
        assert.equal((await share(helper)).statusCode, 200);
      assert.equal((await share(helpers[20]!)).statusCode, 409);
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [made]);
      await app.close();
      await pool.end();
    }
  },
);
