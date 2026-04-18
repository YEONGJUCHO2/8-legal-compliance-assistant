import { NextResponse } from "next/server";
import { z } from "zod";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { rerunWithCurrentLaw } from "@/lib/assistant/rerun";
import { requireAuth } from "@/lib/auth/route-guard";
import { parseJsonBody } from "@/lib/http/zod-bad-request";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const rerunRequestSchema = z.object({
  runId: z.string()
});

const postHandler = withRequestLogging<StaticRouteContext>(async (request, logged, _context) => {
  const deps = getAssistantDeps();
  const auth = await requireAuth(request, deps.authStore, deps.now?.());

  if ("response" in auth) {
    return NextResponse.json(
      {
        kind: "auth_expired",
        recoveryUrl: auth.response.body.recoveryUrl
      },
      {
        status: auth.response.status
      }
    );
  }

  const parsedResult = await parseJsonBody({
    request,
    schema: rerunRequestSchema,
    logger: logged.logger
  });

  if (!parsedResult.ok) {
    return parsedResult.response;
  }

  const parsed = parsedResult.data;
  const result = await rerunWithCurrentLaw({
    parentRunId: parsed.runId,
    user: auth.user,
    deps,
    now: deps.now?.(),
    requestId: logged.requestId
  });

  return NextResponse.json(result);
});

export async function POST(request: Request, context: StaticRouteContext) {
  return postHandler(request, context);
}
