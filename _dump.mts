import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { MAIN_MENU, type MenuItem } from "@/lib/main-menu";
import { CATEGORIES } from "@/lib/categories";
type FooterDoc = { intro: string; columns: { title: string; links: { label: string; href: string }[] }[] };
async function doc<T>(key: string): Promise<T | null> {
  const db = getDb();
  const rows = (await db.execute<{ data: unknown }>(sql`select data from app_settings where id = ${"content:" + key} limit 1`)).rows;
  return (rows[0]?.data as T) ?? null;
}
async function main() {
  const menuDoc = await doc<{ items: MenuItem[] }>("menu");
  const menu = menuDoc?.items?.length ? menuDoc.items : MAIN_MENU;
  const footerDoc = await doc<FooterDoc>("footer");
  const { FOOTER_FALLBACK } = await import("@/lib/footer-server").catch(() => ({ FOOTER_FALLBACK: null as FooterDoc | null }));
  const footer = footerDoc || FOOTER_FALLBACK;
  const texts = new Set<string>();
  const add = (v?: string) => { const s = (v || "").trim(); if (s && s !== "#") texts.add(s); };
  for (const i of menu) { add(i.label); for (const c of i.columns || []) { add(c.title); for (const l of c.links) add(l.label); } for (const f of i.features || []) { add(f.label); add(f.caption); } }
  if (footer) { add(footer.intro); for (const c of footer.columns) { add(c.title); for (const l of c.links) add(l.label); } }
  for (const c of CATEGORIES) add(c.label);
  console.log("TEKSTEN=" + JSON.stringify([...texts]));
}
main().then(() => process.exit(0)).catch((e) => { console.error("SCRIPTFOUT:", e?.message || e); process.exit(1); });
