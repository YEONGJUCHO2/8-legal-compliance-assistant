import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ExpertReviewModal } from "@/components/expert/ExpertReviewModal";

describe("ExpertReviewModal", () => {
  test("walks through all four expert-review steps", () => {
    render(<ExpertReviewModal open onClose={vi.fn()} />);

    expect(screen.getByText(/민감표현 검토/i)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /다음 단계/i }));
    expect(screen.getByText(/수신자 선택/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /다음 단계/i }));
    expect(screen.getByText(/PDF 전송/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /전송 완료 처리/i }));
    expect(screen.getByText(/전송됨 · 회수 불가/i)).toBeVisible();
  });
});
