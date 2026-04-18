## Decision
MVP Phase 02b의 provisional winner는 `타깃 캐시 + 라이브 MCP 검증`이며, 실측은 Phase 04 gold-set 구성 이후에 재검증한다.

## Wedge Gold Set & Gates
- Gold-set 카테고리만 지금 고정하고 실제 문항 30개는 Phase 04에서 lock 한다.
- 카테고리: 산안법 일반의무, 안전보건교육, 산업재해 예방, 중처법 경영책임자 의무, 도급·관계수급인, 별표/별지 조회.
- 카테고리별 약 5문항을 가정한다.
- Gate는 provisional target으로 `Top-1 >= 70%`, `Top-3 >= 90%`, `wrong-law-in-top-3 < 5%` 를 유지한다.
- 성능 가정은 `p50 < 1500ms`, `p95 < 4000ms`, cold-start `< 500ms` 이며 모두 실측 전 추정치다.

## Options Evaluated
### A. MCP-only with aggressive caching
- 설명: 검색과 최신성 판단을 모두 `korean-law-mcp`에 의존하고 응답 캐시만 얹는 경로.
- 예상 장점: 로컬 저장과 동기화 코드가 가장 적고 최신 법령 우선 원칙을 가장 단순하게 구현한다.
- 예상 단점: MCP 다운타임 시 자연스러운 로컬 폴백이 없고, PG-04 downgrade를 안전하게 수행할 스냅샷 근거가 약하다.
- Degraded-MCP 거동: MCP가 실패하면 답변 자체를 중단하거나 근거 없는 약한 폴백으로 흐르기 쉽다.
- `mcp_disagreement` 가능 여부: 사실상 불충분하며, 비교 대상이 되는 로컬 스냅샷이 없으면 신호를 안정적으로 만들 수 없다.
- Cold-start 프로파일: 로컬 모델 로드는 없지만 네트워크 의존도가 절대적이라 MCP 지연이 곧 cold-path 지연이 된다.
- Go/No-go: `No-go`. PG-04와 PG-06을 만족시키는 안전한 degraded path가 없어 disqualified.

### B. Targeted cache plus live MCP verification
- 설명: MVP 6법령과 별표/별지만 로컬 스냅샷 캐시로 유지하고, 사용자 응답 시점에는 라이브 MCP 검증을 정식 경로로 둔다.
- 예상 장점: 캐시 범위가 작아 cold-start/디스크 부담이 낮고, PG-06과 자연스럽게 맞물리며, MCP 실패 시 `verification_pending` downgrade가 가능하다.
- 예상 단점: 캐시 동기화와 MCP 비교 로직이 필요하고, 캐시가 오래되면 stale snapshot 관리가 필요하다.
- Degraded-MCP 거동: MCP가 실패하면 캐시 스냅샷으로 답변하되 `verification_state=verification_pending` 으로 명시 downgrade 한다.
- `mcp_disagreement` 가능 여부: 가능하며, 캐시 스냅샷과 MCP 결과 비교로 자연스럽게 방출된다.
- Cold-start 프로파일: 모델 가중치 로드가 없고 캐시 범위가 작아 provisional estimate는 `< 500ms` 이다.
- Go/No-go: `Go`. MVP wedge와 deadline budget, PG-04, PG-06, disagreement signaling을 가장 균형 있게 만족한다.

### C. Full pgvector local index
- 설명: 전체 wedge corpus를 로컬 인덱싱하고 임베딩/HNSW로 주 검색을 수행하는 경로.
- 예상 장점: MCP 장애 시에도 로컬 검색으로 계속 답할 수 있고, 장기적으로는 대형 corpus 확장에 유리하다.
- 예상 단점: `@xenova/transformers` 첫 호출 모델/가중치 로드와 HNSW footprint가 Vercel Node deadline 예산에 부담이며, MVP 6법령에서는 복잡도 대비 이득이 작다.
- Degraded-MCP 거동: 로컬 인덱스로 답변은 계속 가능하지만 verification downgrade 규칙을 더 엄격히 붙여야 한다.
- `mcp_disagreement` 가능 여부: 가능하지만, MVP 초기에는 embedding 운영 복잡도가 더 큰 비용이다.
- Cold-start 프로파일: provisional estimate상 모델 초기 로드가 가장 크고 ROUTE_MAX_DURATION_SECONDS 재조정 예산을 잠식할 위험이 높다.
- Go/No-go: `No-go for MVP`. 장기 옵션으로는 남기되 현재는 deferred.

## Winner Rationale
옵션 B는 로컬 스냅샷이 있어 PG-04의 structured downgrade를 구현할 수 있고, 라이브 MCP를 정식 검증 경로로 두어 PG-06을 유지한다. 동시에 MVP wedge가 6법령 중심이라 cache footprint가 작고, `mcp_disagreement` 신호도 캐시와 MCP 비교만으로 만들 수 있다. 반면 옵션 A는 폴백 근거가 부족하고, 옵션 C는 MVP 범위 대비 cold-start와 운영 복잡도가 과하다.

## Provisional Status
- 이 결정은 오프라인 단일 세션 환경에서 내린 원칙 기반 provisional decision이다.
- 실제 30문항 gold set, MCP 다운타임 주입, cold-start 측정, 비용 측정은 아직 수행하지 않았다.
- Phase 04에서 gold set을 lock 한 뒤 Top-1/Top-3/wrong-law-in-top-3, p50/p95, degraded-MCP 동작을 재측정해야 한다.

## Phase 03 Scope Update
- `open.law.go.kr` XML 수집은 MVP 6법령 + 별표/별지 대상의 targeted cache 경로로 한정한다.
- 임베딩 생성, `pgvector`, HNSW, embedding backfill은 MVP 범위 밖으로 두고 구현하지 않는다.
- stale row 재동기화는 캐시 스냅샷을 MCP 우선 검증 경로와 연결하는 보수 수단으로 유지한다.

## Phase 04 Scope Update
- retrieval은 `lexical + 조문번호 검색 + 스냅샷 캐시 조회` 조합으로 고정하고 vector branch는 제거한다.
- 검색 결과는 cache snapshot과 live MCP verification의 비교 가능성을 보존해야 하며, 필요 시 `mcp_disagreement` 신호를 방출한다.
- 빈 근거/약한 근거 판정은 유지하되, weak evidence와 verification pending을 혼동하지 않도록 분리한다.

## Operational Notes
- `002_vector.sql` 은 Phase 02b 결정 이후에도 MVP 기본 경로에서 실행하지 않는다.
- `@xenova/transformers` 와 추가 pgvector npm 의존성은 도입하지 않는다.
- 수집 경로는 `fast-xml-parser` 기반 `open.law.go.kr` XML 처리 + targeted cache 만 사용한다.
