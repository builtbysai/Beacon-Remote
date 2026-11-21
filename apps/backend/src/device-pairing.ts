import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";
import { ENROLLMENT_CODE_ALPHABET } from "../../../packages/protocol/src/index.js";
import { syncTeam } from "./team.js";

// A phone can ask to be paired: it shows a short code, and a person signed in to the workspace types that code in and
// approves it. The request lives in memory for ten minutes (one backend instance owns the database), holds only the
// phone's name and public key, and is gone once approved and collected or when it expires.
const REQUEST_MINUTES = 10;
const MAX_PENDING = 500;
const MAX_MACHINES = 50;
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

type Pending = {
  name: string;
  publicKey: string;
  pollHash: string;
  expires: number;
  machineId?: string;
};

const start = z
  .object({
    version: z.literal(1),
    name: z.string().trim().min(1).max(80),
    publicKey: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  })
  .strict();
const poll = z
  .object({ pollToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
const userCodeBody = z
  .object({
    userCode: z
      .string()
      .trim()
      .max(16)
      .transform((value) => value.replace(/[ -]/g, "").toUpperCase())
      .refine((value) =>
        new RegExp(`^[${ENROLLMENT_CODE_ALPHABET}]{8}$`).test(value),
      ),
  })
  .strict();

const shown = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function registerDevicePairing(
  app: FastifyInstance,
  pool: Pool,
  owner: (request: FastifyRequest) => Promise<string | null>,
  sameOrigin: (request: FastifyRequest) => boolean,
) {
  const pending = new Map<string, Pending>();
  const sweep = () => {
    const now = Date.now();
    for (const [key, entry] of pending)
      if (entry.expires <= now) pending.delete(key);
  };
  const limit = (max: number) => ({
    config: { rateLimit: { max, timeWindow: "1 minute" } },
  });

  app.post("/api/device-pairing/start", limit(10), async (request, reply) => {
    const parsed = start.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid pairing request" });
    sweep();
    if (pending.size >= MAX_PENDING)
      return reply.code(503).send({ error: "Try again in a few minutes" });
    let code = "";
    for (let tries = 0; tries < 5; tries++) {
      const candidate = Array.from(
        { length: 8 },
        () =>
          ENROLLMENT_CODE_ALPHABET[randomInt(ENROLLMENT_CODE_ALPHABET.length)],
      ).join("");
      if (!pending.has(digest(candidate))) {
        code = candidate;
        break;
      }
    }
    if (!code)
      return reply.code(503).send({ error: "Try again in a few minutes" });
    const pollToken = randomBytes(32).toString("base64url");
    pending.set(digest(code), {
      name: parsed.data.name,
      publicKey: parsed.data.publicKey,
      pollHash: digest(pollToken),
      expires: Date.now() + REQUEST_MINUTES * 60_000,
    });
    reply.header("Cache-Control", "no-store");
    return {
      version: 1,
      userCode: shown(code),
      pollToken,
      expiresInSeconds: REQUEST_MINUTES * 60,
      intervalSeconds: 2,
    };
  });

  app.post("/api/device-pairing/poll", limit(90), async (request, reply) => {
    const parsed = poll.safeParse(request.body);
    if (!parsed.success)
      return reply.code(400).send({ error: "Invalid pairing request" });
    sweep();
    const pollHash = digest(parsed.data.pollToken);
    for (const [key, entry] of pending) {
      if (entry.pollHash !== pollHash) continue;
      reply.header("Cache-Control", "no-store");
      if (!entry.machineId) return { status: "pending" };
      pending.delete(key);
      return {
        status: "approved",
        machineId: entry.machineId,
        heartbeatIntervalSeconds: 15,
      };
    }
    reply.header("Cache-Control", "no-store");
    return { status: "expired" };
  });

  // What the signed-in person is about to approve.
  app.post("/api/device-pairing/lookup", limit(20), async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    if (!(await owner(request)))
      return reply.code(401).send({ error: "Sign in required" });
    const parsed = userCodeBody.safeParse(request.body);
    sweep();
    const entry = parsed.success
      ? pending.get(digest(parsed.data.userCode))
      : undefined;
    if (!entry || entry.machineId)
      return reply.code(404).send({ error: "That code was not found" });
    reply.header("Cache-Control", "no-store");
    return {
      name: entry.name,
      expiresInSeconds: Math.max(
        0,
        Math.round((entry.expires - Date.now()) / 1000),
      ),
    };
  });

  app.post("/api/device-pairing/approve", limit(10), async (request, reply) => {
    if (!sameOrigin(request))
      return reply.code(403).send({ error: "Origin rejected" });
    const account = await owner(request);
    if (!account) return reply.code(401).send({ error: "Sign in required" });
    const parsed = userCodeBody.safeParse(request.body);
    sweep();
    const key = parsed.success ? digest(parsed.data.userCode) : "";
    const entry = pending.get(key);
    if (!entry || entry.machineId)
      return reply.code(404).send({ error: "That code was not found" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query(
        "SELECT count(*)::int AS n FROM machines WHERE account_id=$1 AND revoked_at IS NULL AND support_link_id IS NULL",
        [account],
      );
      if (owned.rows[0].n >= MAX_MACHINES) {
        await client.query("ROLLBACK");
        return reply.code(403).send({ error: "Too many devices" });
      }
      const id = randomUUID();
      await client.query(
        "INSERT INTO machines(id,account_id,name,public_key) VALUES ($1,$2,$3,$4)",
        [id, account, entry.name, Buffer.from(entry.publicKey, "base64")],
      );
      await client.query(
        "INSERT INTO audit_events(account_id,machine_id,action) VALUES ($1,$2,$3)",
        [account, id, "machine.enrolled"],
      );
      await syncTeam(client, account);
      await client.query("COMMIT");
      entry.machineId = id;
      return { version: 1, machineId: id, name: entry.name };
    } catch {
      await client.query("ROLLBACK");
      return reply.code(409).send({ error: "Pairing unavailable" });
    } finally {
      client.release();
    }
  });
}
