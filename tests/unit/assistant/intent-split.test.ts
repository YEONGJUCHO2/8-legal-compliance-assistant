import { describe, expect, test } from "vitest";

import { splitIntents } from "@/lib/assistant/intent-split";

describe("splitIntents", () => {
  test("splits multi-intent questions on conjunctions and list separators", () => {
    const intents = splitIntents("프레스 작업 안전조치가 궁금하고, 또 중처법상 경영책임자 의무도 알려줘. 추가로 별표 1 대상 기계도 알려줘.");

    expect(intents).toHaveLength(3);
    expect(intents.map((intent) => intent.subQuestion)).toEqual([
      "프레스 작업 안전조치가 궁금하고",
      "중처법상 경영책임자 의무도 알려줘",
      "별표 1 대상 기계도 알려줘"
    ]);
  });

  test("caps the split at three intents", () => {
    const intents = splitIntents("하나, 둘, 셋, 넷, 다섯");

    expect(intents).toHaveLength(3);
  });
});
