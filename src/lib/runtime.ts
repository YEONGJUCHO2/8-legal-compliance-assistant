import { getEnv } from "@/lib/env";

const env = (() => {
  try {
    return getEnv();
  } catch {
    return null;
  }
})();

export const runtime = "nodejs";
export const maxDuration = env?.ROUTE_MAX_DURATION_SECONDS ?? 60;
