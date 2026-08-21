import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { coreAuth } from "@/lib/store-core-token";
import { getDb } from "@/db";
import { vulUitPlu } from "@/lib/plu-artikelen";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/core/plu-import — StorePos-PLU-catalogus binnenhalen (auth: STORE_CORE_TOKEN).
 *
 * De kassa's uploaden om beurten (claim) de artikel-tabel uit hun lokale
 * StorePos-Postgres — de reserve-route voor de kapotte SRS-product-export.
 *
 *   claim  { host }            → { ok, mag }      wie mag vandaag uploaden
 *   batch  { rows: [...] }     → { ok, verwerkt } upsert in plu_catalog
 *   finish { host, rijen }     → { ok, totaal, preview } claim afronden + droogdraai-preview
 *   status {}                  → { ok, status, totaal }
 *   aanmaken { max?, echt? }   → { ok, resultaat } artikelen uit de PLU (default droogdraai)
 */

const clean = (v: unknown) => String(v ?? "").trim();

type Rij = Record<string, unknown>;

async function leesClaim(): Promise<{ dag: string; host: string; at: number; klaar: boolean } | null> {
  const r = await getDb().execute<{ data: { dag?: string; host?: string; at?: number; klaar?: boolean } }>(sql`
    select data from app_settings where id = 'plu-upload-claim' limit 1`);
  const d = r.rows[0]?.data;
  if (!d || !d.dag) return null;
  return { dag: String(d.dag), host: String(d.host || ""), at: Number(d.at) || 0, klaar: !!d.klaar };
}

async function schrijfSetting(id: string, data: unknown): Promise<void> {
  await getDb().execute(sql`
    insert into app_settings (id, data, updated_at) values (${id}, ${JSON.stringify(data)}::jsonb, now())
    on conflict (id) do update set data = excluded.data, updated_at = now()`);
}

