import { NextResponse } from "next/server";
import { z } from "zod";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { requestMagicLink } from "@/lib/auth/magic-link";
import { AuthError } from "@/lib/auth/types";
import { getEnv } from "@/lib/env";
import { parseJsonBody } from "@/lib/http/zod-bad-request";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const requestSchema = z.object({
  email: z.string().email()
});

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const realIp = request.headers.get("x-real-ip")?.trim();
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim();

  return forwardedFor || realIp || connectingIp || undefined;
}

const postHandler = withRequestLogging<StaticRouteContext>(async (request, logged, _context) => {
  const deps = getAssistantDeps();
  const parsedResult = await parseJsonBody({
    request,
    schema: requestSchema,
    logger: logged.logger,
    zodMessage: "invalid_email"
  });

  if (!parsedResult.ok) {
    return parsedResult.response;
  }

  const parsed = parsedResult.data;
  const requestUrl = new URL(request.url);
  const now = deps.now?.() ?? new Date();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") ?? undefined;
  const appBaseUrl = (() => {
    try {
      return getEnv().APP_BASE_URL;
    } catch {
      return requestUrl.origin;
    }
  })();

  try {
    const result = await requestMagicLink(deps.authStore, {
      email: parsed.email,
      ip,
      userAgent,
      now,
      appBaseUrl,
      mailer: deps.mailer,
      rateLimitStore: deps.rateLimitStore
    });

    return NextResponse.json({
      ok: true,
      expiresAt: result.expiresAt,
      magicUrl: process.env.NODE_ENV === "production" ? undefined : result.magicUrl
    });
  } catch (error) {
    if (error instanceof AuthError && error.code === "too_many_requests") {
      return NextResponse.json(
        {
          message: "요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요."
        },
        {
          status: 429
        }
      );
    }

    throw error;
  }
});

export async function POST(request: Request, context: StaticRouteContext) {
  return postHandler(request, context);
}
