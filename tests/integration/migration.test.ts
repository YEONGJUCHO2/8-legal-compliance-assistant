// @vitest-environment node

import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { expect, test } from "vitest";

import { runMigrations } from "../../scripts/migrate";

test("base migrations apply idempotently on a clean database", async ({ skip }) => {
  if (!process.env.DATABASE_URL) {
    skip();
  }

  const schemaName = `phase02_${randomUUID().replace(/-/g, "_")}`;
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });

  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);

    await runMigrations({
      connectionString: process.env.DATABASE_URL!,
      cwd: process.cwd(),
      includeVector: false,
      dryRun: false,
      schema: schemaName
    });

    await runMigrations({
      connectionString: process.env.DATABASE_URL!,
      cwd: process.cwd(),
      includeVector: false,
      dryRun: false,
      schema: schemaName
    });

    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = ${schemaName}
      ORDER BY table_name
    `;

    expect(tables.map((row) => row.table_name)).toContain("app_users");
    expect(tables.map((row) => row.table_name)).toContain("assistant_runs");
    expect(tables.map((row) => row.table_name)).toContain("service_updates");
    expect(tables.map((row) => row.table_name)).toContain("rate_limit_buckets");
    expect(tables.map((row) => row.table_name)).toContain("idempotency_records");

    const authMagicLinkColumns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = 'auth_magic_links'
        AND column_name IN ('state', 'redemption_attempts')
      ORDER BY column_name
    `;

    expect(authMagicLinkColumns.map((row) => row.column_name)).toEqual(["redemption_attempts", "state"]);

    const serviceUpdateIdColumn = await sql<{ data_type: string }[]>`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = 'service_updates'
        AND column_name = 'id'
      LIMIT 1
    `;

    expect(serviceUpdateIdColumn[0]?.data_type).toBe("text");

    const assistantRunColumns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = 'assistant_runs'
        AND column_name IN (
          'rerun_from_run_id',
          'normalized_query',
          'clarification_question',
          'conclusion',
          'explanation',
          'caution',
          'changed_since_created',
          'reference_date_confirmed',
          'response_json'
        )
      ORDER BY column_name
    `;

    expect(assistantRunColumns.map((row) => row.column_name)).toEqual([
      "caution",
      "changed_since_created",
      "clarification_question",
      "conclusion",
      "explanation",
      "normalized_query",
      "reference_date_confirmed",
      "response_json",
      "rerun_from_run_id"
    ]);

    const citationColumns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = 'assistant_run_citations'
        AND column_name IN (
          'law_id',
          'article_version_id',
          'law_title',
          'article_number',
          'position',
          'verification_source',
          'in_force_at_query_date',
          'rendered_from_verification',
          'mcp_disagreement',
          'answer_strength_downgrade',
          'latest_article_version_id',
          'changed_summary',
          'changed_at'
        )
      ORDER BY column_name
    `;

    expect(citationColumns.map((row) => row.column_name)).toEqual([
      "article_version_id",
      "article_number",
      "answer_strength_downgrade",
      "changed_at",
      "changed_summary",
      "in_force_at_query_date",
      "law_id",
      "law_title",
      "latest_article_version_id",
      "mcp_disagreement",
      "position",
      "rendered_from_verification",
      "verification_source"
    ]);

    const migrationRows = (await sql.unsafe(
      `SELECT id FROM "${schemaName}"."schema_migrations" ORDER BY id`
    )) as { id: string }[];

    expect(migrationRows.map((row) => row.id)).toEqual([
      "001_base.sql",
      "003_postgres_concrete_wiring.sql",
      "004_runtime_state.sql",
      "005_history_citation_denormalization.sql",
      "006_auth_sessions_token_hash_unique.sql"
    ]);
  } catch (error) {
    skip(
      error instanceof Error
        ? `database unavailable for migration integration test: ${error.message}`
        : "database unavailable for migration integration test"
    );
  } finally {
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    await sql.end({ timeout: 1 });
  }
});
