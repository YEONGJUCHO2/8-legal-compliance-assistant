import { NextResponse } from "next/server";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { consumeMagicLink } from "@/lib/auth/magic-link";
import { setSessionCookieHeader } from "@/lib/auth/session";
import { AuthError } from "@/lib/auth/types";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const getHandler = withRequestLogging<StaticRouteContext>(async (request, _logged, _context) => {
  const deps = getAssistantDeps();
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  const state = url.searchParams.get("state");

  if (!token || !state) {
    return NextResponse.redirect(new URL("/login?error=token_not_found", request.url));
  }

  try {
    const session = await consumeMagicLink(deps.authStore, {
      token,
      state,
      now: deps.now?.()
    });
    const cookie = setSessionCookieHeader(session.sessionToken, session.sessionExpiresAt);
    const response = NextResponse.redirect(new URL("/", request.url));
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error) {
    const code = error instanceof AuthError ? error.code : "auth_expired";
    return NextResponse.redirect(new URL(`/login?error=${code}`, request.url));
  }
});

export async function GET(request: Request, context: StaticRouteContext) {
  return getHandler(request, context);
}
