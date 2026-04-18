import postgres, { type Sql } from "postgres";

import { getEnv } from "@/lib/env";

declare global {
  var __appDbClient: Sql | undefined;
}

export function getDb(): Sql {
  if (!globalThis.__appDbClient) {
    globalThis.__appDbClient = postgres(getEnv().DATABASE_URL, {
      max: 10
    });
  }

  return globalThis.__appDbClient;
}
