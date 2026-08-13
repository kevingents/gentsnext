import { put } from "@vercel/blob";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { buildPrompt, getMediaThemes, themeForProduct } from "@/lib/media-themes";
import { modelRefFor } from "@/lib/brand-models";
import { newCollectionCond } from "@/lib/new-collection";

/**
 * De AI-sfeerbeeld-generator, als gedeelde functie zodat zowel het CLI-script
 * (npm run gen:lifestyle) als de cron (/api/cron/beeldgeneratie) exact dezelfde
 * pijplijn draaien. Eén rail — geen tweede kopie die stilletjes afwijkt.
 *
 * Thema's en camerastijlen komen uit de portal (app_settings.media-themes), de
 * merk- en kwaliteitsregels uit lib/media-themes.
 *
 * Kwaliteitsknoppen die de oude gen:lifestyle NIET aan had staan en die het
 * verschil maken: resolution 2k, generation_mode quality, expliciete 4:5 en een
 * vast merkgezicht via face_reference.
 */

const API = "https://api.fashn.ai/v1";

/**
 * Credits per beeld — gemeten, niet geschat: 2k + quality kost 4, face_reference
 * telt er 3 bij. Wordt gebruikt om te stoppen vóórdat het saldo op is.
 */
export const CREDITS_PER_IMAGE = 7;
export const CREDITS_PER_IMAGE_NO_FACE = 4;

export type Slot = "lifestyle" | "lifestyle2" | "lifestyle3" | "model2";

const SLOT_COLUMN: Record<Slot, { set: string; alt: string; db: string }> = {
  lifestyle: { set: "lifestyleImageUrl", alt: "lifestyleImageAlt", db: "lifestyle_image_url" },
  lifestyle2: { set: "lifestyleImageUrl2", alt: "lifestyleImageAlt2", db: "lifestyle_image_url2" },
  lifestyle3: { set: "lifestyleImageUrl3", alt: "lifestyleImageAlt3", db: "lifestyle_image_url3" },
  model2: { set: "modelImageUrl2", alt: "modelImageAlt2", db: "model_image_url2" },
};

export type GenerateOptions = {
  /** Maximaal aantal producten deze run. */
  limit: number;
  /** Doelslot; default lifestyle. */
  slot?: Slot;
  /** Beperk tot één hoofdgroep. Leeg = alle hoofdgroepen met een actief thema. */
  hoofdgroep?: string;
  /** Alleen de mix&match-colberts (de ingang van de pak-samensteller). */
  mixMatchOnly?: boolean;
  /** Handle-filter (LIKE %…%). */
  only?: string;
  /** Bestaande beelden overschrijven i.p.v. alleen lege slots vullen. */
  redo?: boolean;
  /** Alleen producten uit de nieuwe collectie. */
  onlyNew?: boolean;
  /** Ook niet-primaire kleurvarianten (kost credits per kleur). */
  includeVariants?: boolean;
  /** Vast merkgezicht meesturen (default aan). Uit = FASHN kiest zelf, goedkoper. */
  useFaceReference?: boolean;
  /** Harde bovengrens op credits deze run — de cron-rem. */
  maxCredits?: number;
  /** Stop als het saldo hieronder komt, zodat er altijd wat overblijft. */
  minCreditsLeft?: number;
  log?: (line: string) => void;
};

export type GenerateResult = {
  done: number;
  skipped: number;
  failed: number;
  creditsBefore: number;
  creditsAfter: number;
  stoppedBecause: "klaar" | "credits" | "limiet-credits";
  items: { handle: string; theme: string; camera: string; ok: boolean }[];
};

function toFullRes(u: string) {
  try {
    const x = new URL(u);
    if (x.pathname.includes("/cdn/shop") || x.hostname.endsWith("shopify.com")) {
      x.searchParams.delete("width");
      x.searchParams.delete("height");
    }
    return x.toString();
  } catch {
    return u;
  }
}

async function safeFetch(url: string, opts?: RequestInit, retries = 4): Promise<Response | null> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fetch(url, opts);
    } catch {
      if (i === retries) return null;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
  return null;
}

async function poll(id: string, key: string, tries = 160): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await safeFetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!st || !st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") return null;
  }
  return null;
}

async function runFashn(inputs: Record<string, unknown>, key: string): Promise<string | null> {
  const s = await safeFetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "product-to-model", inputs }),
  });
  if (!s || !s.ok) return null;
  const { id } = await s.json();
  return poll(id, key);
}

/** Bij een transiente fout NIET 0 teruggeven — dat zou de credit-stop onterecht triggeren. */
export async function getCredits(key: string): Promise<number> {
  try {
    const r = await fetch(`${API}/credits`, { headers: { Authorization: `Bearer ${key}` } });
    const j = await r.json();
    const n = Number(j?.credits?.total);
    return Number.isFinite(n) ? n : 999999;
  } catch {
    return 999999;
  }
}

