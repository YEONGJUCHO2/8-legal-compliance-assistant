import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { AppShell } from "@/components/shell/AppShell";

import { createAnswerFixture, createHistoryFixture, createVerificationPendingFixture } from "../unit/components/fixtures";

type MockResponse = {
  status?: number;
  body: unknown;
};

function createJsonResponse(input: MockResponse) {
  return Promise.resolve({
    ok: (input.status ?? 200) >= 200 && (input.status ?? 200) < 300,
    status: input.status ?? 200,
    json: async () => input.body
  } satisfies Partial<Response> as Response);
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("renders an answer packet from /api/ask", async () => {
    vi.spyOn(global, "fetch").mockImplementation(() => createJsonResponse({ body: createAnswerFixture() }));

    render(
      <AppShell
        initialHistory={createHistoryFixture({ id: "old-run" }).history}
        serviceUpdate={{ behaviorVersion: "phase-09-ui", summary: "검증 규칙이 정리되었습니다." }}
      />
    );

    fireEvent.change(screen.getByLabelText(/질문 입력/i), {
      target: { value: "산안법 제10조 안전조치" }
    });
    fireEvent.change(screen.getByLabelText(/기준일/i), {
      target: { value: "2026-04-18" }
    });
    fireEvent.click(screen.getByRole("button", { name: /질문 보내기/i }));

    expect(await screen.findByText(/점검 후 작업해야 합니다/i)).toBeVisible();
    expect(screen.getByText(/검증 규칙이 정리되었습니다/i)).toBeVisible();
  });

  test("handles clarify -> skip -> answer", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    fetchMock
      .mockImplementationOnce(() =>
        createJsonResponse({
          body: {
            kind: "clarify",
            runId: "run-clarify",
            question: "작업 공정과 설비명을 조금 더 구체적으로 알려주세요.",
            reasonCode: "missing_fact"
          }
        })
      )
      .mockImplementationOnce(() => createJsonResponse({ body: createAnswerFixture({ generatedFromSkip: true }) }));

    render(<AppShell initialHistory={[]} serviceUpdate={{ behaviorVersion: "phase-09-ui", summary: "서비스 업데이트" }} />);

    fireEvent.change(screen.getByLabelText(/질문 입력/i), {
      target: { value: "안전 관련 뭐가 필요해?" }
    });
    fireEvent.change(screen.getByLabelText(/기준일/i), {
      target: { value: "2026-04-18" }
    });
    fireEvent.click(screen.getByRole("button", { name: /질문 보내기/i }));

    expect(await screen.findByText(/작업 공정과 설비명을 조금 더 구체적으로 알려주세요/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /현재 정보로 계속/i }));

    expect(await screen.findByText(/점검 후 작업해야 합니다/i)).toBeVisible();

    const secondCall = fetchMock.mock.calls[1];
    expect(secondCall?.[1]).toBeTruthy();
    expect(String((secondCall?.[1] as RequestInit).body)).toContain('"skipClarification":true');
  });

  test("renders recovery states from /api/ask", async () => {
    const scenarios = [
      {
        body: {
          kind: "no_match",
          runId: "run-no-match",
          message: "확인된 법령 범위 안에서 바로 적용되는 조항을 찾지 못했습니다.",
          nextActions: ["작업 공정을 더 구체적으로 적어 주세요."]
        },
        text: /확인된 법령 범위 안에서 바로 적용되는 조항을 찾지 못했습니다/i
      },
      {
        body: {
          kind: "schema_error",
          runId: "run-schema-error",
          message: "schema failed",
          schemaRetryCount: 2
        },
        text: /답변 형식 확인 실패/i
      },
      {
        body: createVerificationPendingFixture(),
        text: /검증 지연: 최신 법령 대조가 끝나기 전이라 결론을 확정할 수 없습니다/i
      },
      {
        body: {
          kind: "date_confirmation_required",
          runId: "run-date",
          message: "질문에 과거 시점 표현이 있습니다. 기준 시점을 수정하거나 현재 기준으로 답변받겠다고 확인해 주세요."
        },
        text: /기준 시점 불일치 확인/i
      },
      {
        status: 429,
        body: {
          kind: "rate_limited",
          retryAfterSeconds: 6
        },
        text: /요청 한도 초과/i
      },
      {
        status: 401,
        body: {
          kind: "auth_expired",
          recoveryUrl: "/login"
        },
        text: /로그인이 필요합니다/i
      }
    ];

    for (const scenario of scenarios) {
      cleanup();
      vi.spyOn(global, "fetch").mockImplementationOnce(() => createJsonResponse(scenario));
      render(<AppShell initialHistory={[]} serviceUpdate={{ behaviorVersion: "phase-09-ui", summary: "서비스 업데이트" }} />);

      fireEvent.change(screen.getByLabelText(/질문 입력/i), {
        target: { value: "산안법 제10조 안전조치" }
      });
      fireEvent.change(screen.getByLabelText(/기준일/i), {
        target: { value: "2026-04-18" }
      });
      fireEvent.click(screen.getByRole("button", { name: /질문 보내기/i }));

      expect(await screen.findByText(scenario.text)).toBeVisible();
    }
  });

  test("locks export during verification_pending and preserves draft after cancel", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    vi.spyOn(global, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      )
      .mockImplementationOnce(() => createJsonResponse({ body: createVerificationPendingFixture() }));

    render(<AppShell initialHistory={[]} serviceUpdate={{ behaviorVersion: "phase-09-ui", summary: "서비스 업데이트" }} />);

    fireEvent.change(screen.getByLabelText(/질문 입력/i), {
      target: { value: "산안법 제10조 안전조치" }
    });
    fireEvent.change(screen.getByLabelText(/기준일/i), {
      target: { value: "2026-04-18" }
    });
    fireEvent.click(screen.getByRole("button", { name: /질문 보내기/i }));

    expect(await screen.findByRole("status")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /요청 취소/i }));
    expect(screen.getByLabelText(/질문 입력/i)).toHaveValue("산안법 제10조 안전조치");

    if (typeof resolveFetch === "function") {
      resolveFetch(await createJsonResponse({ body: createAnswerFixture() }));
    }

    fireEvent.click(screen.getByRole("button", { name: /질문 보내기/i }));
    expect(await screen.findByText(/검증 지연: 최신 법령 대조가 끝나기 전이라 결론을 확정할 수 없습니다/i)).toBeVisible();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /PDF 내보내기/i })).toBeDisabled();
    });
  });

  test("uses the export response instead of discarding it", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({
      document: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn()
      }
    } as unknown as Window);

    vi.spyOn(global, "fetch")
      .mockImplementationOnce(() => createJsonResponse({ body: createAnswerFixture() }))
      .mockImplementationOnce(() =>
        createJsonResponse({
          body: {
            ok: true,
            format: "pdf",
            variant: "redaction_review",
            effectiveDate: "2026-04-18",
            requiresUserReview: true,
            printHtml: "<html><body>print</body></html>"
          }
        })
      );

    render(<AppShell initialHistory={[]} serviceUpdate={{ behaviorVersion: "phase-09-ui", summary: "서비스 업데이트" }} />);

    fireEvent.change(screen.getByLabelText(/질문 입력/i), {
      target: { value: "산안법 제10조 안전조치" }
    });
    fireEvent.change(screen.getByLabelText(/기준일/i), {
      target: { value: "2026-04-18" }
    });
    fireEvent.click(screen.getByRole("button", { name: /질문 보내기/i }));

    expect(await screen.findByText(/점검 후 작업해야 합니다/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /PDF 내보내기/i }));

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledTimes(1);
    });
  });
});
