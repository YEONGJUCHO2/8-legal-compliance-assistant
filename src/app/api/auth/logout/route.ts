import { NextResponse } from "next/server";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { clearSessionCookieHeader } from "@/lib/auth/session";
import { hashToken } from "@/lib/auth/tokens";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 15;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const SESSION_COOKIE_NAME = "app_session";

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";").map((segment) => segment.trim())) {
    const [key, ...rest] = part.split("=");

    if (key === name) {
      return rest.join("=") || null;
    }
  }

  return null;
}

const postHandler = withRequestLogging<StaticRouteContext>(async (request, _logged, _context) => {
  const deps = getAssistantDeps();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
  const now = deps.now?.() ?? new Date();
  const nowIso = (now instanceof Date ? now : new Date(now)).toISOString();

  if (token) {
    const session = await deps.authStore.findSessionByHash(hashToken(token));

    if (session && !session.revokedAt) {
      await deps.authStore.revokeSession(session.id, nowIso);
    }
  }

  const cookie = clearSessionCookieHeader();
  const response = NextResponse.json({
    ok: true
  });
  response.cookies.set(cookie.name, cookie.value, cookie.options);
  return response;
});

export async function POST(request: Request, context: StaticRouteContext) {
  return postHandler(request, context);
}
