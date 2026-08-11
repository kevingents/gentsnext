import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { CATEGORIES, categoryBySlug } from "@/lib/categories";
import { getCollectionByHandle, getFilteredProducts, listCollections } from "@/lib/catalog";
import { getMerchandisingPins, type PinContextKind } from "@/lib/merchandising";
import {
  getAlleRegels,
  setRegels,
  valideerRegels,
  vandaagNl,
  VELD_LABELS,
  MAX_REGELS,
  type MerchRegel,
} from "@/lib/merchandising-regels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Portal-"Nieuwe site" → Merchandising → Regels.
 *
 * GET  → { regels, velden, contexten, vandaag }
 *        `velden` = de échte waarden die in de catalogus voorkomen, mét telling.
 *        Zo kiest de beheerder uit een lijst i.p.v. een jaartal of seizoen in te
 *        typen dat nergens op slaat — een regel die niets raakt is onzichtbaar
 *        kapot, en dat is precies het soort fout dat je hier niet wil.
 * POST → { actie: "opslaan", regels[] }   → slaat de volledige set op.
 *        { actie: "voorbeeld", context, regels[] } → de eerste 12 producten zoals
 *        ze met díé regels zouden staan, náást de huidige volgorde. Voorbeeld
 *        slaat niets op en negeert de looptijd (anders kun je een seizoensregel
 *        die in september ingaat nooit vooraf controleren); regels buiten hun
 *        venster komen terug in `buitenVenster`.
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */

type Voorbeeldproduct = { handle: string; title: string; image: string; positieNu: number | null };

/** Splitst "categorie:pakken" → {kind, slug}; "*" → null (hele site). */
function ontleedContext(context: string): { kind: PinContextKind; slug: string } | null {
  const s = String(context || "*").trim().toLowerCase();
  if (!s || s === "*") return null;
  const [kind, ...rest] = s.split(":");
  const slug = rest.join(":").trim();
  if (!slug) return null;
  if (kind === "categorie" || kind === "collection") return { kind, slug };
  return null;
}

/** Filters voor een context. Null = de hele catalogus (contextloze regel). */
async function filtersVoorContext(ctx: { kind: PinContextKind; slug: string } | null) {
  if (!ctx) return {};
  if (ctx.kind === "categorie") {
    const cat = categoryBySlug(ctx.slug);
    return cat ? { category: cat.hoofdgroep } : {};
  }
  const col = await getCollectionByHandle(ctx.slug);
  return col ? { collectionId: col.id } : {};
}

