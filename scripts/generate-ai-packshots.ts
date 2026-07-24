import "@/lib/load-env";
import { put } from "@vercel/blob";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productImages } from "@/db/schema";

/**
 * AI-packshots (ZONDER model — Kevin, 23 juli) voor actieve producten mét
 * voorraad maar zonder énige foto: genereer per product een consistent
 * GENTS-studio-packshot met fal.ai (FLUX) op basis van titel/kenmerken, upload
 * naar blob en registreer als product_images-rij met source='ai-packshot'.
 * De Shopify-import laat die rijen staan en vervangt ze zodra er echte foto's
 * zijn (echte foto's winnen). hasImage gaat direct aan → product wordt zichtbaar.
 *
 * LET OP: dit is een indicatief beeld (geen foto van het echte artikel); de PDP
 * toont daarom een "beeld ter indicatie"-noot.
 *
 *   npm run gen:ai-packshots -- 10                  (10 producten deze run)
 *   npm run gen:ai-packshots -- 50 Overhemden       (alleen één hoofdgroep)
 *   npm run gen:ai-packshots -- 200 Overhemden redo (bestaande AI-beelden VERVANGEN
 *                                                    door de actuele stijl; echte
 *                                                    foto's blijven altijd ongemoeid)
 */

const MODEL = process.env.FAL_PACKSHOT_MODEL || "fal-ai/flux-pro/v1.1-ultra";

const STYLE =
  "Professional high-end menswear e-commerce product packshot, exactly like premium webshop studio photography. The very light neutral grey seamless studio backdrop (#f4f4f4) fills the ENTIRE image edge-to-edge — no white backdrop panel, no inner frame, no border, no vignette, one continuous seamless tone across the whole frame. Soft even diffused lighting, subtle soft shadow, tack sharp, premium catalog quality. Product large and perfectly centered. STRICTLY no people. No text, no labels with words, no watermark, no logo, no props.";

// Ghost-mannequin met natuurlijk volume — de stijl van onze échte studiofoto's
// (Kevin, 24 juli: referentie overshirt-light-grey). Cruciaal in de bewoording:
// het kledingstuk "zweeft" met gevulde 3D-vorm, hals is HOL (binnenkant kraag
// zichtbaar) en er is expliciet géén buste/vorm/hanger — de eerdere generieke
// ghost-prompt leverde bustes met houten halsknop op, vandaar de harde bans.
const GHOST =
  "shown with the invisible-mannequin ghost effect: natural three-dimensional body volume as if worn by an invisible person, chest and shoulders filled out, the neck opening HOLLOW showing the inside of the back collar, floating against the backdrop. Absolutely NO mannequin, bust, torso form, neck block, wooden knob, stand or hanger visible — nothing black, chrome or wooden behind or inside the garment";
const PRESENT: Record<string, string> = {
  Overhemden: `the dress shirt ${GHOST}, buttoned up, collar crisp, straight front view, sleeves falling naturally at the sides`,
  "Polo-shirts": `the polo shirt ${GHOST}, collar neat, straight front view`,
  "T-Shirts": `the t-shirt ${GHOST}, straight front view`,
  Truien: `the knitwear sweater ${GHOST}, straight front view, knit texture sharp`,
  "Truien & Vesten": `the knitwear ${GHOST}, straight front view, knit texture sharp`,
  Vesten: `the cardigan ${GHOST}, button placket closed, straight front view`,
  Colberts: `the blazer ${GHOST}, front buttoned, lapels sharp, straight front view`,
  Pakken: `the full suit — jacket buttoned with the matching trousers below as one worn outfit — ${GHOST}, straight front view`,
  Gilets: `the waistcoat ${GHOST}, bottom button left undone, straight front view`,
  Jassen: `the coat ${GHOST}, front closed, straight front view`,
  Broeken: "the trousers neatly folded over an invisible hanger bar, hanging straight, front view",
  Jeans: "the jeans neatly folded over an invisible hanger bar, hanging straight, front view",
  Schoenen: "the pair of shoes at a three-quarter angle, one shoe slightly ahead of the other, on a subtle seamless floor",
  Stropdassen: "the necktie elegantly folded in a loose loop, laid flat, fabric texture visible",
  Strikken: "the bow tie pre-tied, laid flat, centered, fabric texture visible",
  Pochet: "the pocket square elegantly folded with a soft puff fold, laid flat",
  Riemen: "the leather belt loosely coiled in a neat spiral, buckle facing up",
  Bretels: "the suspenders neatly arranged flat in a Y-shape",
  Sjaals: "the scarf loosely folded lengthwise with soft drape, laid flat",
  Manchetknopen: "the pair of cufflinks side by side facing up, photographed top-down close-up directly on the seamless warm grey backdrop, macro detail",
  Sokken: "the pair of socks neatly folded flat side by side",
};

type Cand = {
  id: string;
  handle: string;
  title: string;
  hoofdgroep: string;
  kleur: string;
  materiaal: string;
  dessin: string;
};

