import { NextResponse } from "next/server";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { requireAuth } from "@/lib/auth/route-guard";
import { withRequestLogging } from "@/lib/logging";
import {
  createDefaultServiceUpdateSeed,
  createInMemoryServiceUpdateStore,
  listRecentServiceUpdates
} from "@/lib/service-updates";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const getHandler = withRequestLogging<StaticRouteContext>(async (request, _logged, _context) => {
  const deps = getAssistantDeps();
  const auth = await requireAuth(request, deps.authStore, deps.now?.());

  if ("response" in auth) {
    return NextResponse.json(auth.response.body, {
      status: auth.response.status
    });
  }

  const updates = await listRecentServiceUpdates(
    deps.serviceUpdateStore ?? createInMemoryServiceUpdateStore(createDefaultServiceUpdateSeed()),
    5
  );
  return NextResponse.json({
    updates
  });
});

export async function GET(request: Request, context: StaticRouteContext) {
  return getHandler(request, context);
}
