import { randomUUID } from "node:crypto";

import type { AssistantDeps } from "./deps";
import type { AskResponse } from "./ask-schema";
import { runQuery } from "./run-query";

export async function rerunWithCurrentLaw({
  parentRunId,
  user,
  deps,
  now,
  requestId
}: {
  parentRunId: string;
  user: {
    id: string;
  };
  deps: AssistantDeps;
  now?: string | Date;
  requestId?: string;
}): Promise<AskResponse> {
  const parent = await deps.historyStore.getRun(parentRunId);

  if (!parent || parent.user_id !== user.id) {
    return {
      kind: "error",
      message: "이전 실행 기록을 찾지 못했습니다."
    };
  }

  const rerunNow = now instanceof Date ? now : now ? new Date(now) : deps.now?.() ?? new Date();

  return runQuery({
    request: {
      mode: "rerun_current_law",
      clientRequestId: `rerun:${parentRunId}:${randomUUID()}`,
      parentRunId,
      question: parent.user_query,
      referenceDate: deps.today?.() ?? rerunNow.toISOString().slice(0, 10),
      skipClarification: true
    },
    user,
    deps,
    now: rerunNow,
    requestId
  });
}
