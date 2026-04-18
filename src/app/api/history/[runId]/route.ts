import { NextResponse } from "next/server";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { requireAuth } from "@/lib/auth/route-guard";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

const getHandler = withRequestLogging<{
  params: Promise<{ runId: string }>;
}>(async (
  request: Request,
  _logged,
  context: {
    params: Promise<{ runId: string }>;
  }
) => {
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

  const params = await context.params;
  const snapshot = await deps.historyStore.getSnapshot(params.runId);

  if (!snapshot || snapshot.snapshot.user_id !== auth.user.id) {
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

  return NextResponse.json(snapshot);
});

export async function GET(
  request: Request,
  context: {
    params: Promise<{ runId: string }>;
  }
) {
  return getHandler(request, context);
}
