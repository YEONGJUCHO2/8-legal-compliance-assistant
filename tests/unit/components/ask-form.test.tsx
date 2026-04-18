import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { AskForm } from "@/components/form/AskForm";

afterEach(() => {
  localStorage.clear();
});

describe("AskForm", () => {
  test("persists draft to localStorage and requires reference date", () => {
    const onSubmit = vi.fn();
    const { unmount } = render(<AskForm onSubmit={onSubmit} today="2026-04-18" />);

    fireEvent.change(screen.getByLabelText(/질문 입력/i), {
      target: {
        value: "2024년 기준으로 프레스 작업 의무를 알려줘"
      }
    });
    expect(localStorage.getItem("phase09.ask-draft")).toContain("2024년 기준");

    fireEvent.click(screen.getByRole("button", { name: /질문 보내기/i }));
    expect(onSubmit).not.toHaveBeenCalled();

    unmount();
    render(<AskForm onSubmit={onSubmit} today="2026-04-18" />);
    expect(screen.getByLabelText(/질문 입력/i)).toHaveValue("2024년 기준으로 프레스 작업 의무를 알려줘");
  });

  test("shows the date mismatch banner when a past-date hint conflicts with today-like reference date", () => {
    render(<AskForm onSubmit={vi.fn()} today="2026-04-18" />);

    fireEvent.change(screen.getByLabelText(/질문 입력/i), {
      target: {
        value: "2024년 기준으로 프레스 작업 의무를 알려줘"
      }
    });
    fireEvent.change(screen.getByLabelText(/기준일/i), {
      target: {
        value: "2026-04-18"
      }
    });

    expect(screen.getByText(/질문에 과거 시점 표현이 있습니다/i)).toBeVisible();
  });
});
