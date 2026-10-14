import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test(
  "a team member is shared the computers in scope, kept in step as they change, and loses them on removal",
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
      PORT: 3023,
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
    const member = await person();
    const stranger = await person();
    const machine = async (group: string | null) => {
      const id = randomUUID();
      await pool.query(
        "INSERT INTO machines(id,account_id,name,public_key,group_name) VALUES ($1,$2,'PC',$3,$4)",
        [id, owner.id, randomBytes(32), group],
      );
      return id;
    };
    const post = (who: typeof owner, path: string, payload: object) =>
      app.inject({ method: "POST", url: path, headers: who.headers, payload });
    const shared = async () =>
      (
        await app.inject({
          method: "GET",
          url: "/api/shared",
          headers: member.headers,
        })
      ).json().shared as {
        id: string;
        capability: string;
        team: boolean;
        expiresAtMillis: number | null;
        ownerEmail: string;
      }[];
    try {
      const office = await machine("Office");
      const home = await machine(null);

      // Only a signed-in owner can manage a team, and only existing other accounts can join.
      const anonymous = await app.inject({
        method: "POST",
        url: "/api/team",
        headers: { origin },
        payload: { email: member.email, role: "viewer" },
      });
      assert.equal(anonymous.statusCode, 401);
      assert.equal(
        (await post(owner, "/api/team", { email: owner.email, role: "viewer" }))
          .statusCode,
        404,
      );
      assert.equal(
        (
          await post(owner, "/api/team", {
            email: "nobody@example.test",
            role: "viewer",
          })
        ).statusCode,
        404,
      );

      // A viewer on everything: both computers, view only, no expiry, and the owner named.
      assert.equal(
        (
          await post(owner, "/api/team", {
            email: member.email,
            role: "viewer",
          })
        ).statusCode,
        200,
      );
      let list = await shared();
      assert.equal(list.length, 2);
      assert.ok(list.every((entry) => entry.capability === "desktop:view"));
      assert.ok(
        list.every((entry) => entry.team && entry.expiresAtMillis === null),
      );
      assert.equal(list[0]!.ownerEmail, owner.email);

      // A technician for one group: control, and only that group's computer.
      assert.equal(
        (
          await post(owner, "/api/team", {
            email: member.email,
            role: "technician",
            group: "Office",
          })
        ).statusCode,
        200,
      );
      list = await shared();
      assert.deepEqual(
        list.map((entry) => entry.capability),
        ["desktop:control"],
      );
      const members = (
        await app.inject({
          method: "GET",
          url: "/api/team",
          headers: owner.headers,
        })
      ).json().members;
      assert.equal(members.length, 1);
      assert.equal(members[0].group, "Office");
      assert.equal(members[0].computers, 1);

      // Putting the other computer in the group, or enrolling a new one there, brings it in.
      assert.equal(
        (
          await post(owner, `/api/machines/${home}/name`, {
            name: "Home",
            group: "Office",
          })
        ).statusCode,
        200,
      );
      assert.equal((await shared()).length, 2);
      const code = randomBytes(24).toString("base64url");
      await pool.query(
        "INSERT INTO enrollments VALUES ($1,$2,now()+interval '5 minutes',NULL)",
        [sha(code), owner.id],
      );
      const enrolled = await app.inject({
        method: "POST",
        url: "/api/agent/enroll",
        payload: {
          version: 1,
          code,
          name: "New PC",
          publicKey: randomBytes(32).toString("base64"),
        },
      });
      assert.equal(enrolled.statusCode, 200);
      // It has no group yet, so it is outside this team's scope until it is given one.
      assert.equal((await shared()).length, 2);
      await post(owner, `/api/machines/${enrolled.json().machineId}/name`, {
        name: "New PC",
        group: "Office",
      });
      assert.equal((await shared()).length, 3);

      // A share that comes from the team cannot be revoked one by one, or it would return.
      const owned = (
        await app.inject({
          method: "GET",
          url: `/api/machines/${office}/relationships`,
          headers: owner.headers,
        })
      ).json().relationships;
      assert.equal(owned[0].team, true);
      assert.equal(
        (await post(owner, `/api/relationships/${owned[0].id}/revoke`, {}))
          .statusCode,
        409,
      );

      // Revoking a computer takes it out of the team's reach.
      await post(owner, `/api/machines/${home}/revoke`, {});
      assert.equal((await shared()).length, 2);

      // Removal takes everything away; another account's team is untouched.
      const added = (
        await app.inject({
          method: "GET",
          url: "/api/team",
          headers: owner.headers,
        })
      ).json().members[0].id;
      assert.equal(
        (await post(stranger, `/api/team/${added}/remove`, {})).statusCode,
        404,
      );
      assert.equal(
        (await post(owner, `/api/team/${added}/remove`, {})).statusCode,
        200,
      );
      assert.equal((await shared()).length, 0);
    } finally {
      for (const who of [owner, member, stranger])
        await pool.query("DELETE FROM accounts WHERE id=$1", [who.id]);
      await app.close();
      await pool.end();
    }
  },
);
