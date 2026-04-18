import type { QuestionHistoryRow } from "@/lib/db/rows";
import type { VerificationOutput } from "@/lib/verify/types";

import { MetricsRegistry } from "./registry";

const registry = new MetricsRegistry();

export function getMetricsRegistry() {
  return registry;
}

const retrievalTop1HitRate = registry.gauge("retrieval_top1_hit_rate");
const retrievalTop3HitRate = registry.gauge("retrieval_top3_hit_rate");
const retrievalWrongLawTop3Rate = registry.gauge("retrieval_wrong_law_top3_rate");
const clarifyRate = registry.counter("clarify_rate");
const schemaRetryExhaustionTotal = registry.counter("schema_retry_exhaustion_total");
const mcpDisagreementTotal = registry.counter("mcp_disagreement_total");
const perLawDisagreementRate = registry.counter("per_law_disagreement_rate");
const perStageBudgetBurnMs = registry.histogram("per_stage_budget_burn_ms");
const verificationConcurrencySaturation = registry.gauge("verification_concurrency_saturation");
const engineLatencyMs = registry.histogram("engine_latency_ms");

export function recordRetrievalEvalMetrics({
  top1,
  top3,
  wrongLawInTop3
}: {
  top1: number;
  top3: number;
  wrongLawInTop3: number;
}) {
  retrievalTop1HitRate.set({}, top1);
  retrievalTop3HitRate.set({}, top3);
  retrievalWrongLawTop3Rate.set({}, wrongLawInTop3);
}

export function recordRunMetrics(
  run: QuestionHistoryRow,
  verification: VerificationOutput | null,
  engineLatency: number,
  stageBurn: Partial<Record<"retrieval" | "generation" | "verification", number>>
) {
  if (run.status === "clarify") {
    clarifyRate.inc();
  }

  if (run.schema_retry_count >= 2) {
    schemaRetryExhaustionTotal.inc();
  }

  if (verification?.citations.some((citation) => citation.disagreement)) {
    mcpDisagreementTotal.inc();

    for (const citation of verification.citations.filter((entry) => entry.disagreement)) {
      perLawDisagreementRate.inc({
        law_title: citation.lawTitle
      });
    }
  }

  for (const [stage, duration] of Object.entries(stageBurn)) {
    if (duration !== undefined) {
      perStageBudgetBurnMs.observe(
        {
          stage
        },
        duration
      );
    }
  }

  if (verification) {
    verificationConcurrencySaturation.set(
      {
        status: verification.overall
      },
      verification.citations.length
    );
  }

  engineLatencyMs.observe({}, engineLatency);
}
