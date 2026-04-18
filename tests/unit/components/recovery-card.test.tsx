import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { RecoveryCard } from "@/components/ui/RecoveryCard";

describe("RecoveryCard", () => {
  test("renders approved Korean microcopy for trust-critical states", () => {
    const onPrimaryAction = vi.fn();
    const { rerender } = render(<RecoveryCard kind="no_match" onPrimaryAction={onPrimaryAction} />);
    expect(screen.getByText("확인된 법령 범위 안에서 바로 적용되는 조항을 찾지 못했습니다.")).toBeVisible();

    rerender(<RecoveryCard kind="verification_pending" onPrimaryAction={onPrimaryAction} />);
    expect(screen.getByText("검증 지연: 최신 법령 대조가 끝나기 전이라 결론을 확정할 수 없습니다.")).toBeVisible();

    rerender(<RecoveryCard kind="schema_error" onPrimaryAction={onPrimaryAction} />);
    expect(screen.getByText("답변 형식 확인 실패")).toBeVisible();
    expect(screen.getByText(/2회 재시도 후 중단/i)).toBeVisible();

    rerender(<RecoveryCard kind="date_confirmation_required" onPrimaryAction={onPrimaryAction} />);
    expect(screen.getByText("질문에 과거 시점 표현이 있습니다. 기준 시점을 수정하거나 현재 기준으로 답변받겠다고 확인해 주세요.")).toBeVisible();

    rerender(<RecoveryCard kind="auth_expired" onPrimaryAction={onPrimaryAction} />);
    expect(screen.getByText(/로그인이 필요합니다/i)).toBeVisible();
  });
});
