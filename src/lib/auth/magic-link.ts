import { randomUUID } from "node:crypto";

import { createConsoleMailer, type MagicLinkMailer } from "@/lib/auth/email";
import { generateState, generateToken, hashToken } from "@/lib/auth/tokens";
import { AuthError, normalizeEmail, type AuthStore } from "@/lib/auth/types";
import { checkRateLimit, type RateLimitStore } from "@/lib/rate-limit";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAGIC_LINK_EMAIL_LIMIT_PER_HOUR = 5;
const MAGIC_LINK_BACKSTOP_LIMIT_PER_HOUR = 10;

function toAbuseKey(ip?: string, userAgent?: string) {
  if (ip) {
    return `ip:${ip}`;
  }

  if (userAgent) {
    return `ua:${userAgent}`;
  }

  return null;
}

function toDate(value?: string | Date) {
  return value instanceof Date ? value : value ? new Date(value) : new Date();
}

function toIsoString(value?: string | Date) {
  return toDate(value).toISOString();
}

export async function requestMagicLink(
  store: AuthStore,
  {
    email,
    ip,
    userAgent,
    now,
    appBaseUrl,
    ttlMinutes = 15,
    rateLimitStore,
    mailer = createConsoleMailer()
  }: {
    email: string;
    ip?: string;
    userAgent?: string;
    now?: string | Date;
    appBaseUrl: string;
    ttlMinutes?: number;
    rateLimitStore?: RateLimitStore & {
      capacity?: number;
      refillPerSec?: number;
    };
    mailer?: MagicLinkMailer;
  }
) {
  const issuedAt = toDate(now);
  const issuedAtIso = issuedAt.toISOString();
  const normalizedEmail = normalizeEmail(email);
  const count = await store.countMagicLinksForEmailSince(
    normalizedEmail,
    new Date(issuedAt.getTime() - HOUR_MS).toISOString()
  );

  if (count >= MAGIC_LINK_EMAIL_LIMIT_PER_HOUR) {
    throw new AuthError("too_many_requests", "Magic link rate limit exceeded");
  }

  const abuseKey = toAbuseKey(ip, userAgent);

  if (rateLimitStore && abuseKey) {
    const abuseLimit = await checkRateLimit(
      {
        ...rateLimitStore,
        capacity: MAGIC_LINK_BACKSTOP_LIMIT_PER_HOUR,
        refillPerSec: MAGIC_LINK_BACKSTOP_LIMIT_PER_HOUR / 3600
      },
      `magic-link:${abuseKey}`,
      issuedAt
    );

    if (!abuseLimit.allowed) {
      throw new AuthError("too_many_requests", "Magic link rate limit exceeded");
    }
  }

  const token = generateToken();
  const state = generateState();
  const expiresAt = new Date(issuedAt.getTime() + ttlMinutes * 60 * 1000).toISOString();
  const baseUrl = appBaseUrl.replace(/\/$/, "");
  const magicUrl = `${baseUrl}/login?token=${token}&state=${state}`;

  await store.createMagicLink({
    id: randomUUID(),
    tokenHash: hashToken(token),
    email: normalizedEmail,
    createdAt: issuedAtIso,
    expiresAt,
    ip,
    userAgent,
    state,
    redemptionAttempts: 0
  });

  await mailer.send({
    to: normalizedEmail,
    magicUrl,
    expiresAt
  });

  return {
    magicUrl,
    expiresAt,
    state
  };
}

export async function consumeMagicLink(
  store: AuthStore,
  {
    token,
    state,
    ip,
    userAgent,
    now,
    sessionTtlDays = 7
  }: {
    token: string;
    state: string;
    ip?: string;
    userAgent?: string;
    now?: string | Date;
    sessionTtlDays?: number;
  }
) {
  const redeemedAt = toDate(now);
  const redeemedAtIso = redeemedAt.toISOString();
  const record = await store.findMagicLinkByHash(hashToken(token));

  if (!record) {
    throw new AuthError("token_not_found", "Magic link token not found");
  }

  if (record.consumedAt) {
    throw new AuthError("token_already_used", "Magic link token already consumed");
  }

  if (record.expiresAt <= redeemedAtIso) {
    throw new AuthError("token_expired", "Magic link token expired");
  }

  if (record.redemptionAttempts >= 3) {
    throw new AuthError("token_redemption_limit", "Magic link redemption attempts exhausted");
  }

  if (record.state !== state) {
    await store.incrementRedemptionAttempts(record.id);
    throw new AuthError("state_mismatch", "Magic link state mismatch");
  }

  await store.consumeMagicLink(record.id, redeemedAtIso);

  const user = await store.findOrCreateUserByEmail({
    email: record.email,
    provider: "magic_link",
    providerSubject: `magic:${record.email}`,
    now: redeemedAtIso
  });
  const sessionToken = generateToken();
  const sessionExpiresAt = new Date(redeemedAt.getTime() + sessionTtlDays * DAY_MS).toISOString();

  await store.createSession({
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashToken(sessionToken),
    createdAt: redeemedAtIso,
    expiresAt: sessionExpiresAt,
    ip,
    userAgent
  });

  return {
    userId: user.id,
    sessionToken,
    sessionExpiresAt
  };
}
