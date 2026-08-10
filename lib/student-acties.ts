import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { studentActies, studentActieVerkopen, studentLeden } from "@/db/schema";

/**
 * lib/student-acties.ts — verenigingskorting aan de kassa.
 *
 * Kevin/Remy, 6 aug: Remy maakt in de portal een actie (vereniging + winkel(s) +
 * deelnemende producten + percentage). De winkel klikt 'm aan de kassa aan, scant,
 * en alleen de deelnemende producten krijgen korting. Een klant is verplicht en
 * wordt aan de vereniging gekoppeld, zodat Remy per vereniging ziet wie wat kocht.
 *
 * Twee dingen bewust zo:
 *  - "leeg = alles". Een lege winkel- of productlijst betekent ALLE winkels /
 *    ALLE producten. Dat is wat Remy in de praktijk het vaakst wil ("hele
 *    collectie, alle winkels") en scheelt hem het aanvinken van 19 winkels.
 *  - De KORTING WORDT SERVER-SIDE HERREKEND bij het registreren van een verkoop.
 *    De kassa rekent 'm ook uit (de kassier moet het bedrag zien), maar wat in de
 *    rapportage belandt komt uit dezelfde bron als de actie zelf.
 */

export type StudentActie = {
  id: string;
  naam: string;
  vereniging: string;
  winkels: string[];
  producten: string[];
  kortingPct: number;
  vanaf: string | null;
  tot: string | null;
  actief: boolean;
  aangemaaktDoor: string;
  createdAt: string;
};

const clean = (v: unknown) => String(v ?? "").trim();
const lower = (v: unknown) => clean(v).toLowerCase();
const lijst = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => clean(x)).filter(Boolean))] : [];

function toActie(r: typeof studentActies.$inferSelect): StudentActie {
  return {
    id: r.id,
    naam: r.naam,
    vereniging: r.vereniging,
    winkels: lijst(r.winkels),
    producten: lijst(r.producten),
    kortingPct: Number(r.kortingPct) || 0,
    vanaf: r.vanaf ? String(r.vanaf) : null,
    tot: r.tot ? String(r.tot) : null,
    actief: Boolean(r.actief),
    aangemaaktDoor: r.aangemaaktDoor || "",
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  };
}

/** Vandaag in Amsterdam-tijd als YYYY-MM-DD (de winkel werkt in lokale dagen). */
function vandaagNL(): string {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" });
  return f.format(new Date());
}

/** Loopt deze actie vandaag? (lege datum = geen grens aan die kant) */
export function looptVandaag(a: Pick<StudentActie, "actief" | "vanaf" | "tot">, dag = vandaagNL()): boolean {
  if (!a.actief) return false;
  if (a.vanaf && dag < a.vanaf) return false;
  if (a.tot && dag > a.tot) return false;
  return true;
}

/** Geldt deze actie in deze winkel? (lege winkellijst = alle winkels) */
export function geldtInWinkel(a: Pick<StudentActie, "winkels">, store: string): boolean {
  if (!a.winkels.length) return true;
  const s = lower(store);
  return a.winkels.some((w) => lower(w) === s);
}

/** Doet dit artikel mee? (lege productlijst = alles). Match op sku óf barcode. */
export function doetMee(a: Pick<StudentActie, "producten">, sku: string, barcode = ""): boolean {
  if (!a.producten.length) return true;
  const s = lower(sku), b = lower(barcode);
  return a.producten.some((p) => {
    const q = lower(p);
    return Boolean(q) && (q === s || (Boolean(b) && q === b));
  });
}

/* ── Beheer (portal) ─────────────────────────────────────────────────────── */

export async function listStudentActies(opts: { alleenLopend?: boolean; store?: string } = {}): Promise<StudentActie[]> {
  const db = getDb();
  const rows = await db.select().from(studentActies).orderBy(desc(studentActies.createdAt)).limit(500);
  let out = rows.map(toActie);
  if (opts.alleenLopend) out = out.filter((a) => looptVandaag(a));
  if (opts.store) out = out.filter((a) => geldtInWinkel(a, opts.store!));
  return out;
}

export async function getStudentActie(id: string): Promise<StudentActie | null> {
  const db = getDb();
  const [r] = await db.select().from(studentActies).where(eq(studentActies.id, clean(id))).limit(1);
  return r ? toActie(r) : null;
}

export type ActieInvoer = {
  naam?: string; vereniging?: string; winkels?: unknown; producten?: unknown;
  kortingPct?: unknown; vanaf?: string | null; tot?: string | null; actief?: unknown; aangemaaktDoor?: string;
};

/** Percentage begrenzen: 0-100, hele procenten. 0 = geen korting (dan heeft de actie geen zin). */
function pct(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
const datum = (v: unknown): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(clean(v)) ? clean(v) : null);

