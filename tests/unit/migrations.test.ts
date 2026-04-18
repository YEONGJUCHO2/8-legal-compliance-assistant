// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, test } from "vitest";

const migrationsDir = path.join(process.cwd(), "db", "migrations");
const baseMigrationPath = path.join(migrationsDir, "001_base.sql");
const vectorMigrationPath = path.join(migrationsDir, "002_vector.sql");
const concreteWiringMigrationPath = path.join(migrationsDir, "003_postgres_concrete_wiring.sql");
const runtimeStateMigrationPath = path.join(migrationsDir, "004_runtime_state.sql");

async function readMigration(filename: string) {
  return readFile(path.join(migrationsDir, filename), "utf8");
}

describe("SQL migrations", () => {
  test("001_base.sql defines required tables and constraints", async () => {
    const sql = await readMigration("001_base.sql");

    for (const tableName of [
      "app_users",
      "user_identities",
      "auth_sessions",
      "auth_magic_links",
      "engine_sessions",
      "law_documents",
      "law_articles",
      "law_article_versions",
      "assistant_runs",
      "assistant_run_citations",
      "feedback_events",
      "service_updates"
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}`, "i"));
    }

    expect(sql).toMatch(
      /engine_sessions[\s\S]*provider TEXT NOT NULL CHECK\s*\(provider IN \('anthropic','codex'\)\)/i
    );
    expect(sql).toMatch(
      /assistant_runs[\s\S]*status TEXT NOT NULL CHECK\s*\(status IN \('clarify','answer','no_match','schema_error','verification_pending','error'\)\)/i
    );
    expect(sql).toMatch(
      /assistant_runs[\s\S]*verification_state TEXT NOT NULL CHECK\s*\(verification_state IN \('verified','verification_pending','mcp_disagreement','degraded','unverified'\)\)/i
    );
    expect(sql).toMatch(/UNIQUE\s*\(user_id,\s*client_request_id\)/i);
  });

  test("001_base.sql keeps the optional embedding path out of the base schema", async () => {
    const sql = await readMigration("001_base.sql");

    expect(sql).not.toMatch(/\bvector\b/i);
  });

  test("002_vector.sql contains the deferred vector extension and HNSW index", async () => {
    const sql = await readMigration("002_vector.sql");

    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS vector;/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS embedding vector\(768\)/i);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS embedding_model_version TEXT;/i);
    expect(sql).toMatch(/USING hnsw \(embedding vector_cosine_ops\)/i);
    expect(sql).toMatch(/Phase 02b 결정 전까지 실행 금지/i);
  });

  test("003_postgres_concrete_wiring.sql backfills concrete store schema gaps", async () => {
    const sql = await readMigration("003_postgres_concrete_wiring.sql");

    expect(sql).toMatch(/ALTER TABLE auth_magic_links[\s\S]*ADD COLUMN IF NOT EXISTS state TEXT NOT NULL DEFAULT ''/i);
    expect(sql).toMatch(
      /ALTER TABLE auth_magic_links[\s\S]*ADD COLUMN IF NOT EXISTS redemption_attempts INTEGER NOT NULL DEFAULT 0/i
    );
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS service_updates/i);
    expect(sql).toMatch(/ALTER COLUMN id TYPE TEXT USING id::text/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS ix_service_updates_effective_date/i);
  });

  test("004_runtime_state.sql promotes runtime state tables and assistant run columns", async () => {
    const sql = await readMigration("004_runtime_state.sql");

    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS rate_limit_buckets/i);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS idempotency_records/i);
    expect(sql).toMatch(/ALTER TABLE assistant_runs[\s\S]*ADD COLUMN IF NOT EXISTS normalized_query TEXT/i);
    expect(sql).toMatch(/ALTER TABLE assistant_runs[\s\S]*ADD COLUMN IF NOT EXISTS response_json JSONB/i);
    expect(sql).toMatch(/ALTER TABLE assistant_run_citations[\s\S]*ADD COLUMN IF NOT EXISTS article_version_id TEXT/i);
    expect(sql).toMatch(/ALTER TABLE assistant_run_citations[\s\S]*ADD COLUMN IF NOT EXISTS verification_source TEXT/i);
    expect(sql).toMatch(/ALTER TABLE assistant_runs[\s\S]*ALTER COLUMN payload_hash SET DEFAULT ''/i);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS ix_idempotency_records_expires_at/i);
  });

  test("migration files exist where the runner expects them", async () => {
    await expect(readFile(baseMigrationPath, "utf8")).resolves.toContain("app_users");
    await expect(readFile(vectorMigrationPath, "utf8")).resolves.toContain("vector");
    await expect(readFile(concreteWiringMigrationPath, "utf8")).resolves.toContain("redemption_attempts");
    await expect(readFile(runtimeStateMigrationPath, "utf8")).resolves.toContain("rate_limit_buckets");
  });
});
