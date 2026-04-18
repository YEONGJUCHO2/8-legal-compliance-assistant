import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readdir } from "node:fs/promises";
import path from "node:path";

import postgres, { type Sql } from "postgres";

import { getEnv } from "../src/lib/env";

const VECTOR_MIGRATION_ID = "002_vector.sql";

export type RunMigrationsOptions = {
  connectionString: string;
  cwd?: string;
  dryRun?: boolean;
  includeVector?: boolean;
  schema?: string;
};

type PlannedMigration = {
  id: string;
  filepath: string;
};

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll("\"", "\"\"")}"`;
}

export async function listMigrations(
  cwd = process.cwd(),
  includeVector = false
): Promise<PlannedMigration[]> {
  const migrationsDir = path.join(cwd, "db", "migrations");
  const entries = await readdir(migrationsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => ({
      id: entry.name,
      filepath: path.join(migrationsDir, entry.name)
    }))
    .filter((entry) => includeVector || entry.id !== VECTOR_MIGRATION_ID)
    .sort((a, b) => a.id.localeCompare(b.id));
}

async function ensureSearchPath(sql: Sql, schema?: string) {
  if (!schema) {
    return;
  }

  const quotedSchema = quoteIdentifier(schema);
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
  await sql.unsafe(`SET search_path TO ${quotedSchema}, public`);
}

async function ensureSchemaMigrations(sql: Sql) {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function getAppliedMigrationIds(sql: Sql) {
  const rows = await sql<{ id: string }[]>`
    SELECT id
    FROM schema_migrations
  `;

  return new Set(rows.map((row) => row.id));
}

export async function runMigrations({
  connectionString,
  cwd = process.cwd(),
  dryRun = false,
  includeVector = false,
  schema
}: RunMigrationsOptions) {
  const plannedMigrations = await listMigrations(cwd, includeVector);

  if (dryRun) {
    for (const migration of plannedMigrations) {
      console.log(migration.id);
    }

    return plannedMigrations.map((migration) => migration.id);
  }

  const sql = postgres(connectionString, { max: 1 });

  try {
    await ensureSearchPath(sql, schema);
    await ensureSchemaMigrations(sql);

    const appliedMigrationIds = await getAppliedMigrationIds(sql);

    for (const migration of plannedMigrations) {
      if (appliedMigrationIds.has(migration.id)) {
        console.log(`skip ${migration.id}`);
        continue;
      }

      const migrationSql = await readFile(migration.filepath, "utf8");

      await sql.begin(async (tx) => {
        await tx.unsafe(migrationSql);
        await tx`
          INSERT INTO schema_migrations (id)
          VALUES (${migration.id})
        `;
      });

      console.log(`apply ${migration.id}`);
    }

    return plannedMigrations.map((migration) => migration.id);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const includeVector = args.has("--include-vector");

  if (dryRun) {
    await runMigrations({
      connectionString: "dry-run",
      cwd: process.cwd(),
      dryRun: true,
      includeVector
    });
    return;
  }

  const env = getEnv();

  await runMigrations({
    connectionString: env.DATABASE_URL,
    cwd: process.cwd(),
    includeVector
  });
}

const isMainModule =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMainModule) {
  void main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
