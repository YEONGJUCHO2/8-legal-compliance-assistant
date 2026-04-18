"use client";

import { useMemo, useState } from "react";

import type { Citation } from "@/lib/db/rows";

function clampPreview(text: string) {
  return text.split("\n").slice(0, 6).join("\n");
}

export function CitationCard({
  citation,
  changedSinceCreated = false
}: {
  citation: Citation;
  changedSinceCreated?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const preview = useMemo(() => clampPreview(citation.text), [citation.text]);
  const body = expanded ? citation.text : preview;

  async function handleCopy() {
    await navigator.clipboard?.writeText(citation.text);
  }

  return (
    <article className="panel citation-card">
      <header className="citation-card__header">
        <div>
          <h3 className="panel__title">
            {citation.law_title} {citation.article_number}
          </h3>
          <p className="panel__meta">시행일 {citation.verified_at?.slice(0, 10) ?? "미확인"}</p>
        </div>
        <div className="citation-card__badges">
          {changedSinceCreated ? <span className="state-badge state-warning">법령 변경 감지</span> : null}
          <span className="state-badge">{citation.verification_source.toUpperCase()}</span>
        </div>
      </header>

      <pre className="citation-card__body">{body}</pre>

      <footer className="citation-card__footer">
        <span>{citation.in_force_at_query_date ? "기준일 효력 확인" : "기준일 효력 미확인"}</span>
        <div className="citation-card__actions">
          <button type="button" onClick={() => setExpanded((value) => !value)}>
            {expanded ? "접기" : "전체 조문 보기"}
          </button>
          <button type="button" onClick={handleCopy}>
            조문 복사
          </button>
        </div>
      </footer>
    </article>
  );
}
