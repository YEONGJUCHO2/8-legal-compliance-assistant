import { NextResponse } from "next/server";
import { z } from "zod";

import { getAssistantDeps } from "@/lib/assistant/deps";
import { requireAuth } from "@/lib/auth/route-guard";
import { parseJsonBody } from "@/lib/http/zod-bad-request";
import { withRequestLogging } from "@/lib/logging";

export const runtime = "nodejs";
export const maxDuration = 60;

type StaticRouteContext = {
  params: Promise<Record<string, never>>;
};

const exportRequestSchema = z.object({
  runId: z.string(),
  format: z.enum(["pdf", "clipboard", "print"]),
  variant: z.enum(["redaction_review", "full_text"]),
  confirmRedactionReview: z.boolean()
});

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildExportContent(snapshot: {
  snapshot: {
    user_query: string;
    conclusion: string | null;
    explanation: string | null;
    caution: string | null;
    query_effective_date: string;
    answer_strength: string | null;
    status: string;
    citations: unknown[];
  };
}) {
  const title = escapeHtml(snapshot.snapshot.user_query || "질문 없음");
  const conclusion = escapeHtml(snapshot.snapshot.conclusion ?? "결론 없음");
  const explanation = escapeHtml(snapshot.snapshot.explanation ?? "설명 없음");
  const caution = escapeHtml(snapshot.snapshot.caution ?? "주의사항 없음");
  const effectiveDate = escapeHtml(snapshot.snapshot.query_effective_date);
  const citationCount = snapshot.snapshot.citations.length;

  return {
    clipboardText: [
      `질문: ${snapshot.snapshot.user_query || "질문 없음"}`,
      `기준일: ${snapshot.snapshot.query_effective_date}`,
      `강도: ${snapshot.snapshot.answer_strength ?? "unknown"}`,
      `상태: ${snapshot.snapshot.status}`,
      `인용 조문 수: ${citationCount}`,
      "",
      `결론: ${snapshot.snapshot.conclusion ?? "결론 없음"}`,
      `설명: ${snapshot.snapshot.explanation ?? "설명 없음"}`,
      `주의/예외: ${snapshot.snapshot.caution ?? "주의사항 없음"}`
    ].join("\n"),
    printHtml: `<!doctype html><html lang="ko"><body><article><h1>${title}</h1><p>기준일 ${effectiveDate}</p><p>강도 ${escapeHtml(snapshot.snapshot.answer_strength ?? "unknown")}</p><p>인용 조문 수 ${citationCount}</p><section><h2>결론</h2><p>${conclusion}</p></section><section><h2>설명</h2><p>${explanation}</p></section><section><h2>주의/예외</h2><p>${caution}</p></section></article></body></html>`
  };
}

function isExportLocked(snapshot: {
  status: string;
  answer_strength: string | null;
}) {
  return snapshot.status === "verification_pending" || snapshot.answer_strength === "verification_pending";
}

const postHandler = withRequestLogging<StaticRouteContext>(async (request, logged, _context) => {
  const deps = getAssistantDeps();
  const auth = await requireAuth(request, deps.authStore, deps.now?.());

  if ("response" in auth) {
    return NextResponse.json(
      {
        kind: "auth_expired",
        recoveryUrl: auth.response.body.recoveryUrl
      },
      {
        status: auth.response.status
      }
    );
  }

  const parsedResult = await parseJsonBody({
    request,
    schema: exportRequestSchema,
    logger: logged.logger
  });

  if (!parsedResult.ok) {
    return parsedResult.response;
  }

  const parsed = parsedResult.data;
  const snapshot = await deps.historyStore.getSnapshot(parsed.runId);

  if (!snapshot || snapshot.snapshot.user_id !== auth.user.id) {
    return NextResponse.json(
      {
        kind: "error",
        message: "run_not_found"
      },
      {
        status: 404
      }
    );
  }

  if (isExportLocked(snapshot.snapshot)) {
    return NextResponse.json(
      {
        kind: "error",
        message: "verification_pending_export_locked"
      },
      {
        status: 423
      }
    );
  }

  if (!parsed.confirmRedactionReview) {
    return NextResponse.json(
      {
        kind: "error",
        message: "redaction_review_confirmation_required"
      },
      {
        status: 400
      }
    );
  }

  const base = {
    ok: true,
    format: parsed.format,
    variant: parsed.variant,
    effectiveDate: snapshot.snapshot.query_effective_date,
    requiresUserReview: true
  };

  if (parsed.format === "clipboard") {
    const { clipboardText } = buildExportContent(snapshot);
    return NextResponse.json({
      ...base,
      clipboardText
    });
  }

  const { printHtml } = buildExportContent(snapshot);
  return NextResponse.json({
    ...base,
    printHtml
  });
});

export async function POST(request: Request, context: StaticRouteContext) {
  return postHandler(request, context);
}
