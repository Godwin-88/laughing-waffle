import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

export interface Db {
  pool: pg.Pool;
  db: ReturnType<typeof drizzle>;
}

let cached: Db | null = null;

export function getDb(connectionString: string): Db {
  if (cached) return cached;
  const pool = new pg.Pool({ connectionString, max: 10 });
  const db = drizzle(pool, { schema });
  cached = { pool, db };
  return cached;
}

export function closeDb() {
  if (cached) {
    void cached.pool.end();
    cached = null;
  }
}