// Outgoing email through Resend's HTTPS API. Used only for the two messages an account needs: confirming an
// address and recovering a password. Nothing else is ever sent, and message bodies never reach the logs.
import type { Config } from "./config.js";

export type Mail = { to: string; subject: string; text: string };
export type Mailer = { send(mail: Mail): Promise<void> };

/** The configured mailer, or null when sending is not set up (sign-up and email recovery stay closed). */
export function createMailer(config: Config): Mailer | null {
  const key = config.RESEND_API_KEY;
  const from = config.MAIL_FROM;
  if (!key || !from) return null;
  return {
    async send(mail) {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [mail.to],
          subject: mail.subject,
          text: mail.text,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok)
        throw new Error(`Mail provider refused (${response.status})`);
    },
  };
}
