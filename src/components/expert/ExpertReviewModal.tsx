"use client";

import { useState } from "react";

const steps = ["민감표현 검토", "수신자 선택", "PDF 전송", "전송 확인"] as const;

export function ExpertReviewModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <section className="panel expert-review-modal">
        <h2 className="panel__title">{steps[step]}</h2>
        {step === 0 ? <p>민감표현과 회사 식별정보를 검토한 뒤 외부 발송 범위를 확인합니다.</p> : null}
        {step === 1 ? <p>컴플라이언스 팀, 법무 리드, 커스텀 이메일 중 수신자를 선택합니다.</p> : null}
        {step === 2 ? <p>PDF를 생성해 선택한 수신자에게 전송합니다.</p> : null}
        {step === 3 ? <p>전송됨 · 회수 불가</p> : null}
        <div className="panel__actions">
          {step < steps.length - 2 ? (
            <button type="button" onClick={() => setStep((value) => value + 1)}>
              다음 단계
            </button>
          ) : null}
          {step === steps.length - 2 ? (
            <button type="button" onClick={() => setStep((value) => value + 1)}>
              전송 완료 처리
            </button>
          ) : null}
          <button type="button" className="ghost-button" onClick={onClose}>
            닫기
          </button>
        </div>
      </section>
    </div>
  );
}
