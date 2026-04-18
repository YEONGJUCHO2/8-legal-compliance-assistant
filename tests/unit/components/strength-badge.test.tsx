import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { StrengthBadge } from "@/components/ui/StrengthBadge";

describe("StrengthBadge", () => {
  test("renders all three localized strength labels", () => {
    const { rerender } = render(<StrengthBadge strength="clear" />);
    expect(screen.getByText("답변 강도: 명확")).toBeVisible();

    rerender(<StrengthBadge strength="conditional" />);
    expect(screen.getByText("답변 강도: 조건부 판단")).toBeVisible();

    rerender(<StrengthBadge strength="verification_pending" />);
    expect(screen.getByText("답변 강도: 검증 지연")).toBeVisible();
  });
});
