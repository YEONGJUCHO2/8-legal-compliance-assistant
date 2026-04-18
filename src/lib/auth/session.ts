import { hashToken } from "@/lib/auth/tokens";
import { AuthError, type AuthStore } from "@/lib/auth/types";

const SESSION_COOKIE_NAME = "app_session";

function readCookieValue(cookieHeader: string | undefined, name: string) {
  if (!cookieHeader) {
    return null;
  }

  const parts = cookieHeader.split(";").map((part) => part.trim());

  for (const part of parts) {
    const [key, ...rest] = part.split("=");

    if (key === name) {
      return rest.join("=") || null;
    }
  }

  return null;
}

function toIsoString(value?: string | Date) {
  return (value instanceof Date ? value : value ? new Date(value) : new Date()).toISOString();
}

export async function getCurrentUser({
  cookie,
  store,
  now
}: {
  cookie?: string;
  store: AuthStore;
  now?: string | Date;
}) {
  const token = readCookieValue(cookie, SESSION_COOKIE_NAME);

  if (!token) {
    return null;
  }

  const session = await store.findSessionByHash(hashToken(token));
  const currentTime = toIsoString(now);

  if (!session || session.revokedAt || session.expiresAt <= currentTime) {
    return null;
  }

  const user = await store.findUserById(session.userId);

  if (!user || user.deletedAt) {
    return null;
  }

  return user;
}

export async function getCurrentUserOrThrow(input: {
  cookie?: string;
  store: AuthStore;
  now?: string | Date;
}) {
  const user = await getCurrentUser(input);

  if (!user) {
    throw new AuthError("auth_expired", "Authentication expired");
  }

  return user;
}

export function setSessionCookieHeader(token: string, expiresAt: string) {
  return {
    name: SESSION_COOKIE_NAME,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
      expires: new Date(expiresAt)
    }
  };
}

export function clearSessionCookieHeader() {
  return {
    name: SESSION_COOKIE_NAME,
    value: "",
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: true,
      path: "/",
      expires: new Date(0),
      maxAge: 0
    }
  };
}
