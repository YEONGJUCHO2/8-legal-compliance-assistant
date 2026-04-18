import { fileURLToPath } from "node:url";
import path from "node:path";

import type { StaleMark } from "@/lib/verify/types";

export async function consumeStaleMarks(marks: StaleMark[]) {
  for (const mark of marks) {
    console.log(
      `[resync-flagged] sync-laws.ts 재호출 예정: lawId=${mark.lawId} articleId=${mark.lawArticleId} snapshot=${mark.snapshotHash} reason=${mark.reason}`
    );
  }
}

async function main() {
  await consumeStaleMarks([]);
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