export async function saveStudentActie(id: string | null, input: ActieInvoer): Promise<{ ok: boolean; actie?: StudentActie; error?: string }> {
  const naam = clean(input.naam).slice(0, 120);
  const vereniging = clean(input.vereniging).slice(0, 120);
  if (!naam) return { ok: false, error: "Geef de actie een naam." };
  if (!vereniging) return { ok: false, error: "Kies of typ een vereniging." };
  const kortingPct = pct(input.kortingPct);
  if (!kortingPct) return { ok: false, error: "Vul een kortingspercentage in (1-100)." };
  const vanaf = datum(input.vanaf);
  const tot = datum(input.tot);
  if (vanaf && tot && tot < vanaf) return { ok: false, error: "De einddatum ligt vóór de startdatum." };

  const waarden = {
    naam, vereniging,
    winkels: lijst(input.winkels),
    producten: lijst(input.producten),
    kortingPct,
    vanaf, tot,
    actief: input.actief == null ? true : Boolean(input.actief),
    aangemaaktDoor: clean(input.aangemaaktDoor).slice(0, 80),
    updatedAt: new Date(),
  };

  const db = getDb();
  if (clean(id)) {
    const [r] = await db.update(studentActies).set(waarden).where(eq(studentActies.id, clean(id))).returning();
    return r ? { ok: true, actie: toActie(r) } : { ok: false, error: "Actie niet gevonden." };
  }
  const [r] = await db.insert(studentActies).values(waarden).returning();
  return { ok: true, actie: toActie(r) };
}

export async function setStudentActieActief(id: string, actief: boolean): Promise<{ ok: boolean }> {
  const db = getDb();
  await db.update(studentActies).set({ actief, updatedAt: new Date() }).where(eq(studentActies.id, clean(id)));
  return { ok: true };
}

/* ── Verkoop registreren (kassa) ──────────────────────────────────────────── */

export type VerkoopRegel = { sku?: string; barcode?: string; title?: string; qty?: number; priceCent?: number };

/**
 * Verkoop onder een actie vastleggen. Rekent de korting ZELF uit op basis van de
 * actie in de database — niet op wat de kassa meestuurt. Idempotent op saleId:
 * een herhaalde melding (retry, dubbele klik) telt niet dubbel.
 */
export async function registreerStudentVerkoop(input: {
  actieId: string; store: string; saleId: string;
  klantNaam?: string; klantEmail?: string; klantId?: string; kassier?: string;
  regels: VerkoopRegel[];
}): Promise<{ ok: boolean; kortingCent?: number; omzetCent?: number; error?: string; deduped?: boolean }> {
  const actie = await getStudentActie(input.actieId);
  if (!actie) return { ok: false, error: "Actie niet gevonden." };
  const store = clean(input.store);
  if (!geldtInWinkel(actie, store)) return { ok: false, error: `Deze actie geldt niet voor ${store}.` };

  /* SERVER IS AUTORITATIEF (review 6 aug). Deze twee regels leefden alleen in de
     kassa-UI, en dit endpoint accepteerde alles wat er binnenkwam. Een verlopen
     of uitgezette actie kon dus alsnog omzet in Remy's overzicht zetten, en een
     bon zonder klant kon geregistreerd worden terwijl de hele afspraak is dat de
     klant aan de vereniging gekoppeld wordt. Een geparkeerde bon die dagen later
     hervat wordt is precies zo'n geval. */
  if (!looptVandaag(actie)) {
    return { ok: false, error: `Actie "${actie.naam}" loopt niet meer (${actie.actief ? "buiten de periode" : "uitgezet"}).` };
  }
  if (!lower(input.klantEmail)) {
    return { ok: false, error: "Zonder klant met e-mailadres kan de verkoop niet aan de vereniging gekoppeld worden." };
  }

  let kortingCent = 0;
  let omzetCent = 0;
  const regels = (Array.isArray(input.regels) ? input.regels : []).map((l) => {
    const qty = Math.max(1, Math.round(Number(l.qty) || 1));
    const priceCent = Math.max(0, Math.round(Number(l.priceCent) || 0));
    const meedoen = doetMee(actie, clean(l.sku), clean(l.barcode));
    const regelCent = priceCent * qty;
    const korting = meedoen ? Math.round((regelCent * actie.kortingPct) / 100) : 0;
    kortingCent += korting;
    omzetCent += regelCent - korting;
    return { sku: clean(l.sku), title: clean(l.title), qty, priceCent, kortingCent: korting, meedoen };
  });

  const db = getDb();
  const rows = await db
    .insert(studentActieVerkopen)
    .values({
      actieId: actie.id, actieNaam: actie.naam, vereniging: actie.vereniging, store,
      saleId: clean(input.saleId),
      klantNaam: clean(input.klantNaam), klantEmail: lower(input.klantEmail), klantId: clean(input.klantId),
      regels, kortingCent, omzetCent, kassier: clean(input.kassier),
    })
    .onConflictDoNothing({ target: studentActieVerkopen.saleId })
    .returning();

  /* Klant aan de vereniging koppelen. Blijft bij de EERSTE vereniging: iemand die
     later bij een andere actie koopt, wordt niet stil overgezet — dat zou Remy's
     ledenoverzicht laten schuiven zonder dat iemand daarom vroeg. */
  const email = lower(input.klantEmail);
  if (email) {
    await db
      .insert(studentLeden)
      .values({ klantEmail: email, klantNaam: clean(input.klantNaam), klantId: clean(input.klantId), vereniging: actie.vereniging, bronActieId: actie.id })
      .onConflictDoUpdate({
        target: studentLeden.klantEmail,
        set: { klantNaam: sql`case when excluded.klant_naam <> '' then excluded.klant_naam else ${studentLeden.klantNaam} end`, updatedAt: new Date() },
      })
      .catch(() => null);
  }

  return { ok: true, kortingCent, omzetCent, deduped: rows.length === 0 };
}