export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const db = getDb();
    const [regels, collections, waarden] = await Promise.all([
      getAlleRegels(),
      listCollections(),
      // Alleen actieve producten met foto: waar de regels ook op werken.
      db.execute<{ veld: string; waarde: string; n: number }>(sql`
        with zichtbaar as materialized (
          select id, attributes, vendor from products
          where status = 'active' and has_image = true
        )
        select 'jaar' as veld, attributes->>'jaar' as waarde, count(*)::int as n from zichtbaar
          where coalesce(attributes->>'jaar','') <> '' group by 2
        union all select 'seizoen', attributes->>'seizoen', count(*)::int from zichtbaar
          where coalesce(attributes->>'seizoen','') <> '' group by 2
        union all select 'hoofdgroep', attributes->>'hoofdgroep_omschrijving', count(*)::int from zichtbaar
          where coalesce(attributes->>'hoofdgroep_omschrijving','') <> '' group by 2
        union all select 'subgroep', attributes->>'subgroep', count(*)::int from zichtbaar
          where coalesce(attributes->>'subgroep','') <> '' group by 2
        union all select 'merk', coalesce(nullif(attributes->>'merk',''), vendor), count(*)::int from zichtbaar
          where coalesce(nullif(attributes->>'merk',''), vendor, '') <> '' group by 2
        union all select 'materiaal', attributes->>'materiaal', count(*)::int from zichtbaar
          where coalesce(attributes->>'materiaal','') <> '' group by 2
        union all select 'pasvorm', attributes->>'pasvorm', count(*)::int from zichtbaar
          where coalesce(attributes->>'pasvorm','') <> '' group by 2
        union all select 'kleur', v.color_family, count(distinct v.product_id)::int from product_variants v
          join zichtbaar z on z.id = v.product_id where coalesce(v.color_family,'') <> '' group by 2
        union all select 'collectie', c.handle, count(*)::int from product_collections pc
          join collections c on c.id = pc.collection_id
          join zichtbaar z on z.id = pc.product_id group by 2
      `),
    ]);

    const velden: Record<string, { waarde: string; n: number }[]> = {};
    for (const r of waarden.rows) {
      if (!r.waarde) continue;
      (velden[r.veld] ||= []).push({ waarde: r.waarde, n: Number(r.n) || 0 });
    }
    for (const k of Object.keys(velden)) {
      velden[k].sort((a, b) => b.n - a.n || a.waarde.localeCompare(b.waarde));
    }

    const vandaag = vandaagNl();
    return NextResponse.json({
      ok: true,
      vandaag,
      maxRegels: MAX_REGELS,
      veldLabels: VELD_LABELS,
      // Per regel meesturen of 'ie vandaag daadwerkelijk meedoet — "actief" en
      // "telt nu mee" zijn niet hetzelfde zodra er een looptijd op zit.
      regels: regels.map((r) => ({ ...r, teltNuMee: r.actief && !buitenVenster(r, vandaag) })),
      contexten: [
        { key: "*", label: "Hele site" },
        ...CATEGORIES.map((c) => ({ key: `categorie:${c.slug}`, label: `Categorie — ${c.label}` })),
        ...collections.map((c) => ({ key: `collection:${c.handle}`, label: `Collectie — ${c.title}` })),
      ],
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

function buitenVenster(r: MerchRegel, vandaag: string): boolean {
  return Boolean((r.vanaf && vandaag < r.vanaf) || (r.tot && vandaag > r.tot));
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { actie?: string; regels?: unknown; context?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  if (body.actie === "voorbeeld") {
    try {
      const ctx = ontleedContext(String(body.context || "*"));
      const filters = await filtersVoorContext(ctx);
      // Regels valideren via dezelfde weg als opslaan, maar zónder te bewaren:
      // een voorbeeld mag nooit de live-set aanraken.
      const kandidaten = Array.isArray(body.regels) ? body.regels : [];
      const geldig = valideerRegels(kandidaten);
      const vandaag = vandaagNl();

      const pinnedHandles = ctx ? await getMerchandisingPins(ctx.kind, ctx.slug) : [];
      const [nu, straks] = await Promise.all([
        getFilteredProducts(filters, "aanbevolen", 1, 12, { pinnedHandles }),
        getFilteredProducts(filters, "aanbevolen", 1, 12, { pinnedHandles, regels: geldig.filter((r) => r.actief) }),
      ]);
      const posNu = new Map(nu.items.map((p, i) => [p.handle, i + 1]));
      const voorbeeld: Voorbeeldproduct[] = straks.items.map((p) => ({
        handle: p.handle,
        title: p.title,
        image: p.imageUrl || "",
        positieNu: posNu.get(p.handle) ?? null,
      }));
      return NextResponse.json({
        ok: true,
        totaal: straks.total,
        voorbeeld,
        huidig: nu.items.map((p) => ({ handle: p.handle, title: p.title, image: p.imageUrl || "" })),
        buitenVenster: geldig.filter((r) => buitenVenster(r, vandaag)).map((r) => r.id),
        genegeerd: kandidaten.length - geldig.length,
      });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  if (body.actie && body.actie !== "opslaan") {
    return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
  }

  try {
    const opgeslagen = await setRegels(Array.isArray(body.regels) ? body.regels : []);
    const aangeboden = Array.isArray(body.regels) ? body.regels.length : 0;
    return NextResponse.json({
      ok: true,
      regels: opgeslagen,
      // Stil wegvallen is hier het gevaar: een regel zonder waarden of met een
      // onzinnige operator wordt geweigerd. Zeg dat, in plaats van "opgeslagen".
      genegeerd: Math.max(0, aangeboden - opgeslagen.length),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
