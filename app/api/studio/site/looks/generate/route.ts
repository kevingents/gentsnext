import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getSuitPieceHandles } from "@/lib/suit-pairing";
import { saveLook, type StoredLook, type Hotspot } from "@/lib/looks";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/studio/site/looks/generate — stelt automatisch een CONCEPT-look samen
 * uit de eigen catalogus en zet 'm als 'draft' in de looks-store (ter goedkeuring).
 *
 * Slim (met ANTHROPIC_API_KEY/OPENAI_API_KEY): Claude kiest uit de in-stock
 * producten een coherente outfit (met GENTS-stijlregels) + schrijft titel/verhaal.
 * Zonder sleutel: heuristisch (in-stock colbert/pak + suit-pairing).
 * Auth: admin/STUDIO_API_TOKEN.  Body: { occasion?, theme?, offset? }
 */
const SHOE_BY_OCCASION: Record<string, string> = { Gala: "lakschoen", Uitvaart: "veterschoen-glad-zwart" };
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

type Cand = { handle: string; title: string; hg: string; img: string };

async function getCandidates(db: ReturnType<typeof getDb>): Promise<Cand[]> {
  const rows = await db.execute<{ handle: string; title: string; hg: string; img: string; rn: number }>(sql`
    select handle, title, attributes->>'hoofdgroep_omschrijving' as hg, model_image_url as img,
           row_number() over (partition by attributes->>'hoofdgroep_omschrijving' order by stock_qty desc) as rn
    from products
    where status='active' and has_image=true and in_stock=true and is_group_primary=true
      and attributes->>'hoofdgroep_omschrijving' in ('Colberts','Pakken','Overhemden','Schoenen','Stropdassen','Gilets','Broeken')
  `);
  return rows.rows.filter((r) => Number(r.rn) <= 8).map((r) => ({ handle: r.handle, title: r.title, hg: r.hg || "", img: r.img || "" }));
}

type AiPick = { colbert?: string; broek?: string; overhemd?: string; schoen?: string; gilet?: string; accessoire?: string; title?: string; subtitle?: string; story?: string };

