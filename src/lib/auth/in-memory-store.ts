import { randomUUID } from "node:crypto";

import { AuthError, normalizeEmail, type AuthStore, type IdentityRecord, type MagicLinkRecord, type SessionRecord, type UserRecord } from "@/lib/auth/types";

export function createInMemoryAuthStore(seed?: {
  magicLinks?: MagicLinkRecord[];
  sessions?: SessionRecord[];
  users?: UserRecord[];
  identities?: IdentityRecord[];
}): AuthStore {
  const magicLinks = new Map((seed?.magicLinks ?? []).map((record) => [record.id, { ...record }]));
  const sessions = new Map((seed?.sessions ?? []).map((record) => [record.id, { ...record }]));
  const users = new Map((seed?.users ?? []).map((record) => [record.id, { ...record }]));
  const identities = new Map((seed?.identities ?? []).map((record) => [record.id, { ...record }]));

  return {
    async createMagicLink(record) {
      magicLinks.set(record.id, { ...record });
      return { ...record };
    },
    async findMagicLinkByHash(tokenHash) {
      for (const record of magicLinks.values()) {
        if (record.tokenHash === tokenHash) {
          return { ...record };
        }
      }

      return null;
    },
    async consumeMagicLink(id, consumedAt) {
      const record = magicLinks.get(id);

      if (!record) {
        return null;
      }

      const next = {
        ...record,
        consumedAt
      };
      magicLinks.set(id, next);

      return { ...next };
    },
    async countMagicLinksForEmailSince(email, since) {
      const normalized = normalizeEmail(email);
      let count = 0;

      for (const record of magicLinks.values()) {
        if (record.email === normalized && record.createdAt >= since) {
          count += 1;
        }
      }

      return count;
    },
    async incrementRedemptionAttempts(id) {
      const record = magicLinks.get(id);

      if (!record) {
        return null;
      }

      const next = {
        ...record,
        redemptionAttempts: record.redemptionAttempts + 1
      };
      magicLinks.set(id, next);

      return { ...next };
    },
    async createSession(record) {
      for (const existing of sessions.values()) {
        if (existing.tokenHash === record.tokenHash) {
          throw new AuthError("session_conflict", "Session token hash already exists");
        }
      }

      const next = {
        ...record,
        id: record.id ?? randomUUID()
      };
      sessions.set(next.id, next);
      return { ...next };
    },
    async findSessionByHash(tokenHash) {
      for (const record of sessions.values()) {
        if (record.tokenHash === tokenHash) {
          return { ...record };
        }
      }

      return null;
    },
    async revokeSession(id, revokedAt) {
      const record = sessions.get(id);

      if (!record) {
        return null;
      }

      const next = {
        ...record,
        revokedAt
      };
      sessions.set(id, next);

      return { ...next };
    },
    async findOrCreateUserByEmail({ email, provider, providerSubject, now }) {
      const normalized = normalizeEmail(email);
      const matchingIdentity = [...identities.values()].find(
        (identity) => identity.provider === provider && identity.providerSubject === providerSubject
      );

      if (matchingIdentity) {
        const user = users.get(matchingIdentity.userId);

        if (!user) {
          throw new Error(`identity_without_user:${matchingIdentity.id}`);
        }

        return { ...user };
      }

      const conflictingIdentity = [...identities.values()].find(
        (identity) => normalizeEmail(identity.email ?? "") === normalized && identity.providerSubject !== providerSubject
      );

      if (conflictingIdentity) {
        throw new AuthError("identity_conflict", "Durable identity conflict for email");
      }

      const user: UserRecord = {
        id: randomUUID(),
        internalUserId: randomUUID(),
        createdAt: now
      };
      const identity: IdentityRecord = {
        id: randomUUID(),
        userId: user.id,
        provider,
        providerSubject,
        email: normalized,
        createdAt: now
      };

      users.set(user.id, user);
      identities.set(identity.id, identity);

      return { ...user };
    },
    async findUserById(id) {
      const user = users.get(id);

      return user ? { ...user } : null;
    }
  };
}
