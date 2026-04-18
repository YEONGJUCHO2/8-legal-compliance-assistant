import type { Sql } from "postgres";

export type MagicLinkRecord = {
  id: string;
  tokenHash: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string;
  ip?: string;
  userAgent?: string;
  state: string;
  redemptionAttempts: number;
};

export type SessionRecord = {
  id: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt?: string;
  ip?: string;
  userAgent?: string;
};

export type UserRecord = {
  id: string;
  internalUserId: string;
  displayName?: string;
  createdAt: string;
  deletedAt?: string;
};

export type IdentityRecord = {
  id: string;
  userId: string;
  provider: "magic_link" | "oidc" | "saml";
  providerSubject: string;
  email?: string;
  createdAt: string;
};

export interface AuthStore {
  createMagicLink(record: MagicLinkRecord): Promise<MagicLinkRecord>;
  findMagicLinkByHash(tokenHash: string): Promise<MagicLinkRecord | null>;
  consumeMagicLink(id: string, consumedAt: string): Promise<MagicLinkRecord | null>;
  countMagicLinksForEmailSince(email: string, since: string): Promise<number>;
  incrementRedemptionAttempts(id: string): Promise<MagicLinkRecord | null>;
  createSession(record: Omit<SessionRecord, "id"> & { id?: string }): Promise<SessionRecord>;
  findSessionByHash(tokenHash: string): Promise<SessionRecord | null>;
  revokeSession(id: string, revokedAt: string): Promise<SessionRecord | null>;
  findOrCreateUserByEmail(input: {
    email: string;
    provider: IdentityRecord["provider"];
    providerSubject: string;
    now: string;
  }): Promise<UserRecord>;
  findUserById(id: string): Promise<UserRecord | null>;
}

export type PgAuthStore = AuthStore & {
  db: Sql;
};

export type AuthErrorCode =
  | "too_many_requests"
  | "token_not_found"
  | "token_already_used"
  | "token_expired"
  | "state_mismatch"
  | "token_redemption_limit"
  | "identity_conflict"
  | "auth_expired";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = "AuthError";
    this.code = code;
  }
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
