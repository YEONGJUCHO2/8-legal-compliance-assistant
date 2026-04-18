import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { AskRequestSchema, isFutureReferenceDate } from "@/lib/assistant/ask-schema";
import { getAssistantDeps } from "@/lib/assistant/deps";
import { rerunWithCurrentLaw } from "@/lib/assistant/rerun";
import { runQuery } from "@/lib/assistant/run-query";
import { requireAuth } from "@/lib/auth/route-guard";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

function mapZodError(error: ZodError) {
  const futureDateIssue = error.issues.find((issue) => issue.message === "future_reference_date_not_supported");

  if (futureDateIssue) {
    return NextResponse.json(
      {
        kind: "error",
        message: "future_reference_date_not_supported"
      },
      {
        status: 400
      }
    );
  }

  return NextResponse.json(
    {
      kind: "error",
      message: "invalid_request"
    },
    {
      status: 400
    }
  );
}

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

  let parsed;

  try {
    parsed = AskRequestSchema.parse(await request.json());
  } catch (error) {
    if (error instanceof ZodError) {
      return mapZodError(error);
    }

    return NextResponse.json(
      {
        kind: "error",
        message: "invalid_json"
      },
      {
        status: 400
      }
    );
  }

  if (parsed.mode === "ask" && isFutureReferenceDate(parsed.referenceDate, deps.today?.() ?? new Date().toISOString().slice(0, 10))) {
    return NextResponse.json(
      {
        kind: "error",
        message: "future_reference_date_not_supported"
      },
      {
        status: 400
      }
    );
  }

  const result =
    parsed.mode === "rerun_current_law"
      ? await rerunWithCurrentLaw({
          parentRunId: parsed.parentRunId,
          user: auth.user,
          deps,
          now: deps.now?.(),
          requestId: logged.requestId
        })
      : await runQuery({
          request: parsed,
          user: auth.user,
          deps,
          now: deps.now?.(),
          requestId: logged.requestId
        });

  return NextResponse.json(result, {
    status:
      result.kind === "idempotency_conflict"
        ? 409
        : result.kind === "rate_limited"
          ? 429
          : 200
  });
});

export async function POST(request: Request, context: StaticRouteContext) {
  return postHandler(request, context);
}
