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

    const migrationRows = (await sql.unsafe(
      `SELECT id FROM "${schemaName}"."schema_migrations" ORDER BY id`
    )) as { id: string }[];

    expect(migrationRows.map((row) => row.id)).toEqual(["001_base.sql", "003_postgres_concrete_wiring.sql"]);
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
