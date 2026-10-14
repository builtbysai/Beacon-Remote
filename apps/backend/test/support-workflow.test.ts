import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { test } from "node:test";
import { Pool } from "pg";
import { createApp } from "../src/app.js";
import { applyMigrations } from "../src/migrations.js";
import { chatMessage } from "../../../packages/protocol/src/index.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

test(
  "chat is private to the two people, notes to the technician, and a handoff leaves exactly one technician in charge",
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
      PORT: 3027,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      CONTROL_ENABLED: "true",
    });
    await app.ready();
    const made: string[] = [];
    const person = async () => {
      const id = randomUUID();
      const token = randomBytes(32).toString("base64url");
      made.push(id);
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
    const first = await person();
    const second = await person();
    const outsider = await person();
    const keys = generateKeyPairSync("ed25519");
    const publicKey = (
      keys.publicKey.export({ format: "der", type: "spki" }) as Buffer
    )
      .subarray(12)
      .toString("base64");
    const post = (who: typeof first, path: string, payload: object) =>
      app.inject({ method: "POST", url: path, headers: who.headers, payload });
    const get = (who: typeof first, path: string) =>
      app.inject({ method: "GET", url: path, headers: who.headers });
    try {
      await post(first, "/api/team", {
        email: second.email,
        role: "technician",
      });
      const link = (
        await post(first, "/api/support-links", { capability: "desktop:view" })
      ).json();
      const claim = (
        await app.inject({
          method: "POST",
          url: "/api/agent/support-claim",
          payload: {
            version: 1,
            token: link.url.slice(link.url.indexOf("=") + 1),
            name: "Their PC",
            publicKey,
          },
        })
      ).json();
      const machine = claim.machineId as string;
      const speak = (since: number, text?: string, key = keys.privateKey) => {
        const timestamp = Date.now();
        const nonce = randomUUID();
        const digest = text ? sha(text) : "";
        return app.inject({
          method: "POST",
          url: "/api/agent/chat",
          payload: {
            version: 1,
            machineId: machine,
            timestamp,
            nonce,
            since,
            ...(text ? { text } : {}),
            signature: sign(
              null,
              Buffer.from(
                chatMessage(machine, timestamp, nonce, since, digest),
              ),
              key,
            ).toString("base64"),
          },
        });
      };

      // The person speaks, the technician answers; both see both.
      assert.equal((await speak(0, "Hello, it is slow")).statusCode, 200);
      assert.equal(
        (await post(first, `/api/machines/${machine}/chat`, { text: "On it" }))
          .statusCode,
        200,
      );
      const seen = (await speak(0)).json();
      assert.deepEqual(
        seen.messages.map((m: { sender: string }) => m.sender),
        ["person", "technician"],
      );
      assert.equal(seen.technician, first.email);
      assert.equal(
        (await get(first, `/api/machines/${machine}/chat`)).json().messages
          .length,
        2,
      );
      // Nobody else can read or write it, and another key cannot speak for the person.
      for (const who of [second, outsider]) {
        assert.equal(
          (await get(who, `/api/machines/${machine}/chat`)).statusCode,
          404,
        );
        assert.equal(
          (await post(who, `/api/machines/${machine}/chat`, { text: "hi" }))
            .statusCode,
          404,
        );
      }
      const other = generateKeyPairSync("ed25519");
      assert.equal(
        (await speak(0, "forged", other.privateKey)).statusCode,
        401,
      );

      // Notes are the technician's own.
      assert.equal(
        (
          await post(first, `/api/support-links/${link.id}/notes`, {
            notes: "Reset router",
          })
        ).statusCode,
        200,
      );
      assert.equal(
        (
          await post(outsider, `/api/support-links/${link.id}/notes`, {
            notes: "x",
          })
        ).statusCode,
        404,
      );
      const listed = (await get(first, "/api/support-links")).json().links[0];
      assert.equal(listed.notes, "Reset router");

      // Only one of the owner's own technicians can take over.
      assert.equal(
        (
          await post(first, `/api/support-links/${link.id}/handoff`, {
            email: outsider.email,
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await post(outsider, `/api/support-links/${link.id}/handoff`, {
            email: second.email,
          })
        ).statusCode,
        404,
      );
      assert.equal(
        (
          await post(first, `/api/support-links/${link.id}/handoff`, {
            email: second.email,
          })
        ).statusCode,
        200,
      );
      assert.equal((await speak(0)).json().technician, second.email);
      assert.equal(
        (await get(first, `/api/machines/${machine}/chat`)).statusCode,
        404,
      );
      const now = await get(second, `/api/machines/${machine}/chat`);
      assert.equal(now.json().messages.at(-1).sender, "system");
      assert.equal(
        (await get(second, "/api/support-links")).json().links.length,
        1,
      );
      assert.equal(
        (await post(second, `/api/support-links/${link.id}/end`, {}))
          .statusCode,
        200,
      );
    } finally {
      await pool.query("DELETE FROM accounts WHERE id=ANY($1::uuid[])", [made]);
      await app.close();
      await pool.end();
    }
  },
);