/* ── Rapportage (portal) ──────────────────────────────────────────────────── */

export async function listStudentVerkopen(opts: { actieId?: string; vereniging?: string; limit?: number } = {}) {
  const db = getDb();
  const lim = Math.max(1, Math.min(500, Number(opts.limit) || 200));
  const waar = opts.actieId
    ? eq(studentActieVerkopen.actieId, clean(opts.actieId))
    : opts.vereniging
      ? eq(studentActieVerkopen.vereniging, clean(opts.vereniging))
      : undefined;
  const q = db.select().from(studentActieVerkopen).orderBy(desc(studentActieVerkopen.createdAt)).limit(lim);
  const rows = waar ? await q.where(waar) : await q;
  return rows.map((r) => ({
    id: r.id, actieId: r.actieId, actieNaam: r.actieNaam, vereniging: r.vereniging, store: r.store,
    saleId: r.saleId, klantNaam: r.klantNaam, klantEmail: r.klantEmail,
    regels: r.regels, kortingCent: r.kortingCent, omzetCent: r.omzetCent, kassier: r.kassier,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

/** Totalen per actie — waar Remy als eerste naar kijkt. */
export async function studentActieTotalen(): Promise<Record<string, { bonnen: number; omzetCent: number; kortingCent: number; klanten: number }>> {
  const db = getDb();
  const rows = await db
    .select({
      actieId: studentActieVerkopen.actieId,
      bonnen: sql<number>`count(*)::int`,
      omzetCent: sql<number>`coalesce(sum(${studentActieVerkopen.omzetCent}), 0)::int`,
      kortingCent: sql<number>`coalesce(sum(${studentActieVerkopen.kortingCent}), 0)::int`,
      klanten: sql<number>`count(distinct nullif(${studentActieVerkopen.klantEmail}, ''))::int`,
    })
    .from(studentActieVerkopen)
    .groupBy(studentActieVerkopen.actieId);
  const out: Record<string, { bonnen: number; omzetCent: number; kortingCent: number; klanten: number }> = {};
  for (const r of rows) out[r.actieId] = { bonnen: r.bonnen, omzetCent: r.omzetCent, kortingCent: r.kortingCent, klanten: r.klanten };
  return out;
}

/** Leden per vereniging (Remy: "deze klant is dan ook gekoppeld aan de vereniging"). */
export async function listStudentLeden(vereniging?: string) {
  const db = getDb();
  const q = db.select().from(studentLeden).orderBy(desc(studentLeden.createdAt)).limit(1000);
  const rows = clean(vereniging) ? await q.where(eq(studentLeden.vereniging, clean(vereniging))) : await q;
  return rows.map((r) => ({
    klantEmail: r.klantEmail, klantNaam: r.klantNaam, klantId: r.klantId, vereniging: r.vereniging,
    sinds: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
  }));
}

/** Alle verenigingen die al ergens gebruikt zijn — vult de keuzelijst in de portal. */
export async function listVerenigingen(): Promise<string[]> {
  const db = getDb();
  const a = await db.selectDistinct({ v: studentActies.vereniging }).from(studentActies);
  const l = await db.selectDistinct({ v: studentLeden.vereniging }).from(studentLeden);
  return [...new Set([...a, ...l].map((r) => clean(r.v)).filter(Boolean))].sort((x, y) => x.localeCompare(y, "nl"));
}
