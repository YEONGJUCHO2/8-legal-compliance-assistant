// One-shot SMTP smoke. Sends a real message to the address in argv[0] (defaults to
// AUTH_FROM_EMAIL). Exits 0 on 250 OK from the relay, non-zero on any transport
// failure. Intentionally excluded from the test suite — this is a manual probe.

import { createSmtpMailer } from "../src/lib/auth/email-smtp";
import { getEnv } from "../src/lib/env";

async function main() {
  const env = getEnv();

  if (!env.SMTP_URL) {
    throw new Error("SMTP_URL is not configured");
  }

  if (!env.AUTH_FROM_EMAIL) {
    throw new Error("AUTH_FROM_EMAIL is not configured");
  }

  const recipient = process.argv[2] ?? env.AUTH_FROM_EMAIL;
  const mailer = createSmtpMailer({
    smtpUrl: env.SMTP_URL,
    fromEmail: env.AUTH_FROM_EMAIL,
    appBaseUrl: env.APP_BASE_URL
  });

  const startedAt = Date.now();
  const magicUrl = `${env.APP_BASE_URL.replace(/\/$/, "")}/api/auth/callback?token=smoke-${Date.now()}&state=smoke-state`;

  await mailer.send({
    to: recipient,
    magicUrl,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString()
  });

  const elapsedMs = Date.now() - startedAt;

  console.log(
    JSON.stringify(
      {
        ok: true,
        to: recipient,
        from: env.AUTH_FROM_EMAIL,
        elapsedMs
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: String(error?.message ?? error) }));
  process.exitCode = 1;
});
