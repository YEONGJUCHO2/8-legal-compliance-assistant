"use client";

import Link from "next/link";

import type { HistoryListItem } from "@/lib/assistant/ask-schema";

export function HistoryPanel({
  history,
  onOpenRun,
  onRerun
}: {
  history: HistoryListItem[];
  onOpenRun?: (runId: string) => void;
  onRerun?: (runId: string) => void;
}) {
  return (
    <section className="panel history-panel">
      <h2 className="panel__title">최근 히스토리</h2>
      <ul className="history-panel__list">
        {history.map((item) => (
          <li key={item.id} className="history-panel__item">
            {onOpenRun ? (
              <button type="button" onClick={() => onOpenRun(item.id)}>
                {item.user_query}
              </button>
            ) : (
              <Link href={`/history/${item.id}`}>{item.user_query}</Link>
            )}
            <div className="history-panel__meta">
              <span>{item.query_effective_date}</span>
              {item.changed_since_created ? <span className="state-badge state-warning">변경됨</span> : null}
            </div>
            <button type="button" className="ghost-button" onClick={() => onRerun?.(item.id)}>
              현재 법령으로 새 답변 생성
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
