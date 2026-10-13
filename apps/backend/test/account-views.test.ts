import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

test(
  "account views isolate activity and session revocation preserves the current browser and other accounts",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const url = process.env.TEST_DATABASE_URL!;
    assert.match(new URL(url).pathname, /_test$/);
    const pool = new Pool({ connectionString: url });
    await applyMigrations(pool);
    const app = await createApp(pool, {
      DATABASE_URL: url,
      WEB_ORIGIN: "https://remote.example.test",
      NODE_ENV: "test",
      HOST: "127.0.0.1",
      PORT: 3010,
      SESSION_SECRET: randomBytes(32).toString("hex"),
    });
    const account = randomUUID(),
      other = randomUUID();
    const ownMachine = randomUUID(),
      alienMachine = randomUUID();
    const current = randomBytes(32).toString("base64url"),
      sibling = randomBytes(32).toString("base64url"),
      alien = randomBytes(32).toString("base64url");
    const digest = (token: string) =>
      createHash("sha256").update(token).digest("hex");
    const headers = {
      origin: "https://remote.example.test",
      cookie: `remote_session=${current}`,
    };
    try {
      await pool.query(
        "INSERT INTO accounts(id,email,password_hash) VALUES ($1,$2,'unused'),($3,$4,'unused')",
        [account, `${account}@example.test`, other, `${other}@example.test`],
      );
      for (const [token, owner] of [
        [current, account],
        [sibling, account],
        [alien, other],
      ])
        await pool.query(
          "INSERT INTO browser_sessions VALUES ($1,$2,now()+interval '8 hours')",
          [digest(token!), owner],
        );
      await pool.query(
        "INSERT INTO audit_events(account_id,action) VALUES ($1,'machine.enrolled'),($2,'machine.revoked')",
        [account, other],
      );
      for (const owner of [account, other]) {
        const machine = owner === account ? ownMachine : alienMachine;
        await pool.query(
          "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,$3,$4)",
          [
            machine,
            owner,
            owner === account ? "My computer" : "Private other computer",
            randomBytes(32),
          ],
        );
        await pool.query(
          "INSERT INTO view_sessions VALUES ($1,$2,$3,'desktop',$4,now()-interval '1 second','requested',now())",
          [
            randomUUID(),
            owner,
            machine,
            digest(randomBytes(32).toString("hex")),
          ],
        );
      }
      const history = await app.inject({ url: "/api/sessions", headers });
      assert.equal(history.statusCode, 200);
      assert.equal(history.json().sessions.length, 1);
      assert.equal(history.json().sessions[0].machineName, "My computer");
      assert.equal(history.json().sessions[0].status, "expired");
      assert.ok(!history.body.includes("token_hash"));
      const ownHistory = await app.inject({
        url: `/api/sessions?machineId=${ownMachine}`,
        headers,
      });
      assert.equal(ownHistory.json().sessions.length, 1);
      assert.equal(
        (
          await app.inject({
            url: `/api/sessions?machineId=${alienMachine}`,
            headers,
          })
        ).json().sessions.length,
        0,
      );
      assert.equal(
        (await app.inject({ url: "/api/sessions?machineId=bad", headers }))
          .statusCode,
        400,
      );
      for (const path of [
        "/api/account/sessions",
        "/api/activity",
        "/api/sessions",
      ])
        assert.equal((await app.inject({ url: path })).statusCode, 401);
      const listed = await app.inject({
        url: "/api/account/sessions",
        headers,
      });
      assert.equal(listed.statusCode, 200);
      assert.equal(
        listed
          .json()
          .sessions.filter((session: { current: boolean }) => session.current)
          .length,
        1,
      );
      assert.equal(listed.json().sessions.length, 2);
      assert.ok(
        !listed.body.includes(digest(current)) &&
          !listed.body.includes(current),
      );
      assert.deepEqual(
        (await app.inject({ url: "/api/activity", headers }))
          .json()
          .events.map((event: { action: string }) => event.action),
        ["machine.enrolled"],
      );
      const rename = (id: string, name: string, origin = headers.origin) =>
        app.inject({
          method: "POST",
          url: `/api/machines/${id}/name`,
          headers: { ...headers, origin },
          payload: { name },
        });
      assert.equal(
        (await rename(ownMachine, "Changed", "https://attacker.test"))
          .statusCode,
        403,
      );
      assert.equal((await rename(alienMachine, "Changed")).statusCode, 404);
      assert.equal((await rename(ownMachine, " ")).statusCode, 400);
      assert.equal(
        (await rename(ownMachine, "Renamed computer")).statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ url: "/api/machines", headers })).json().machines[0]
          .name,
        "Renamed computer",
      );
      const ownActivity = await app.inject({
        url: `/api/activity?machineId=${ownMachine}`,
        headers,
      });
      assert.deepEqual(
        ownActivity
          .json()
          .events.map((event: { action: string }) => event.action),
        ["machine.renamed"],
      );
      assert.equal(
        (
          await app.inject({
            url: `/api/activity?machineId=${alienMachine}`,
            headers,
          })
        ).json().events.length,
        0,
      );
      assert.equal(
        (await app.inject({ url: "/api/activity?machineId=bad", headers }))
          .statusCode,
        400,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/account/sessions/end-others",
            headers: { ...headers, origin: "https://attacker.test" },
            payload: {},
          })
        ).statusCode,
        403,
      );
      assert.equal(
        (
          await app.inject({
            method: "POST",
            url: "/api/account/sessions/end-others",
            headers,
            payload: {},
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await app.inject({
            url: "/api/machines",
            headers: { cookie: `remote_session=${sibling}` },
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (await app.inject({ url: "/api/machines", headers })).statusCode,
        200,
      );
      assert.equal(
        (
          await app.inject({
            url: "/api/machines",
            headers: { cookie: `remote_session=${alien}` },
          })
        ).statusCode,
        200,
      );
    } finally {
      await app.close();
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [
        [account, other],
      ]);
      await pool.end();
    }
  },
);
