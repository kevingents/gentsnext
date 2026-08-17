import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { leesCsv, leesXlsx } from "@/lib/xlsx-lezen";
import {
  controleerTabel,
  leesMaatblad,
  sorteerBevindingen,
  type Bevinding,
  type MaatRij,
} from "@/lib/maattabel-regels";
import {
  actieveVersie,
  activeerVersie,
  alleVersies,
  bewaarVersie,
  keurContext,
  rijenVanVersie,
} from "@/lib/maattabel";
import { builtInChart } from "@/lib/size-chart";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Een maatblad is kilobytes. 5 MB is al absurd ruim en houdt onzin buiten. */
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * De maattabel voor de portal (Site → Maten).
 *
 * GET  → de actieve tabel, de keuring erop, en de versiehistorie.
 *        ?versie=<n> bekijkt een specifieke versie (om te zien wat je terugzet).
 * POST → multipart met `bestand`: inlezen + keuren + opslaan als NIEUWE versie,
 *        standaard NIET actief. Dat is met opzet twee stappen: deze tabel bepaalt
 *        wat het maatadvies aan iedere bezoeker adviseert, dus je hoort de
 *        bevindingen te zien vóórdat hij live gaat.
 *        JSON { actie: "activeer", versieId } zet een versie live (of terug).
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const gevraagdeVersie = Number(url.searchParams.get("versie") || 0);

    /* De versietabellen bestaan pas ná drizzle/0059. Tot die tijd (en als de DB
       hapert) hoort dit scherm de tabel te tonen waar de site écht op draait —
       de ingebakken fallback — in plaats van een foutmelding. `migratieNodig`
       vertelt de portal waarom er geen historie is. */
    let versies: Awaited<ReturnType<typeof alleVersies>> = [];
    let actief: Awaited<ReturnType<typeof actieveVersie>> = null;
    let migratieNodig = false;
    try {
      [versies, actief] = await Promise.all([alleVersies(), actieveVersie()]);
    } catch (e) {
      migratieNodig = true;
      console.error("[studio/maten] versies onleesbaar (migratie 0059 gedraaid?):", e);
    }

    const tonen = gevraagdeVersie
      ? versies.find((v) => v.versie === gevraagdeVersie) ?? null
      : actief;

    // Zonder geüploade versie draait de site op de tabel in code. Die tonen we
    // ook, met versie 0 — anders lijkt het scherm leeg terwijl de site het
    // gewoon doet, en dat is de verkeerde boodschap.
    let rijen: MaatRij[];
    if (tonen) {
      rijen = await rijenVanVersie(tonen.id);
    } else {
      rijen = ingebakkenAlsRijen();
    }

    const bevindingen = sorteerBevindingen(controleerTabel(rijen, await keurContext()));

    return NextResponse.json({
      ok: true,
      /** true = drizzle/0059 staat nog niet op de database; uploaden kan nog niet. */
      migratieNodig,
      /** null = er is nog niets geüpload; de site draait op de tabel in code. */
      actief: actief,
      toont: tonen ? { versie: tonen.versie, bestandsnaam: tonen.bestandsnaam, actor: tonen.actor, createdAt: tonen.createdAt, aantalRijen: tonen.aantalRijen, notitie: tonen.notitie, actief: tonen.actief } : { versie: 0, bestandsnaam: "ingebakken in code", actor: "", createdAt: "", aantalRijen: rijen.length, notitie: "lib/size-chart.ts — de fallback", actief: !actief },
      rijen,
      bevindingen,
      versies,
    });
  } catch (e) {
    console.error("[studio/maten] GET-fout:", e);
    return NextResponse.json({ ok: false, error: "Kon de maattabel niet lezen." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  const type = req.headers.get("content-type") || "";

  /* ── Versie activeren of terugzetten ───────────────────────────────── */
  if (!type.includes("multipart/form-data")) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
    }
    if (body.actie !== "activeer") {
      return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
    }
    const versieId = String(body.versieId || "").trim();
    if (!versieId) return NextResponse.json({ ok: false, error: "Geen versie opgegeven." }, { status: 400 });

    try {
      // Weigeren om een versie te activeren die de keuring niet haalt: een
      // maattabel zonder colbertrijen laat het maatadvies stilletjes niets meer
      // adviseren, en dat merk je pas als een klant belt.
      const rijen = await rijenVanVersie(versieId);
      if (!rijen.length) {
        return NextResponse.json({ ok: false, error: "Deze versie heeft geen rijen." }, { status: 400 });
      }
      const fouten = controleerTabel(rijen, await keurContext(false)).filter((b) => b.ernst === "fout");
      if (fouten.length) {
        return NextResponse.json(
          { ok: false, error: "Deze versie haalt de keuring niet.", bevindingen: fouten },
          { status: 422 },
        );
      }
      const actief = await activeerVersie(versieId);
      if (!actief) return NextResponse.json({ ok: false, error: "Versie niet gevonden." }, { status: 404 });
      return NextResponse.json({ ok: true, actief });
    } catch (e) {
      console.error("[studio/maten] activeren mislukt:", e);
      return NextResponse.json({ ok: false, error: "Activeren is niet gelukt." }, { status: 500 });
    }
  }

  /* ── Nieuw blad inlezen ─────────────────────────────────────────────── */
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Kon het formulier niet lezen." }, { status: 400 });
  }

  const bestand = form.get("bestand");
  if (!(bestand instanceof File)) {
    return NextResponse.json({ ok: false, error: "Geen bestand meegestuurd." }, { status: 400 });
  }
  if (bestand.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: "Dit bestand is te groot (max 5 MB)." }, { status: 413 });
  }
  const actor = String(form.get("actor") || "").trim();
  const notitie = String(form.get("notitie") || "").trim();
  // Standaard NIET activeren; de portal vraagt het los.
  const activeer = String(form.get("activeer") || "") === "1";

  const naam = bestand.name || "maatblad";
  let rijenRuw: string[][];
  let bladnaam = "";
  try {
    const bytes = Buffer.from(await bestand.arrayBuffer());
    if (/\.csv$/i.test(naam)) {
      rijenRuw = leesCsv(bytes.toString("utf8"));
      bladnaam = "csv";
    } else {
      const bladen = leesXlsx(bytes);
      // Het blad met de meeste rijen, niet blad 1: exports zetten er graag een
      // toelichting- of legenda-tabblad vóór.
      const beste = bladen.reduce((a, b) => (b.rijen.length > a.rijen.length ? b : a));
      rijenRuw = beste.rijen;
      bladnaam = beste.naam;
    }
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Kon dit bestand niet lezen." },
      { status: 400 },
    );
  }

  const { rijen, bevindingen: leesBevindingen } = leesMaatblad(rijenRuw);
  const bevindingen = sorteerBevindingen([
    ...leesBevindingen,
    ...(rijen.length ? controleerTabel(rijen, await keurContext()) : []),
  ]);
  const fouten = bevindingen.filter((b) => b.ernst === "fout");

  if (fouten.length) {
    // Niets opslaan: een blad dat de keuring niet haalt hoort niet in de
    // historie te belanden waar iemand hem later per ongeluk activeert.
    return NextResponse.json(
      { ok: false, error: "Dit blad is niet bruikbaar als maattabel.", bevindingen, bladnaam, aantalRijen: rijen.length },
      { status: 422 },
    );
  }

  try {
    const versie = await bewaarVersie({ rijen, bestandsnaam: naam, actor, notitie, activeer });
    return NextResponse.json({ ok: true, versie, rijen, bevindingen, bladnaam });
  } catch (e) {
    console.error("[studio/maten] opslaan mislukt:", e);
    return NextResponse.json({ ok: false, error: "Opslaan is niet gelukt." }, { status: 500 });
  }
}

/** De ingebakken tabel in de rijvorm van het scherm (versie 0). */
function ingebakkenAlsRijen(): MaatRij[] {
  const chart = builtInChart();
  const boordPerMaat = new Map(chart.boord.map((b) => [b.confectie, b.boordCm]));
  return chart.rows.map((r, i) => ({
    productType: r.productType,
    categorie: r.category,
    maat: r.size,
    boordCm: r.category === "Overhemden (Boordmaat)" ? (boordPerMaat.get(r.size) ?? "") : "",
    borstMin: r.chestMin,
    borstMax: r.chestMax,
    tailleMin: r.waistMin,
    tailleMax: r.waistMax,
    binnenbeenMin: r.innerLegMin,
    binnenbeenMax: r.innerLegMax,
    sortering: i,
  }));
}

export type MatenBevinding = Bevinding;
