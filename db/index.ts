import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL ontbreekt. Koppel Neon Postgres aan het Vercel-project " +
        "(Storage → Create Database → Neon) of zet DATABASE_URL in .env.local."
    );
  }
  return drizzle(neon(url), { schema });
}

/** Lazy singleton — voorkomt dat `next build` een databaseverbinding eist. */
export function getDb() {
  if (!_db) _db = createDb();
  return _db;
}

export { schema };
