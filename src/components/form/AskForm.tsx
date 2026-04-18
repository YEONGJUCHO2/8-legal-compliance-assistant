"use client";

import { useEffect, useId, useState } from "react";

import { detectSuspiciousDateHint } from "@/lib/assistant/date-gate";

const STORAGE_KEY = "phase09.ask-draft";

type DraftState = {
  question: string;
  referenceDate: string;
  dateConfirmed: boolean;
};

function readDraft(): DraftState | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as DraftState;
  } catch {
    return null;
  }
}

export function AskForm({
  onSubmit,
  loading = false,
  today = new Date().toISOString().slice(0, 10)
}: {
  onSubmit: (payload: {
    question: string;
    referenceDate: string;
    clarificationResponses?: Record<string, string>;
  }) => void;
  loading?: boolean;
  today?: string;
}) {
  const draft = readDraft();
  const [question, setQuestion] = useState(draft?.question ?? "");
  const [referenceDate, setReferenceDate] = useState(draft?.referenceDate ?? "");
  const [dateConfirmed, setDateConfirmed] = useState(draft?.dateConfirmed ?? false);
  const questionId = useId();
  const dateId = useId();

  useEffect(() => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        question,
        referenceDate,
        dateConfirmed
      })
    );
  }, [question, referenceDate, dateConfirmed]);

  const dateHint = question && referenceDate ? detectSuspiciousDateHint(question, referenceDate, today) : { conflict: false as const };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!question.trim() || !referenceDate) {
      return;
    }

    if (dateHint.conflict && !dateConfirmed) {
      return;
    }

    onSubmit({
      question,
      referenceDate,
      clarificationResponses: dateConfirmed ? { dateConfirmed: "true" } : undefined
    });
  }

  return (
    <form className="panel ask-form" onSubmit={handleSubmit}>
      <label htmlFor={questionId}>질문 입력</label>
      <textarea
        id={questionId}
        name="question"
        value={question}
        rows={6}
        style={{ maxHeight: "40vh" }}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />

      <label htmlFor={dateId}>기준일</label>
      <input
        id={dateId}
        name="referenceDate"
        type="date"
        value={referenceDate}
        onChange={(event) => setReferenceDate(event.target.value)}
      />

      {dateHint.conflict ? (
        <div className="state-banner state-warning">
          <p>질문에 과거 시점 표현이 있습니다. 기준 시점을 수정하거나 현재 기준으로 답변받겠다고 확인해 주세요.</p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={dateConfirmed}
              onChange={(event) => setDateConfirmed(event.target.checked)}
            />
            현재 기준으로 계속 진행합니다.
          </label>
        </div>
      ) : null}

      <div className="ask-form__submit-bar">
        <button type="submit" disabled={loading}>
          질문 보내기
        </button>
      </div>
    </form>
  );
}
