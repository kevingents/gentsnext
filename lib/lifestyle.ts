import { put, del } from "@vercel/blob";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products } from "@/db/schema";
import { getVisualLearnings, learningsPromptBlock } from "@/lib/visual-learnings";
import { buildPrompt, getMediaThemes, themeForProduct } from "@/lib/media-themes";

/**
 * Herbruikbare sfeerbeeld-generatie per product (FASHN product-to-model), met de
 * geleerde stijl-regels uit de learnings-store in de prompt. Geport uit
 * scripts/generate-lifestyle-media.ts zodat de "lerende sfeerbeeld-studio" één
 * slot opnieuw kan genereren vanuit een API-route. PUUR PREVIEW (lifestyle_image_url*).
 */

const API = "https://api.fashn.ai/v1";

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}
function toFullRes(u: string): string {
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
async function safeFetch(url: string, init?: RequestInit) {
  try {
    return await fetch(url, init);
  } catch {
    return null;
  }
}
async function poll(id: string, key: string): Promise<string | null> {
  for (let i = 0; i < 140; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    const st = await safeFetch(`${API}/status/${id}`, { headers: { Authorization: `Bearer ${key}` } });
    if (!st || !st.ok) continue;
    const j = await st.json();
    if (j.status === "completed" && j.output?.[0]) return j.output[0] as string;
    if (j.status === "failed") return null;
  }
  return null;
}
async function run(inputs: Record<string, unknown>, key: string): Promise<string | null> {
  const s = await safeFetch(`${API}/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model_name: "product-to-model", inputs }),
  });
  if (!s || !s.ok) return null;
  const { id } = await s.json();
  return poll(id, key);
}
async function toBlob(srcUrl: string, path: string, token: string): Promise<string | null> {
  const res = await safeFetch(srcUrl);
  if (!res || !res.ok) return null;
  const blob = await put(path, await res.arrayBuffer(), { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
  return `${blob.url}?v=${Date.now()}`;
}

function blobPath(handle: string, slot: 1 | 2 | 3): string {
  return slot === 1 ? `ai-lifestyle/${handle}.jpg` : `ai-lifestyle/${handle}-${slot}.jpg`;
}

/** Apart pad voor een NIET-live kandidaat (overschrijft nooit het live-beeld). */
function candidatePath(handle: string, slot: 1 | 2 | 3): string {
  return `ai-lifestyle/_candidates/${handle}-${slot}-${Date.now()}.jpg`;
}

type ProdRow = { id: string; handle: string; title: string; hg: string; vcl: string | null; img: string; l1: string; l2: string; l3: string };

async function loadProduct(handle: string): Promise<ProdRow | null> {
  const db = getDb();
  const rows = await db.execute<ProdRow>(sql`
    select p.id, p.handle, p.title, p.attributes->>'hoofdgroep_omschrijving' hg, p.variant_color_label vcl,
      (select url from product_images pi where pi.product_id=p.id order by position limit 1) img,
      p.lifestyle_image_url l1, p.lifestyle_image_url2 l2, p.lifestyle_image_url3 l3
    from products p where p.handle=${handle} limit 1`);
  return rows.rows[0] || null;
}

/**
 * Genereer één sfeerbeeld-slot (1|2|3) opnieuw, met de geleerde stijl-regels.
 *
 * `opties` laat je thema en camerastijl expliciet kiezen. Zonder keuze blijft het
 * oude gedrag: thema volgt de hoofdgroep, camerastijl is willekeurig. Dat is wat
 * de cron en de scripts doen — die moeten juist géén mening hebben.
 */
export async function regenerateLifestyleSlot(
  handle: string,
  slot: 1 | 2 | 3,
  opties: { themaId?: string; camerastijlId?: string } = {},
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const key = process.env.FASHN_API_KEY || "";
  const token = blobToken();
  if (!key) return { ok: false, error: "FASHN_API_KEY ontbreekt." };
  if (!token) return { ok: false, error: "Blob-token ontbreekt." };

  const r = await loadProduct(handle);
  if (!r) return { ok: false, error: "Product niet gevonden." };
  if (!r.img) return { ok: false, error: "Geen productfoto om op te baseren." };

  // Thema + camerastijl komen uit de portal-store, net als in het script en de cron.
  // Eén rail: pas je een thema aan, dan hergenereert de studio ook mét dat thema.
  // De kleding-uitzonderingen (rok/jacquet = white-tie, smoking = black-tie) zitten
  // in buildPrompt, zodat script en cron dezelfde blinde vlek niet meer hebben.
  const store = await getMediaThemes();

  /* Een expliciet gekozen thema wint van de hoofdgroep-regel. Bewust ZONDER de
     enabled-check: een thema dat je met de hand aanwijst wil je ook kunnen
     gebruiken als het niet in de automatische rotatie zit — anders moet je het
     eerst aanzetten voor de hele catalogus om één beeld te maken. */
  const theme = opties.themaId
    ? store.themes.find((t) => t.id === opties.themaId)
    : themeForProduct(store, { hoofdgroep: r.hg, handle: r.handle, title: r.title });
  if (!theme) {
    return {
      ok: false,
      error: opties.themaId
        ? `Onbekend beeldthema: "${opties.themaId}".`
        : `Geen actief beeldthema voor hoofdgroep "${r.hg || "?"}".`,
    };
  }

  const stijlen = store.cameraStyles.filter((s) => s.enabled);
  let camera;
  if (opties.camerastijlId) {
    camera = store.cameraStyles.find((s) => s.id === opties.camerastijlId);
    if (!camera) return { ok: false, error: `Onbekende camerastijl: "${opties.camerastijlId}".` };
  } else {
    if (!stijlen.length) return { ok: false, error: "Geen actieve camerastijl — zet er één aan bij Beeldthema's." };
    // Willekeurige camerastijl: "opnieuw proberen" moet iets ánders opleveren.
    camera = stijlen[Math.floor(Math.random() * stijlen.length)];
  }

  const basis = buildPrompt(
    { hoofdgroep: r.hg, color: r.vcl ?? "", title: r.title, handle: r.handle },
    theme,
    camera
  );
  if (!basis) return { ok: false, error: `Geen merkregel voor hoofdgroep "${r.hg || "?"}".` };

  // Mét handle: de feedback op dít product telt als correctie in plaats van te
  // verdrinken tussen die van alle andere producten. Zie lib/visual-learnings.ts.
  const learnings = await getVisualLearnings();
  const prompt = `${basis}${learningsPromptBlock(learnings, { handle })}`;

  const out = await run(
    {
      product_image: toFullRes(r.img),
      prompt,
      aspect_ratio: "4:5",
      resolution: "2k",
      generation_mode: "quality",
      output_format: "jpeg",
    },
    key
  );
  if (!out) return { ok: false, error: "FASHN-generatie mislukt." };
  /* KANDIDAAT: naar een apart pad → het live-beeld blijft ongemoeid tot goedkeuren. */
  const url = await toBlob(out, candidatePath(handle, slot), token);
  if (!url) return { ok: false, error: "Upload naar blob mislukt." };
  return { ok: true, url };
}

/** Zet een goedgekeurde kandidaat live op het slot (DB) en ruim de oude live-blob op. */
export async function approveLifestyleCandidate(handle: string, slot: 1 | 2 | 3, url: string): Promise<{ ok: boolean; error?: string }> {
  const u = String(url || "").trim();
  if (!u) return { ok: false, error: "Geen kandidaat-URL." };
  const r = await loadProduct(handle);
  if (!r) return { ok: false, error: "Product niet gevonden." };
  const prev = slot === 1 ? r.l1 : slot === 2 ? r.l2 : r.l3;
  const patch: Record<string, string> = {};
  if (slot === 1) { patch.lifestyleImageUrl = u; patch.lifestyleImageAlt = `${r.title} — sfeerbeeld`; }
  else if (slot === 2) patch.lifestyleImageUrl2 = u;
  else patch.lifestyleImageUrl3 = u;
  await getDb().update(products).set(patch).where(eq(products.id, r.id));
  if (prev && prev.split("?")[0] !== u.split("?")[0]) {
    try { await del(prev.split("?")[0], { token: blobToken() }); } catch { /* blob al weg */ }
  }
  return { ok: true };
}

/** Verwerp een kandidaat die nooit live ging — verwijder de kandidaat-blob. */
export async function discardLifestyleCandidate(url: string): Promise<{ ok: boolean }> {
  const u = String(url || "").trim();
  if (u) { try { await del(u.split("?")[0], { token: blobToken() }); } catch { /* al weg */ } }
  return { ok: true };
}

/** Wis één sfeerbeeld-slot (db-veld leeg + blob verwijderen) — na afkeuren. */
export async function clearLifestyleSlot(handle: string, slot: 1 | 2 | 3): Promise<{ ok: boolean }> {
  const r = await loadProduct(handle);
  if (!r) return { ok: false };
  const cur = slot === 1 ? r.l1 : slot === 2 ? r.l2 : r.l3;
  const patch: Record<string, string> = {};
  if (slot === 1) { patch.lifestyleImageUrl = ""; patch.lifestyleImageAlt = ""; }
  else if (slot === 2) patch.lifestyleImageUrl2 = "";
  else patch.lifestyleImageUrl3 = "";
  await getDb().update(products).set(patch).where(eq(products.id, r.id));
  if (cur) { try { await del(cur.split("?")[0], { token: blobToken() }); } catch { /* blob al weg */ } }
  return { ok: true };
}
