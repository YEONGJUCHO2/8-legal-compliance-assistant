# malicious-corpus

- 설명: citation body에 prompt-injection 문자열이 들어와도 structured output이 흔들리지 않는지 검증한다.
- Phase 10 스펙: "prompt-injection strings inside citations do not alter structured output".
- 테스트 파일: `tests/integration/regression/malicious-corpus.test.ts`
- 현재 커버리지: 8개 malicious payload 주입 후 allowed kind 유지와 conclusion/verifiedFacts literal reflection 부재를 검증한다.
- 알려진 갭: real LLM sampling drift 대신 deterministic engine stub 기준으로만 고정한다.
