"use client";

export type RecoveryKind =
  | "no_match"
  | "verification_pending"
  | "schema_error"
  | "date_confirmation_required"
  | "auth_expired"
  | "rate_limit"
  | "queue_overload"
  | "offline"
  | "engine_timeout"
  | "mcp_timeout";

const copy: Record<
  RecoveryKind,
  {
    title: string;
    body: string;
    primary: string;
    secondary?: string;
  }
> = {
  no_match: {
    title: "확인된 법령 범위 안에서 바로 적용되는 조항을 찾지 못했습니다.",
    body: "질문을 더 구체적으로 바꾸거나 설비·공정명을 추가해 주세요.",
    primary: "질문 수정"
  },
  verification_pending: {
    title: "검증 지연",
    body: "검증 지연: 최신 법령 대조가 끝나기 전이라 결론을 확정할 수 없습니다.",
    primary: "계속 확인"
  },
  schema_error: {
    title: "답변 형식 확인 실패",
    body: "2회 재시도 후 중단되었습니다. 자동 재시도는 수행하지 않습니다.",
    primary: "다시 시도",
    secondary: "전문가 검토 요청"
  },
  date_confirmation_required: {
    title: "기준 시점 불일치 확인",
    body: "질문에 과거 시점 표현이 있습니다. 기준 시점을 수정하거나 현재 기준으로 답변받겠다고 확인해 주세요.",
    primary: "현재 기준으로 진행"
  },
  auth_expired: {
    title: "로그인이 필요합니다",
    body: "세션이 만료되었거나 인증이 필요합니다.",
    primary: "로그인으로 이동"
  },
  rate_limit: {
    title: "요청 한도 초과",
    body: "짧은 시간에 너무 많은 요청이 들어왔습니다. 잠시 후 다시 시도해 주세요.",
    primary: "잠시 후 다시 시도"
  },
  queue_overload: {
    title: "대기열 과부하",
    body: "현재 처리량이 높아 요청을 잠시 늦춰야 합니다.",
    primary: "잠시 후 다시 시도"
  },
  offline: {
    title: "오프라인 상태",
    body: "네트워크 연결을 확인한 뒤 다시 시도해 주세요.",
    primary: "다시 연결"
  },
  engine_timeout: {
    title: "엔진 응답 지연",
    body: "답변 생성 시간이 초과되었습니다.",
    primary: "다시 시도"
  },
  mcp_timeout: {
    title: "법령 확인 실패",
    body: "법령 확인 실패: 현재 검증 경로에서 조문 상태를 확인하지 못했습니다.",
    primary: "다시 시도"
  }
};

export function RecoveryCard({
  kind,
  onPrimaryAction,
  onSecondaryAction
}: {
  kind: RecoveryKind;
  onPrimaryAction?: () => void;
  onSecondaryAction?: () => void;
}) {
  const content = copy[kind];

  return (
    <section className={`panel recovery-card recovery-card--${kind}`} aria-live="polite">
      <h2 className="panel__title">{content.title}</h2>
      <p>{content.body}</p>
      <div className="panel__actions">
        <button type="button" onClick={onPrimaryAction}>
          {content.primary}
        </button>
        {content.secondary ? (
          <button type="button" className="ghost-button" onClick={onSecondaryAction}>
            {content.secondary}
          </button>
        ) : null}
      </div>
    </section>
  );
}