async function aiPick(occasion: string, theme: string, cands: Cand[]): Promise<AiPick | null> {
  const anth = process.env.ANTHROPIC_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  if (!anth && !oai) return null;
  const list = cands.map((c) => `${c.handle} | ${c.hg} | ${c.title}`).join("\n");
  const sys =
    "Je bent een GENTS-stylist (Nederlands herenmode, formele momenten). Stel één coherente, verkoopbare outfit samen voor de gelegenheid, ALLEEN uit de aangeleverde producten — gebruik exact de gegeven handles, verzin niets. " +
    "Stijlregels: warme/gekleurde pakken (bruin/groen/zand/bordeaux/blauwtinten) → cognac/bruine schoenen, nooit zwart; alleen zwart/antraciet/black-tie → zwarte of lakschoenen. Onder een pak altijd een wit overhemd met kraag, nooit een T-shirt. Een gilet hoort bij hetzelfde pak/dezelfde stof. " +
    'Geef UITSLUITEND JSON: {"colbert":handle,"broek":handle,"overhemd":handle,"schoen":handle,"gilet":handle,"accessoire":handle,"title":"","subtitle":"","story":""}. Laat gilet/accessoire weg als er niets past. Titel kort, subtitel 1 zin, verhaal 2-3 zinnen in verzorgde toon.';
  const user = `Gelegenheid: ${occasion}${theme ? ` (thema: ${theme})` : ""}\n\nProducten (handle | categorie | titel):\n${list}`;
  const model = process.env.CONTENT_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001";
  try {
    let text = "";
    if (anth) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anth, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({ model, max_tokens: 1200, system: sys, messages: [{ role: "user", content: user }] }),
      });
      if (!r.ok) return null;
      text = (await r.json())?.content?.[0]?.text || "";
    } else {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${oai}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-4o-mini", temperature: 0.4, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
      });
      if (!r.ok) return null;
      text = (await r.json())?.choices?.[0]?.message?.content || "";
    }
    const m = text.match(/\{[\s\S]*\}/);
    return m ? (JSON.parse(m[0]) as AiPick) : null;
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { occasion?: string; theme?: string; offset?: number };
  try {
    body = (await req.json()) as { occasion?: string; theme?: string; offset?: number };
  } catch {
    body = {};
  }
  const occasion = String(body.occasion || "Zakelijk").trim();
  const theme = String(body.theme || "").trim();
  const offset = Math.max(0, Math.min(100, Math.round(Number(body.offset) || 0)));

  try {
    const db = getDb();
    const cands = await getCandidates(db);
    const byHandle = new Map(cands.map((c) => [c.handle, c]));
    let look: StoredLook | null = null;
    let usedAi = false;

    // 1) Slim: laat Claude/OpenAI een coherente outfit kiezen uit de candidates.
    const ai = await aiPick(occasion, theme, cands);
    const lead = ai?.colbert ? byHandle.get(ai.colbert) : undefined;
    if (ai && lead) {
      usedAi = true;
      const isPak = lead.hg.toLowerCase().includes("pak");
      const hotspots: Hotspot[] = [];
      const add = (handle: string | undefined, label: string, x: number, y: number) => {
        if (handle && byHandle.has(handle)) hotspots.push({ x, y, handle, label });
      };
      add(ai.overhemd, "Overhemd", 50, 22);
      add(ai.accessoire, "Accessoire", 55, 28);
      hotspots.push({ x: 50, y: isPak ? 40 : 34, handle: ai.colbert!, label: isPak ? "Pak" : "Colbert" });
      add(ai.gilet, "Gilet", 50, 48);
      add(ai.broek, "Pantalon", 50, 72);
      add(ai.schoen, "Schoenen", 50, 93);
      look = {
        slug: `ai-${slugify(occasion)}-${slugify(ai.colbert!).slice(0, 18)}`,
        title: (ai.title || `${occasion} look`).slice(0, 120),
        subtitle: (ai.subtitle || "").slice(0, 240),
        occasion,
        theme: theme || undefined,
        image: lead.img,
        hotspots,
        story: (ai.story || "").slice(0, 4000),
        status: "draft",
      };
    }

    // 2) Fallback: heuristisch (in-stock colbert/pak + suit-pairing).
    if (!look) {
      const baseRows = await db.execute<{ handle: string; title: string; model_image_url: string; hoofdgroep: string }>(sql`
        select handle, title, model_image_url, attributes->>'hoofdgroep_omschrijving' as hoofdgroep
        from products
        where status='active' and has_image=true and in_stock=true and is_group_primary=true
          and model_image_url <> '' and attributes->>'hoofdgroep_omschrijving' in ('Colberts','Pakken')
        order by stock_qty desc limit 1 offset ${offset}
      `);
      const p = baseRows.rows[0];
      if (!p) return NextResponse.json({ ok: false, error: "Geen geschikt product gevonden." }, { status: 404 });
      const isPak = (p.hoofdgroep || "").toLowerCase().includes("pak");
      const pieces = await getSuitPieceHandles(p.handle).catch(() => null);
      const hotspots: Hotspot[] = [
        { x: 50, y: 22, handle: "overhemd-nos-wit", label: "Overhemd" },
        { x: 50, y: isPak ? 40 : 34, handle: p.handle, label: isPak ? "Pak" : "Colbert" },
      ];
      if (pieces?.gilet) hotspots.push({ x: 50, y: 48, handle: pieces.gilet, label: "Gilet" });
      if (pieces?.broek) hotspots.push({ x: 50, y: 72, handle: pieces.broek, label: "Pantalon" });
      hotspots.push({ x: 50, y: 93, handle: SHOE_BY_OCCASION[occasion] || "leder-classic-cognac", label: "Schoenen" });
      look = {
        slug: `ai-${slugify(occasion)}-${slugify(p.handle).slice(0, 18)}`,
        title: `${occasion} look`,
        subtitle: `${occasion}${theme ? ` · ${theme}` : ""} — automatisch samengesteld, klaar om te beoordelen.`,
        occasion,
        theme: theme || undefined,
        image: p.model_image_url,
        hotspots,
        story: `Een complete ${occasion.toLowerCase()}-look rond ${p.title}. Mix & match: colbert, pantalon en gilet zijn los te combineren in dezelfde stof.`,
        status: "draft",
      };
    }

    await saveLook(look);
    return NextResponse.json({ ok: true, look, ai: usedAi });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
