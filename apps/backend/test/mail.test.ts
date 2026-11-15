import assert from "node:assert/strict";
import { test } from "node:test";
import { accountMail } from "../src/account-mail.js";
import { createMailer } from "../src/mail.js";
import type { Config } from "../src/config.js";

test("account mail keeps the same usable action/expiry in escaped HTML and plain text", () => {
  for (const kind of ["verify", "recover", "existing"] as const) {
    const url = `https://remote.example.test/#${kind}=dummy&label=<unsafe>`;
    const mail = accountMail(kind, url, "30 minutes");
    assert.ok(mail.text.includes(new URL(url).href));
    assert.ok(mail.html.includes(new URL(url).href.replaceAll("&", "&amp;")));
    assert.ok(!mail.html.includes("<unsafe>"));
    assert.ok(!/<img|<script|@import|url\(/i.test(mail.html));
    if (kind !== "existing") {
      assert.match(mail.text, /works once and expires in 30 minutes/);
      assert.match(mail.html, /works once and expires in 30 minutes/);
    }
  }
  assert.throws(() => accountMail("verify", "javascript:alert(1)", "1 hour"));
  assert.throws(() =>
    accountMail("verify", "https://user:password@example.test", "1 hour"),
  );
  assert.throws(() => accountMail("recover", "https://example.test"));
});

test("provider receives both bodies and failures disclose status without credentials or content", async (context) => {
  const mail = {
    to: "fixture@example.test",
    ...accountMail(
      "verify",
      "https://remote.example.test/#verify=dummy",
      "24 hours",
    ),
  };
  let payload: Record<string, unknown> | undefined;
  context.mock.method(
    globalThis,
    "fetch",
    async (_url: string, options: RequestInit) => {
      payload = JSON.parse(String(options.body));
      return new Response(null, { status: 202 });
    },
  );
  const sender = createMailer({
    RESEND_API_KEY: "fixture-key-not-real",
    MAIL_FROM: "Beacon Remote <no-reply@example.test>",
  } as Config)!;
  await sender.send(mail);
  assert.equal(payload?.html, mail.html);
  assert.equal(payload?.text, mail.text);
  context.mock.method(
    globalThis,
    "fetch",
    async () => new Response("private provider error", { status: 503 }),
  );
  await assert.rejects(sender.send(mail), {
    message: "Mail provider refused (503)",
  });
});
