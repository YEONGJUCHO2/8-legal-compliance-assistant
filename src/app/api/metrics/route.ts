import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { getMetricsRegistry } from "@/lib/metrics/assistant-metrics";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

function safeTokenEqual(a: string, b: string) {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");

  if (bufA.length !== bufB.length) {
    return false;
  }

  return timingSafeEqual(bufA, bufB);
}

const getHandler = withRequestLogging<StaticRouteContext>(async (request, _logged, _context) => {
  const expectedToken = process.env.METRICS_ACCESS_TOKEN;
  const providedToken =
    request.headers.get("x-internal-metrics-token") ??
    request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)
      ?.at(1);

  if (!expectedToken || !providedToken || !safeTokenEqual(providedToken, expectedToken)) {
    return NextResponse.json(
      {
        message: "forbidden"
      },
      {
        status: 403
      }
    );
  }

  return NextResponse.json({
    snapshot: getMetricsRegistry().snapshot()
  });
});

export async function GET(request: Request, context: StaticRouteContext) {
  return getHandler(request, context);
}
