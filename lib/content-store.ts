import { eq, sql } from "drizzle-orm";
import { unstable_cache, revalidateTag } from "next/cache";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";

/**
 * Eigen content-laag (vervangt Sanity). Content-documenten leven in dezelfde
 * app_settings-tabel onder id `content:<key>` (bv. content:footer, content:menu,
 * content:occasions). Bewerkbaar vanuit de GENTS-portal; bij een leeg document
 * valt de render terug op de code-default (seed). Eén stack, één login, eigen DB.
 */
const cid = (key: string) => `content:${key}`;
const contentTag = (key: string) => `content:${key}`;

async function readContentDoc<T>(key: string): Promise<T | null> {
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, cid(key))).limit(1);
    return (rows[0]?.data as T) ?? null;
  } catch {
    return null;
  }
}

export async function getContentDoc<T>(key: string): Promise<T | null> {
  // Data-cache met tag-invalidatie: menu/footer worden op ÉLKE storefront-request
  // gelezen maar veranderen vrijwel nooit. revalidate=300 als backstop; setContentDoc
  // invalideert de tag direct bij een portal-wijziging → geen DB-round-trip per hit.
  const cached = unstable_cache(() => readContentDoc<T>(key), ["content-doc", key], {
    revalidate: 300,
    tags: [contentTag(key)],
  });
  return cached();
}

export async function setContentDoc<T>(key: string, data: T): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ id: cid(key), data: data as unknown, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: data as unknown, updatedAt: sql`now()` } });
  // Directe cache-invalidatie zodat een portal-wijziging meteen live is.
  revalidateTag(contentTag(key));
}
