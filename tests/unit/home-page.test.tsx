import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { HomePageContent } from "@/components/shell/HomePageContent";

describe("HomePage", () => {
  test("renders onboarding copy, service update, and empty-history shell for authenticated users", () => {
    render(
      <HomePageContent
        initialHistory={[]}
        serviceUpdate={{
          behaviorVersion: "phase-09-ui",
          summary: "질문 intake와 recovery card가 추가되었습니다."
        }}
      />
    );

    expect(
      screen.getByRole("heading", {
        level: 1
      })
    ).toBeVisible();
    expect(screen.getByText(/처음 사용하는 분을 위한 안내/i)).toBeVisible();
    expect(screen.getByText(/서비스 업데이트/i)).toBeVisible();
    expect(screen.getByText(/질문 intake와 recovery card가 추가되었습니다/i)).toBeVisible();
  });
});
