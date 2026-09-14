/**
 * Migration runner — applies .sql files from src/db/migrations in order,
 * recording each in the `_migrations` table. Idempotent and transactional.
 *
 * Usage: npm run db:migrate
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadEnv } from "../src/config/env";

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/db/migrations");

async function main() {
  const env = loadEnv();
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("no migrations found");
    await client.end();
    return;
  }

  for (const file of files) {
    const { rows } = await client.query("SELECT 1 AS ok FROM _migrations WHERE name = $1", [file]);
    if (rows.length > 0) {
      console.log(`  skipped (already applied): ${file}`);
      continue;
    }
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    console.log(`  applying: ${file}`);
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`  ✓ applied: ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    }
  }

  const { rows } = await client.query("SELECT name FROM _migrations ORDER BY name");
  console.log(`\nmigrations on database: ${rows.map((r) => r.name).join(", ")}`);
  await client.end();
}

main().catch((err) => {
  console.error("migration failed:", err);
  process.exit(1);
});