import { performance } from "node:perf_hooks";

import { createCodexAdapter } from "../src/lib/assistant/engine/codex";
import { buildPrompt } from "../src/lib/assistant/engine/prompt";
import { createInMemoryEngineSessionStore } from "../src/lib/assistant/engine/session-store";

const daemonUrl = process.env.CODEX_DAEMON_URL ?? "http://127.0.0.1:4200";

async function main() {
  const adapter = createCodexAdapter({
    daemonUrl,
    deadlineMs: 55_000,
    sessionStore: createInMemoryEngineSessionStore()
  });
  const prompt = buildPrompt({
    userQuestion: "산안법 제10조의 안전조치 의무를 한 문장으로 알려주세요.",
    referenceDate: "2026-04-19",
    retrieval: {
      strategy: "targeted_cache",
      emitted_disagreement_capable: true,
      candidates: [
        {
          article_id: "smoke-article",
          article_no: "제10조",
          article_version_id: "smoke-article-version",
          body: "사업주는 기계·기구와 설비로 인한 위험을 예방하기 위하여 필요한 안전조치를 하여야 한다.",
          effective_from: "2025-01-01",
          effective_to: null,
          repealed_at: null,
          kind: "article",
          law_id: "smoke-law",
          law_title: "산업안전보건법",
          paragraph: null,
          item: null,
          score: 1,
          score_components: {
            lexical: 1
          },
          snippet: "사업주는 기계·기구와 설비로 인한 위험을 예방하기 위하여 필요한 안전조치를 하여야 한다.",
          source_hash: "smoke-source-hash",
          snapshot_hash: "smoke-snapshot-hash"
        }
      ]
    },
    schemaRef: "answer",
    intent: "answer"
  });
  const startedAt = performance.now();
  const result = await adapter.generate({
    userId: "smoke-user",
    prompt,
    schemaRef: "answer"
  });
  const elapsedMs = Math.round(performance.now() - startedAt);

  console.log(
    JSON.stringify(
      {
        daemonUrl,
        elapsedMs,
        result
      },
      null,
      2
    )
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
