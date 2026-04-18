import type { LawStorage } from "@/lib/search/storage";
import type { RetrievalEvalItem } from "@/lib/search/types";
import { retrieve } from "@/lib/search/retrieve";
import { recordRetrievalEvalMetrics } from "@/lib/metrics/assistant-metrics";

export async function runRetrievalEval(storage: LawStorage, goldSet: RetrievalEvalItem[]) {
  const perItem = [];
  let top1Hits = 0;
  let top3Hits = 0;
  let wrongLawInTop3Count = 0;

  for (const item of goldSet) {
    const result = await retrieve(storage, {
      query: item.query,
      referenceDate: item.referenceDate,
      limit: 3
    });

    const top1 = result.candidates[0];
    const top3 = result.candidates.slice(0, 3);
    const top1Hit =
      top1?.law_title === item.expectedLawTitle && top1?.article_no === item.expectedArticleNo;
    const top3Hit = top3.some(
      (candidate) =>
        candidate.law_title === item.expectedLawTitle && candidate.article_no === item.expectedArticleNo
    );
    const wrongLawInTop3 =
      top3.length > 0 && !top3.some((candidate) => candidate.law_title === item.expectedLawTitle);

    if (top1Hit) {
      top1Hits += 1;
    }

    if (top3Hit) {
      top3Hits += 1;
    }

    if (wrongLawInTop3) {
      wrongLawInTop3Count += 1;
    }

    perItem.push({
      id: item.id,
      top1Hit,
      top3Hit,
      wrongLawInTop3,
      weak: result.weak
    });
  }

  const total = goldSet.length || 1;

  const summary = {
    top1: top1Hits / total,
    top3: top3Hits / total,
    wrongLawInTop3: wrongLawInTop3Count / total,
    perItem
  };

  recordRetrievalEvalMetrics(summary);

  return summary;
}
