import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings, productTranslations } from "@/db/schema";
import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/lib/i18n";
import { uiSourceKeys } from "@/lib/messages";

/**
 * Vertaal-engine (server). Eén bron voor de CLI-scripts én de nachtelijke cron.
 *
 * - UI-teksten + losse content → appSettings-rij `translations:<locale>` (KV,
 *   hash-gebaseerde delta zodat we alleen NIEUWE/GEWIJZIGDE teksten vertalen).
 * - Producttitels/-omschrijvingen → tabel product_translations (al gelezen door
 *   lib/catalog.ts op de PLP).
 *
 * Provider-flexibel: Claude (ANTHROPIC_API_KEY) of OpenAI (OPENAI_API_KEY).
 * Zonder sleutel doet niets (de cron geeft dan netjes 412 terug).
 *
 * Merk-veilig: de merknaam "GENTS" en de tagline "GENTS — Suits You" blijven
 * ONVERTAALD; maten/getallen/prijzen/HTML-tags blijven intact.
 */

export const LANG_NAME: Record<Locale, string> = {
  nl: "Nederlands",
  en: "English",
  de: "German",
  fr: "French",
  es: "Spanish",
};

export function hasTranslationProvider(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/** Stabiele 32-bit hash van de brontekst, om wijzigingen te detecteren. */
function hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Vertaalt een array strings naar één doeltaal. Geeft een array terug met
 * dezelfde lengte/volgorde. `kind` stuurt de toon (ui/title/description).
 */
export async function translateStrings(
  texts: string[],
  locale: Locale,
  kind: "ui" | "title" | "description" = "ui",
): Promise<string[]> {
  if (!texts.length) return [];
  const lang = LANG_NAME[locale] || "English";
  const toneByKind: Record<typeof kind, string> = {
    ui: `short UI labels and microcopy for a premium menswear webshop`,
    title: `concise e-commerce product titles`,
    description: `product descriptions; PRESERVE any HTML tags and structure exactly`,
  };
  const sys =
    `You are a professional fashion translator for GENTS, a Dutch menswear brand (suits, blazers, formalwear). ` +
    `Translate the given Dutch ${toneByKind[kind]} into ${lang}. Rules: ` +
    `keep the brand name "GENTS" and the tagline "GENTS — Suits You" UNtranslated; ` +
    `keep numbers, sizes (48, M, L), prices, %-signs, HTML tags and placeholders exactly; ` +
    `translate naturally and concisely in a refined, premium tone (no literal word-for-word). ` +
    `Return ONLY a JSON array of strings, same length and order as the input. No explanation.`;
  const user = JSON.stringify(texts);

  const anth = process.env.ANTHROPIC_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  let text = "";
  if (anth) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anth, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.CONTENT_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 4000,
        system: sys,
        messages: [{ role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    text = (await r.json())?.content?.[0]?.text || "";
  } else if (oai) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${oai}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        temperature: 0,
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
      }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    text = (await r.json())?.choices?.[0]?.message?.content || "";
  } else {
    throw new Error("Geen ANTHROPIC_API_KEY of OPENAI_API_KEY gezet.");
  }

  const m = text.match(/\[[\s\S]*\]/);
  const arr = m ? JSON.parse(m[0]) : [];
  if (!Array.isArray(arr) || arr.length !== texts.length) throw new Error("Onverwacht vertaalresultaat.");
  return arr.map((x) => String(x));
}

/* ───────────────────────── UI + content KV-store ───────────────────────── */

type StoreVal = { h: number; v: string };
type Store = Record<string, StoreVal>; // sleutel = "<ns>:<key>"

const storeId = (locale: Locale) => `translations:${locale}`;

export async function getTranslationStore(locale: Locale): Promise<Store> {
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, storeId(locale))).limit(1);
    return ((rows[0]?.data as Store) || {}) as Store;
  } catch {
    return {};
  }
}

async function saveTranslationStore(locale: Locale, data: Store): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ id: storeId(locale), data, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data, updatedAt: sql`now()` } });
}

export type TransEntry = { ns: string; key: string; source: string };