async function generate(prompt: string, key: string): Promise<string | null> {
  try {
    const res = await fetch(`https://fal.run/${MODEL}`, {
      method: "POST",
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        aspect_ratio: "3:4",
        num_images: 1,
        output_format: "jpeg",
        enable_safety_checker: true,
        safety_tolerance: "5",
      }),
    });
    if (!res.ok) {
      console.error("    fal-fout", res.status, (await res.text()).slice(0, 160));
      return null;
    }
    const j = await res.json();
    return j?.images?.[0]?.url || null;
  } catch (e) {
    console.error("    fout:", String((e as Error)?.message || e).slice(0, 120));
    return null;
  }
}

async function toBlob(srcUrl: string, path: string, token: string): Promise<string | null> {
  try {
    const r = await fetch(srcUrl);
    if (!r.ok) return null;
    const blob = await put(path, await r.arrayBuffer(), { access: "public", token, contentType: "image/jpeg", allowOverwrite: true });
    return blob.url;
  } catch {
    return null;
  }
}

function buildPrompt(c: Cand): string {
  const pres = PRESENT[c.hoofdgroep] || "the menswear product neatly presented flat, front view";
  const traits = [c.kleur && `color: ${c.kleur}`, c.materiaal && `material: ${c.materiaal}`, c.dessin && `pattern: ${c.dessin}`]
    .filter(Boolean)
    .join(", ");
  return `Product packshot of a premium menswear item: "${c.title}"${traits ? ` (${traits})` : ""}. Presentation: ${pres}. ${STYLE}`;
}

async function main() {
  const key = process.env.FAL_KEY || process.env.FAL_API_KEY || "";
  const token = process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
  if (!key) { console.error("FAL_KEY ontbreekt in .env.local."); process.exit(1); }
  if (!token) { console.error("Blob-token ontbreekt."); process.exit(1); }

  const count = Math.max(1, Math.min(1200, Number(process.argv[2]) || 10));
  const onlyHg = (process.argv[3] || "").trim();
  const redo = (process.argv[4] || "").trim() === "redo";

  const db = getDb();
  // Kandidaten: actief + voorraad + groep-primair. Normaal: GEEN enkele
  // image-rij (idempotent). Redo: juist producten met alléén een ai-packshot
  // (stijl-vervanging); producten met échte foto's blijven altijd buiten schot.
  const hgCond = onlyHg ? sql` and p.attributes->>'hoofdgroep_omschrijving' = ${onlyHg}` : sql``;
  const imgCond = redo
    ? sql` and exists (select 1 from product_images i where i.product_id = p.id and i.source = 'ai-packshot')
        and not exists (select 1 from product_images i where i.product_id = p.id and i.source = '')`
    : sql` and not exists (select 1 from product_images i where i.product_id = p.id)`;
  const rows = await db.execute<Cand>(sql`
    select p.id, p.handle, p.title,
      coalesce(p.attributes->>'hoofdgroep_omschrijving', '') as hoofdgroep,
      coalesce(nullif(p.variant_color_label, ''), p.attributes->>'kleur_omschrijving', '') as kleur,
      coalesce(p.attributes->>'materiaal', p.attributes->>'samenstelling_materiaal', '') as materiaal,
      coalesce(p.attributes->>'dessin', '') as dessin
    from products p
    where p.status = 'active' and p.in_stock = true and p.is_group_primary = true${imgCond}${hgCond}
    order by p.stock_qty desc nulls last
    limit ${count}
  `);
  console.log(`⏳ ${rows.rows.length} producten · model ${MODEL}${redo ? " · REDO (bestaande AI-beelden vervangen)" : ""}`);

  let ok = 0;
  for (const c of rows.rows) {
    console.log(`• ${c.handle} (${c.hoofdgroep || "?"} · ${c.kleur || "?"})`);
    const url = await generate(buildPrompt(c), key);
    if (!url) { console.log("   ✗ geen beeld"); continue; }
    // Uniek pad per generatie: overschrijven op hetzelfde blob-pad kan door
    // CDN-cache het oude beeld blijven tonen.
    const saved = await toBlob(url, `ai-packshots/${c.handle}-${Date.now().toString(36)}.jpg`, token);
    if (!saved) { console.log("   ✗ upload mislukt"); continue; }
    // Redo: oude AI-rijen eerst weg (nieuwe stijl vervangt, geen duplicaten).
    if (redo) {
      await db.execute(sql`delete from product_images where product_id = ${c.id}::uuid and source = 'ai-packshot'`);
    }
    // Her-check bij insert: kreeg het product ondertussen (import-run) échte
    // foto's, dan slaan we de AI-rij over — echte foto's winnen altijd.
    const ins = await db.execute<{ id: string }>(sql`
      insert into product_images (product_id, url, alt, position, source)
      select ${c.id}::uuid, ${saved}, ${`${c.title} — beeld ter indicatie`}, 0, 'ai-packshot'
      where not exists (select 1 from product_images where product_id = ${c.id}::uuid and source = '')
      returning id
    `);
    if (!ins.rows.length) { console.log("   ↷ overgeslagen (kreeg intussen echte foto's)"); continue; }
    await db.update(products).set({ hasImage: true }).where(eq(products.id, c.id));
    ok++;
    console.log(`   ✓ ${saved}`);
  }
  console.log(`\n✓ Klaar: ${ok}/${rows.rows.length} gelukt.`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
