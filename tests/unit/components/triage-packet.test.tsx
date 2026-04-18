import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { TriagePacket } from "@/components/triage/TriagePacket";

import { createAnswerFixture } from "./fixtures";

describe("TriagePacket", () => {
  test("renders verified facts before conclusion and shows multi-law scope banner", () => {
    const answer = createAnswerFixture({
      answeredScope: ["산업안전보건법 기본 의무"],
      unansweredScope: ["산재보험 특례"],
      lawSections: [
        {
          law_title: "산업안전보건법",
          summary: "기본 안전조치",
          why_it_applies: "직접 적용",
          check_first: ["방호장치"]
        },
        {
          law_title: "산업안전보건기준에 관한 규칙",
          summary: "세부 점검 절차"
        }
      ]
    });

    render(<TriagePacket question="산안법 제10조 안전조치" answer={answer} />);

    const packet = screen.getByTestId("triage-packet");
    const text = packet.textContent ?? "";
    expect(text.indexOf(answer.verifiedFacts[0])).toBeLessThan(text.indexOf(answer.conclusion));

    const banner = within(packet).getByText(/답변 범위/i);
    expect(banner).toBeVisible();
    expect(screen.getByText(/산재보험 특례/i)).toBeVisible();
  });

  test("shows a safe empty-state when citations are absent", () => {
    render(<TriagePacket question="산안법 제10조 안전조치" answer={createAnswerFixture({ citations: [] })} />);

    expect(screen.getByText(/인용 조문이 아직 없습니다/i)).toBeVisible();
  });
});
