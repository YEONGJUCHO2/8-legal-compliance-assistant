import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { CitationCard } from "@/components/ui/CitationCard";

import { createAnswerFixture } from "./fixtures";

describe("CitationCard", () => {
  test("caps preview, expands on demand, and shows changed badge", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true
    });

    const citation = createAnswerFixture().citations[0];
    render(<CitationCard citation={citation} changedSinceCreated />);

    expect(screen.getByText(/법령 변경 감지/i)).toBeVisible();
    expect(screen.getByText(/사업주는 프레스 작업 전 방호장치를 점검해야 한다/i)).toBeVisible();
    expect(screen.queryByText(/교육 이수를 확인한다/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /전체 조문 보기/i }));
    expect(screen.getByText(/교육 이수를 확인한다/i)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /조문 복사/i }));
    expect(writeText).toHaveBeenCalled();
  });
});
