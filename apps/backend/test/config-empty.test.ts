import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { parseConfig } from "../src/config.js";

test("settings passed through empty (as Compose does) mean not set, not invalid", () => {
  const config = parseConfig({
    DATABASE_URL: "postgresql://u:p@localhost/db_test",
    WEB_ORIGIN: "https://remote.example.test",
    NODE_ENV: "production",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    STUN_URL: "",
    RESEND_API_KEY: "",
    MAIL_FROM: "",
    PUBLIC_SIGNUP: "",
    TURN_URLS: "",
    TURN_SECRET: "",
  });
  assert.equal(config.STUN_URL, undefined);
  assert.equal(config.PUBLIC_SIGNUP, undefined);
  assert.equal(config.TURN_URLS, undefined);
  // A real value is still checked.
  assert.throws(() =>
    parseConfig({
      DATABASE_URL: "postgresql://u:p@localhost/db_test",
      WEB_ORIGIN: "https://remote.example.test",
      STUN_URL: "not-a-stun-url",
    }),
  );
});
