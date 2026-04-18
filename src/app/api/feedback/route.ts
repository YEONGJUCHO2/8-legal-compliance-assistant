import { NextResponse } from "next/server";
import { z } from "zod";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { requireAuth } from "@/lib/auth/route-guard";
import { parseJsonBody } from "@/lib/http/zod-bad-request";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const feedbackRequestSchema = z.object({
  runId: z.string(),
  feedbackType: z.enum(["helpful", "wrong_citation", "wrong_conclusion"])
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
    schema: feedbackRequestSchema,
    logger: logged.logger
  });

  if (!parsedResult.ok) {
    return parsedResult.response;
  }

  const parsed = parsedResult.data;
  const run = await deps.historyStore.getRun(parsed.runId);

  if (!run || run.user_id !== auth.user.id) {
    return NextResponse.json(
      {
        kind: "error",
        message: "run_not_found"
      },
      {
        status: 404
      }
    );
  }

  const result = await deps.historyStore.recordFeedback({
    runId: parsed.runId,
    userId: auth.user.id,
    feedbackType: parsed.feedbackType,
    now: (deps.now?.() ?? new Date()).toISOString()
  });

  return NextResponse.json({
    ok: result.ok,
    recordedAt: result.recordedAt
  });
});

export async function POST(request: Request, context: StaticRouteContext) {
  return postHandler(request, context);
}
