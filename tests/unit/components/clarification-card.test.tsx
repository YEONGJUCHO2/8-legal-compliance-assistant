import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ClarificationCard } from "@/components/triage/ClarificationCard";

describe("ClarificationCard", () => {
  test("invokes skip clarification callback", () => {
    const onSkip = vi.fn();
    render(
      <ClarificationCard
        question="작업 공정과 설비명을 조금 더 구체적으로 알려주세요."
        onSkip={onSkip}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /현재 정보로 계속/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });
});
