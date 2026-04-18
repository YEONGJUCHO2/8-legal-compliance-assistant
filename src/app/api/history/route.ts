import { NextResponse } from "next/server";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { requireAuth } from "@/lib/auth/route-guard";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const getHandler = withRequestLogging<StaticRouteContext>(async (request, _logged, _context) => {
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

  const history = await deps.historyStore.listRuns(auth.user.id);

  return NextResponse.json(history);
});

export async function GET(request: Request, context: StaticRouteContext) {
  return getHandler(request, context);
}