export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; host?: string; rows?: Rij[]; rijen?: number; max?: number; echt?: boolean; fout?: string };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }
  const action = clean(b.action);
  const vandaag = new Date().toISOString().slice(0, 10);

  try {
    if (action === "claim") {
      /* Eén kassa per dag; een claim die na 2 uur nooit gefinisht is, is een
         gestrande upload — dan mag de volgende kassa het overnemen. */
      const c = await leesClaim();
      if (c && c.dag === vandaag && (c.klaar || Date.now() - c.at < 2 * 60 * 60 * 1000)) {
        return NextResponse.json({ ok: true, mag: false });
      }
      await schrijfSetting("plu-upload-claim", { dag: vandaag, host: clean(b.host), at: Date.now(), klaar: false });
      return NextResponse.json({ ok: true, mag: true });
    }

    if (action === "batch") {
      const rows = (Array.isArray(b.rows) ? b.rows : []).slice(0, 10000);
      if (!rows.length) return NextResponse.json({ ok: false, error: "Geen rijen." }, { status: 400 });
      const waarden = [];
      for (const r of rows) {
        const barcode = clean(r.barcode);
        if (!barcode || barcode.length > 20) continue;
        waarden.push(sql`(
          ${barcode}, ${clean(r.art_id).slice(0, 80)}, ${clean(r.art_nr).slice(0, 20)},
          ${clean(r.oms).slice(0, 120)}, ${clean(r.hoofdgroep).slice(0, 80)},
          ${clean(r.label1).slice(0, 80)}, ${clean(r.label2).slice(0, 80)}, ${clean(r.label3).slice(0, 80)},
          ${clean(r.leverancier_nr).slice(0, 80)}, ${clean(r.size_oms).slice(0, 80)}, ${clean(r.maatbalk).slice(0, 12)},
          ${Number.isFinite(Number(r.maatnr)) ? Math.round(Number(r.maatnr)) : null},
          ${clean(r.klr_id).slice(0, 20)}, ${clean(r.btwcode).slice(0, 20)},
          ${Math.round(Number(r.prijs) || 0)}, ${Math.round(Number(r.kostprijs) || 0)}, ${Math.round(Number(r.adviesprijs) || 0)},
          ${r.dropship === true || r.dropship === "t" || r.dropship === "true"}
        )`);
      }
      if (!waarden.length) return NextResponse.json({ ok: false, error: "Geen bruikbare rijen." }, { status: 400 });
      await getDb().execute(sql`
        insert into plu_catalog (
          barcode, art_id, art_nr, oms, hoofdgroep, label1, label2, label3,
          leverancier_nr, size_oms, maatbalk, maatnr, klr_id, btwcode,
          prijs_cents, kostprijs_cents, adviesprijs_cents, dropship
        )
        values ${sql.join(waarden, sql`, `)}
        on conflict (barcode) do update set
          art_id = excluded.art_id, art_nr = excluded.art_nr, oms = excluded.oms,
          hoofdgroep = excluded.hoofdgroep, label1 = excluded.label1, label2 = excluded.label2,
          label3 = excluded.label3, leverancier_nr = excluded.leverancier_nr,
          size_oms = excluded.size_oms, maatbalk = excluded.maatbalk, maatnr = excluded.maatnr,
          klr_id = excluded.klr_id, btwcode = excluded.btwcode,
          prijs_cents = excluded.prijs_cents, kostprijs_cents = excluded.kostprijs_cents,
          adviesprijs_cents = excluded.adviesprijs_cents, dropship = excluded.dropship,
          seen_at = now()`);
      return NextResponse.json({ ok: true, verwerkt: waarden.length });
    }

    if (action === "finish") {
      const totaal = Number(
        (await getDb().execute<{ n: number }>(sql`select count(*)::int n from plu_catalog`)).rows[0]?.n,
      ) || 0;
      await schrijfSetting("plu-upload-claim", { dag: vandaag, host: clean(b.host), at: Date.now(), klaar: true });
      /* Droogdraai-preview: wat ZOU de PLU aanmaken dat wij niet kennen? Gaat
         mee in de status zodat kantoor de mapping kan beoordelen vóór het
         echte aanmaken aangezet wordt. */
      const preview = await vulUitPlu({ droogdraaien: true, max: 50 });
      await schrijfSetting("plu-import-status", {
        at: new Date().toISOString(),
        ok: true,
        totaal,
        host: clean(b.host),
        gemeld: Number(b.rijen) || 0,
        preview: "error" in preview ? { error: preview.error } : { kandidaten: preview.kandidaten, voorbeeld: preview.producten.slice(0, 10) },
      });
      return NextResponse.json({ ok: true, totaal, preview });
    }

    if (action === "fout") {
      /* Kassa meldt waarom de upload afbrak (agent-fout, te kleine dump) — de
         stille variant kostte op 21-8 vijf uur zoeken. Alleen registreren; de
         claim blijft staan en verloopt vanzelf zodat een ander het overneemt. */
      await schrijfSetting("plu-upload-fout", { at: new Date().toISOString(), host: clean(b.host), fout: clean(b.fout).slice(0, 300) });
      console.warn(`[core/plu-import] upload-fout ${clean(b.host)}: ${clean(b.fout).slice(0, 200)}`);
      return NextResponse.json({ ok: true });
    }

    if (action === "status") {
      const s = await getDb().execute<{ data: unknown; updated_at: string }>(sql`
        select data, updated_at from app_settings where id = 'plu-import-status' limit 1`);
      const totaal = Number(
        (await getDb().execute<{ n: number }>(sql`select count(*)::int n from plu_catalog`)).rows[0]?.n,
      ) || 0;
      return NextResponse.json({ ok: true, status: s.rows[0]?.data ?? null, updatedAt: s.rows[0]?.updated_at ?? null, totaal });
    }

    if (action === "aanmaken") {
      /* `echt: true` = echt aanmaken; default droogdraaien (zie lib/plu-artikelen:
         de kolom-mapping is pas na inspectie van echte rijen te vertrouwen). */
      const resultaat = await vulUitPlu({ droogdraaien: b.echt !== true, max: Math.min(2000, Math.max(1, Number(b.max) || 200)) });
      return NextResponse.json({ ok: !("error" in resultaat), resultaat });
    }

    return NextResponse.json({ ok: false, error: `Onbekende actie "${action}".` }, { status: 400 });
  } catch (e) {
    console.error("[core/plu-import]", e);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
