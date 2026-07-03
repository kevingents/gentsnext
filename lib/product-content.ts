import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { getProductByHandle } from "@/lib/catalog";
import { formatEuro } from "@/lib/format";

/**
 * Portal-beheerbare productomschrijving-override (los van de gesynchroniseerde
 * SRS/Sanity-data, zodat een sync 'm niet overschrijft). Cache-vrij: per product
 * een app_settings-rij `pcontent:<handle>`. De PDP gebruikt de override als die
 * er is, anders de oorspronkelijke omschrijving. SEO-titel/omschrijving lopen via
 * lib/seo-overrides (één SEO-systeem).
 */
export type ProductContentOverride = { descriptionHtml?: string };

const keyFor = (handle: string) => `pcontent:${handle}`;

export async function getProductContentOverride(handle: string): Promise<ProductContentOverride | null> {
  if (!handle) return null;
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, keyFor(handle))).limit(1);
    const data = rows[0]?.data as ProductContentOverride | undefined;
    return data && (data.descriptionHtml || data.descriptionHtml === "") ? data : null;
  } catch {
    return null;
  }
}

export async function setProductContentOverride(handle: string, patch: ProductContentOverride): Promise<void> {
  if (!handle) return;
  const db = getDb();
  const descriptionHtml = String(patch.descriptionHtml ?? "").trim().slice(0, 8000);
  const data: ProductContentOverride = { descriptionHtml };
  if (!descriptionHtml) {
    // leeg = override verwijderen → terug naar de originele omschrijving
    await db.delete(appSettings).where(eq(appSettings.id, keyFor(handle)));
    return;
  }
  await db
    .insert(appSettings)
    .values({ id: keyFor(handle), data, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data, updatedAt: sql`now()` } });
}

export type ProductCopyDraft = { descriptionHtml: string; seoTitle: string; seoDescription: string };

/**
 * Genereert (via Claude) een premium, on-brand NL productomschrijving + SEO-titel
 * + meta-omschrijving uit de bestaande productdata. Verzint GEEN specificaties:
 * gebruikt alleen de meegegeven kenmerken. Slaat NIETS op (portal reviewt eerst).
 */
export async function generateProductCopy(handle: string): Promise<ProductCopyDraft | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const data = await getProductByHandle(handle);
  if (!data) return null;
  const { product, variants } = data;
  const attrs = (product.attributes ?? {}) as Record<string, unknown>;

  const facts: string[] = [];
  const push = (label: string, v: unknown) => {
    const s = String(v ?? "").trim();
    if (s) facts.push(`${label}: ${s}`);
  };
  push("Titel", product.title);
  push("Merk", attrs.merk || product.vendor);
  push("Categorie", attrs.hoofdgroep_omschrijving);
  push("Kleur", product.variantColorLabel);
  push("Materiaal", attrs.materiaal);
  push("Samenstelling", attrs.samenstelling_materiaal || attrs.samenstelling);
  push("Pasvorm", attrs.pasvorm);
  push("Sluiting", attrs.sluiting);
  push("Boord", attrs.boord);
  push("Manchet", attrs.manchet);
  push("Seizoen", attrs.seizoen);
  if (variants.length) {
    const min = Math.min(...variants.map((v) => v.priceCents));
    facts.push(`Prijs vanaf: ${formatEuro(min)}`);
  }

  const system = `Je schrijft productteksten voor GENTS, dé Nederlandse herenmode-specialist voor formele momenten (premium maar betaalbare luxe, persoonlijk advies in 19 winkels). Toon: stijlvol, zelfverzekerd, warm — niet schreeuwerig. Schrijf in het Nederlands.
REGELS:
- Gebruik UITSLUITEND de meegegeven kenmerken. Verzin GEEN materialen, percentages, certificeringen of eigenschappen die er niet staan.
- Noem waar passend de gelegenheid/styling (bv. bruiloft, zakelijk, gala) en het draaggemak, maar blijf eerlijk.
- Verander NOOIT de merk-/productnaam.
- descriptionHtml: 2-3 korte alinea's in simpele HTML (<p>…</p>, eventueel één <ul><li>…</li></ul> met 2-4 kernpunten). Geen <h1>, geen inline styles.
- seoTitle: max 60 tekens, bevat productnaam + GENTS-relevant trefwoord.
- seoDescription: 140-160 tekens, wervend en concreet.
Antwoord ALLEEN met JSON: {"descriptionHtml":"…","seoTitle":"…","seoDescription":"…"}`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.CONTENT_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 900,
        system,
        messages: [{ role: "user", content: `Productkenmerken:\n${facts.join("\n")}` }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = j?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (typeof parsed.descriptionHtml !== "string") return null;
    return {
      descriptionHtml: String(parsed.descriptionHtml).slice(0, 8000),
      seoTitle: String(parsed.seoTitle || "").slice(0, 200),
      seoDescription: String(parsed.seoDescription || "").slice(0, 320),
    };
  } catch {
    return null;
  }
}