/** Vertaalt (delta) een set bron-entries naar de KV-store voor één locale. */
export async function ensureEntries(
  entries: TransEntry[],
  locale: Locale,
  kind: "ui" | "title" | "description" = "ui",
): Promise<{ translated: number; total: number }> {
  if (locale === DEFAULT_LOCALE || !entries.length) return { translated: 0, total: entries.length };
  const store = await getTranslationStore(locale);
  const todo = entries.filter((e) => {
    const cur = store[`${e.ns}:${e.key}`];
    return !cur || cur.h !== hash(e.source);
  });
  let translated = 0;
  const CHUNK = 30;
  for (let i = 0; i < todo.length; i += CHUNK) {
    const batch = todo.slice(i, i + CHUNK);
    const out = await translateStrings(batch.map((b) => b.source), locale, kind);
    batch.forEach((b, j) => {
      store[`${b.ns}:${b.key}`] = { h: hash(b.source), v: out[j] || b.source };
    });
    translated += batch.length;
    await saveTranslationStore(locale, store); // incrementeel: bestand tegen time-outs
  }
  return { translated, total: entries.length };
}

/** UI-microcopy (lib/messages NL-sleutels) vertalen naar één locale. */
export function ensureUi(locale: Locale) {
  return ensureEntries(uiSourceKeys().map((e) => ({ ns: "ui", key: e.key, source: e.source })), locale, "ui");
}

/**
 * Cron-vertalingen (UI) voor de client-provider — alléén de overrides voor deze
 * locale, niet de hele NL-catalogus (die zit al in de client-bundle via t()).
 * Zo blijft de per-pagina payload klein. NL → undefined (client gebruikt bundle).
 * Server-only (DB-lezen).
 */
export async function getUiMessages(locale: Locale): Promise<Record<string, string> | undefined> {
  if (locale === DEFAULT_LOCALE) return undefined;
  const store = await getTranslationStore(locale);
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(store)) {
    if (k.startsWith("ui:") && val?.v) out[k.slice(3)] = val.v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Eén content-veld vertaald ophalen (sync, uit een eerder geladen store). */
export function pickTranslation(store: Store, ns: string, key: string, fallback: string): string {
  return store[`${ns}:${key}`]?.v ?? fallback;
}

/* ─────────────────────────── Catalogus (producten) ─────────────────────── */

/**
 * Vertaalt zichtbare producten naar één locale (delta/idempotent). Titel altijd;
 * omschrijving + SEO alleen met `descriptions` (duurder). Schrijft naar
 * product_translations (gelezen door lib/catalog.ts).
 */
export async function ensureCatalogTranslations(
  locale: Locale,
  opts: { descriptions?: boolean; limit?: number } = {},
): Promise<{ translated: number }> {
  if (locale === DEFAULT_LOCALE) return { translated: 0 };
  const db = getDb();
  const wantDesc = Boolean(opts.descriptions);
  const limit = Math.max(1, Math.min(5000, opts.limit ?? 2000));
  // Zichtbare producten zonder (volledige) vertaling in deze taal.
  const rows = await db.execute<{ id: string; title: string; description_html: string }>(sql`
    select p.id, p.title, p.description_html
    from products p
    left join product_translations t on t.product_id = p.id and t.locale = ${locale}
    where p.status='active' and p.has_image=true and p.in_stock=true and p.is_group_primary=true
      and (t.product_id is null ${wantDesc ? sql`or coalesce(t.description_html,'') = ''` : sql``})
    order by p.stock_qty desc
    limit ${limit}
  `);
  const list = rows.rows;
  if (!list.length) return { translated: 0 };

  let done = 0;
  const BATCH = 25;
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    try {
      const titles = await translateStrings(slice.map((s) => s.title), locale, "title");
      const descs = wantDesc
        ? await translateStrings(slice.map((s) => s.description_html || ""), locale, "description")
        : [];
      await db
        .insert(productTranslations)
        .values(
          slice.map((s, j) => ({
            productId: s.id,
            locale,
            title: titles[j] || s.title,
            descriptionHtml: wantDesc ? descs[j] || s.description_html || "" : "",
          })),
        )
        .onConflictDoUpdate({
          target: [productTranslations.productId, productTranslations.locale],
          set: {
            title: sql`excluded.title`,
            ...(wantDesc ? { descriptionHtml: sql`excluded.description_html` } : {}),
            updatedAt: sql`now()`,
          },
        });
      done += slice.length;
    } catch {
      // batch overslaan; volgende run pakt 'm opnieuw op
    }
  }
  return { translated: done };
}

/** Alle te vertalen doeltalen (alles behalve NL). */
export function targetLocales(): Locale[] {
  return LOCALES.filter((l) => l !== DEFAULT_LOCALE);
}
