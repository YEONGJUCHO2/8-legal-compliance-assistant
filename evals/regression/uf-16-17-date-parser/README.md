# uf-16-17-date-parser

- 설명: 한국어 날짜 힌트의 absolute/relative/mixed 분기를 현재 구현 기준으로 고정한다.
- Phase 10 스펙: "`2024-03-01`, `2024년 3월`, `지난달`, `사고 당시` ... no false auto-conversion on relative phrases".
- 테스트 파일: `tests/integration/regression/uf-16-17-date-parser.test.ts`
- 현재 커버리지: absolute year match/mismatch, `지난달`/`사고 당시`/`작년`, mixed phrase를 검증한다.
- 알려진 갭: `어제`, `최근`, `요즘` 은 구현 미지원으로 `test.todo` 로 남겨 둠.
