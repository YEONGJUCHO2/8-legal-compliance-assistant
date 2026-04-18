import { getCurrentUser } from "@/lib/auth/session";
import type { AuthStore, UserRecord } from "@/lib/auth/types";

export type AuthExpiredResponse = {
  status: 401;
  body: {
    kind: "auth_expired";
    recoveryUrl: "/login";
  };
};

function getCookieHeader(headers: Headers | Record<string, string | undefined> | undefined) {
  if (!headers) {
    return undefined;
  }

  if (headers instanceof Headers) {
    return headers.get("cookie") ?? undefined;
  }

  return headers.cookie ?? headers.Cookie;
}

export async function requireAuth(
  request: {
    headers?: Headers | Record<string, string | undefined>;
  },
  store: AuthStore,
  now?: string | Date
): Promise<{ user: UserRecord } | { response: AuthExpiredResponse }> {
  const user = await getCurrentUser({
    cookie: getCookieHeader(request.headers),
    store,
    now
  });

  if (!user) {
    return {
      response: {
        status: 401,
        body: {
          kind: "auth_expired",
          recoveryUrl: "/login"
        }
      }
    };
  }

  return { user };
}
