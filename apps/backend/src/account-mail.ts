// Shared account mail: no remote images/fonts, tracking or raw HTML inputs.
export type AccountMailKind = "verify" | "recover" | "existing";
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );

export function accountMail(
  kind: AccountMailKind,
  url: string,
  expires?: string,
) {
  const actionUrl = new URL(url);
  if (
    !["https:", "http:"].includes(actionUrl.protocol) ||
    actionUrl.username ||
    actionUrl.password
  )
    throw new Error("Invalid account mail link");
  const content =
    kind === "verify"
      ? {
          subject: "Confirm your Beacon Remote account",
          title: "Confirm your email",
          action: "Confirm email",
          intro:
            "Confirm your email address to finish creating your Beacon Remote account.",
          expiry: `This link works once and expires in ${expires}.`,
          footer:
            "If you didn’t sign up, ignore this email. Your address will not be confirmed.",
        }
      : kind === "recover"
        ? {
            subject: "Reset your Beacon Remote password",
            title: "Reset your password",
            action: "Reset password",
            intro:
              "Use this link to choose a new password for your Beacon Remote account.",
            expiry: `This link works once and expires in ${expires}.`,
            footer:
              "If you didn’t request this, ignore this email. Your password has not changed.",
          }
        : {
            subject: "Beacon Remote sign-up",
            title: "You already have an account",
            action: "Open Beacon Remote",
            intro:
              "Someone tried to sign up with this email address, which already has a Beacon Remote account.",
            expiry:
              "If this was you, sign in or choose Forgot password on the sign-in page.",
            footer:
              "If this wasn’t you, ignore this email. Your account has not changed.",
          };
  if (kind !== "existing" && (!expires || expires.length > 40))
    throw new Error("Missing account mail expiry");
  const href = escape(actionUrl.href);
  const text = `Beacon Remote\n\n${content.title}\n\n${content.intro}\n\n${content.action}:\n${actionUrl.href}\n\n${content.expiry}\n\n${content.footer}\n`;
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(content.subject)}</title>
<style>@media(prefers-color-scheme:dark){body,.canvas{background:#111820!important}.card{background:#19222d!important;border-color:#313d4d!important}.copy{color:#e8eef7!important}.muted{color:#a1aec0!important}.link{color:#97bcfc!important}}</style></head>
<body style="margin:0;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#192941">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">${escape(content.intro)} ${escape(content.expiry)}</div>
<table role="presentation" class="canvas" style="width:100%;background:#f5f7fa;border-collapse:collapse"><tr><td style="padding:32px 16px">
<table role="presentation" class="card" align="center" style="width:100%;max-width:560px;border:1px solid #dce3eb;border-radius:10px;background:#fff;border-collapse:separate"><tr><td style="padding:32px">
<p class="muted" style="margin:0 0 28px;font-size:13px;font-weight:bold;letter-spacing:1px;color:#566680">BEACON REMOTE</p>
<h1 class="copy" style="margin:0 0 16px;font-size:24px;line-height:1.25;color:#192941">${escape(content.title)}</h1>
<p class="copy" style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#192941">${escape(content.intro)}</p>
<table role="presentation" style="border-collapse:collapse"><tr><td style="border-radius:6px;background:#2158bd"><a href="${href}" style="display:inline-block;padding:14px 22px;font-size:15px;font-weight:bold;color:#fff;text-decoration:none">${escape(content.action)}</a></td></tr></table>
<p class="copy" style="margin:20px 0;font-size:14px;line-height:1.6;color:#192941">${escape(content.expiry)}</p>
<p class="muted" style="margin:24px 0 8px;font-size:12px;line-height:1.6;color:#566680">If the button doesn’t work, open this link:</p>
<p style="margin:0 0 24px;font-size:12px;line-height:1.6;overflow-wrap:anywhere;word-break:break-all"><a class="link" href="${href}" style="color:#2158bd">${href}</a></p>
<p class="muted" style="margin:0;padding-top:20px;border-top:1px solid #dce3eb;font-size:12px;line-height:1.6;color:#566680">${escape(content.footer)}</p>
</td></tr></table></td></tr></table></body></html>`;
  return { subject: content.subject, text, html };
}
