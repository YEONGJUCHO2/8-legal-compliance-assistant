import { expect, expectTypeOf, test } from "vitest";

import type {
  AnswerStrength,
  ArticleVersionRow,
  Citation,
  EngineProvider,
  EngineSessionRow,
  FeedbackEventRow,
  ISODate,
  ISODateTime,
  LawArticleRow,
  LawsRow,
  ObservabilityLogEvent,
  QuestionHistoryRow,
  SessionRow,
  UUID,
  UserIdentityRow,
  UsersRow
} from "@/lib/db/rows";

test("row contracts remain exported with the expected field shapes", () => {
  expectTypeOf<UUID>().toEqualTypeOf<string>();
  expectTypeOf<ISODate>().toEqualTypeOf<string>();
  expectTypeOf<ISODateTime>().toEqualTypeOf<string>();
  expectTypeOf<EngineProvider>().toEqualTypeOf<"codex" | "anthropic">();
  expectTypeOf<AnswerStrength>().toEqualTypeOf<
    "clear" | "conditional" | "verification_pending"
  >();

  expectTypeOf<UsersRow>().toMatchTypeOf<{
    id: string;
    email: string;
    auth_provider: "magic_link" | "oidc" | "saml";
    created_at: string;
  }>();
  expectTypeOf<SessionRow>().toMatchTypeOf<{
    session_token_hash: string;
    expires_at: string;
  }>();
  expectTypeOf<UserIdentityRow>().toMatchTypeOf<{
    provider_subject: string;
    email_snapshot: string | null;
  }>();
  expectTypeOf<EngineSessionRow>().toMatchTypeOf<{
    provider: EngineProvider;
    revoked_at: string | null;
  }>();
  expectTypeOf<LawsRow>().toMatchTypeOf<{
    normalized_title: string;
    body_markdown: string;
  }>();
  expectTypeOf<LawArticleRow>().toMatchTypeOf<{
    article_text: string;
    embedding: number[] | null;
  }>();
  expectTypeOf<ArticleVersionRow>().toMatchTypeOf<{
    version: number;
    content_hash: string;
  }>();
  expectTypeOf<QuestionHistoryRow>().toMatchTypeOf<{
    normalized_query: string;
    answer_behavior_version: string;
  }>();
  expectTypeOf<FeedbackEventRow>().toMatchTypeOf<{
    feedback_type: "helpful" | "wrong_citation" | "wrong_conclusion";
  }>();
  expectTypeOf<Citation>().toMatchTypeOf<{
    article_id: string;
    verification_source: "local" | "mcp" | "missing";
  }>();
  expectTypeOf<ObservabilityLogEvent>().toMatchTypeOf<{
    request_id: string;
    created_at: string;
  }>();

  expect(true).toBe(true);
});