export async function generateMedia(opts: GenerateOptions): Promise<GenerateResult> {
  const log = opts.log ?? (() => {});
  const key = process.env.FASHN_API_KEY || "";
  const token = process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
  if (!key || !token) throw new Error("FASHN_API_KEY en een blob-token zijn nodig.");

  const slot = SLOT_COLUMN[opts.slot ?? "lifestyle"];
  const useFace = opts.useFaceReference !== false;
  const perImage = useFace ? CREDITS_PER_IMAGE : CREDITS_PER_IMAGE_NO_FACE;
  const minLeft = opts.minCreditsLeft ?? perImage;

  const store = await getMediaThemes();
  const actieveStijlen = store.cameraStyles.filter((s) => s.enabled);
  if (!actieveStijlen.length) throw new Error("Geen actieve camerastijlen — zet er minstens één aan in de portal.");

  const db = getDb();
  const rows = await db.execute<{
    id: string;
    handle: string;
    title: string;
    hg: string;
    vcl: string | null;
    img: string;
  }>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg, p.variant_color_label vcl,
      (select url from product_images pi where pi.product_id=p.id and pi.source = '' order by position limit 1) img
    from products p
    where p.status='active' and p.has_image and p.in_stock
      ${opts.includeVariants ? sql`` : sql`and p.is_group_primary`}
      ${opts.onlyNew ? sql`and ${newCollectionCond}` : sql``}
      -- Alleen producten met een ÉCHTE foto: has_image is sinds de AI-packshots
      -- ook waar voor AI-only producten, en die mogen nooit de input zijn.
      and exists (select 1 from product_images pi where pi.product_id=p.id and pi.source = '')
      ${opts.mixMatchOnly
        ? sql`and p.attributes->>'mix_and_match'='Ja' and p.attributes->>'hoofdgroep_omschrijving'='Colberts'`
        : sql``}
      ${opts.hoofdgroep ? sql`and p.attributes->>'hoofdgroep_omschrijving'=${opts.hoofdgroep}` : sql``}
      ${opts.only ? sql`and p.handle like ${`%${opts.only}%`}` : sql``}
      ${opts.redo ? sql`` : sql`and ${sql.raw(`p.${slot.db}`)} = ''`}
    order by p.stock_qty desc
    limit ${Math.max(1, Math.min(500, opts.limit))}
  `);

  let credits = await getCredits(key);
  const creditsBefore = credits;
  let spent = 0;
  const result: GenerateResult = {
    done: 0,
    skipped: 0,
    failed: 0,
    creditsBefore,
    creditsAfter: credits,
    stoppedBecause: "klaar",
    items: [],
  };

  log(`${rows.rows.length} producten → ${slot.db} — ${credits} credits.`);

  let i = 0;
  for (const r of rows.rows) {
    if (credits < minLeft) {
      result.stoppedBecause = "credits";
      log(`Gestopt: saldo ${credits} onder de ondergrens ${minLeft}.`);
      break;
    }
    if (opts.maxCredits && spent + perImage > opts.maxCredits) {
      result.stoppedBecause = "limiet-credits";
      log(`Gestopt: run-limiet van ${opts.maxCredits} credits bereikt.`);
      break;
    }

    const theme = themeForProduct(store, { hoofdgroep: r.hg, handle: r.handle, title: r.title });
    if (!theme || !r.img) {
      result.skipped++;
      log(`• ${r.handle} — geen actief thema voor "${r.hg}" of geen echte foto, overslaan`);
      continue;
    }
    const camera = actieveStijlen[i % actieveStijlen.length];
    const prompt = buildPrompt({ hoofdgroep: r.hg, color: r.vcl ?? "", title: r.title }, theme, camera);
    if (!prompt) {
      result.skipped++;
      log(`• ${r.handle} — geen merkregel voor "${r.hg}", overslaan`);
      continue;
    }
    i++;
    log(`• ${r.handle} (${theme.label} · ${camera.label})`);

    try {
      const inputs: Record<string, unknown> = {
        product_image: toFullRes(r.img),
        prompt,
        aspect_ratio: "4:5",
        resolution: "2k",
        generation_mode: "quality",
        output_format: "jpeg",
      };
      const face = useFace ? modelRefFor(i) : null;
      if (face) {
        inputs.face_reference = face;
        inputs.face_reference_mode = "match_reference";
      }

      const out = await runFashn(inputs, key);
      if (!out) {
        result.failed++;
        result.items.push({ handle: r.handle, theme: theme.label, camera: camera.label, ok: false });
        continue;
      }
      const src = await safeFetch(out);
      if (!src || !src.ok) {
        result.failed++;
        continue;
      }
      const blob = await put(`ai-editorial/${r.handle}-${camera.id}.jpg`, await src.arrayBuffer(), {
        access: "public",
        token,
        contentType: "image/jpeg",
        allowOverwrite: true,
      });
      // Cache-bust: zelfde pad wordt overschreven, een unieke ?v dwingt Next/Image
      // het verse beeld op te halen i.p.v. de gecachte versie.
      const url = `${blob.url}?v=${Date.now()}`;

      const patch = { [slot.set]: url, [slot.alt]: `${r.title} — ${theme.label}` } as Record<string, string>;
      let saved = false;
      for (let a = 1; a <= 4 && !saved; a++) {
        try {
          await db.update(products).set(patch).where(eq(products.id, r.id));
          saved = true;
        } catch {
          await new Promise((rr) => setTimeout(rr, 2000 * a));
        }
      }
      if (saved) {
        result.done++;
        spent += perImage;
        result.items.push({ handle: r.handle, theme: theme.label, camera: camera.label, ok: true });
        log(`   ✓ ${slot.db}`);
      } else {
        result.failed++;
        log(`   opslaan mislukt na retries — de volgende run doet 't opnieuw`);
      }
    } catch (e) {
      result.failed++;
      log(`   fout bij ${r.handle}: ${String((e as Error)?.message || e).slice(0, 120)}`);
    }
    credits = await getCredits(key);
  }

  result.creditsAfter = credits;
  return result;
}
