import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { normPath, type Redirect } from "@/lib/redirects";

/**
 * Schrijfkant van de beheerbare redirects, voor de Site-studio
 * (/account/redirects). lib/redirects.ts is bewust EDGE-SAFE en alleen-lezen
 * (middleware, 30s cache) — dit is de Node-kant: altijd een VERSE lees (de
 * beheerder moet direct zien wat er staat) plus upsert op dezelfde bron:
 * app_settings-rij `redirects`, vorm `{ list: [{ source, target, status, active }] }`.
 */

const ID = "redirects";

/** Verse lijst uit de database (bewust ongecachet). */
export async function listRedirects(): Promise<Redirect[]> {
  const db = getDb();
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, ID)).limit(1);
  const list = (rows[0]?.data as { list?: Redirect[] } | undefined)?.list;
  return Array.isArray(list) ? list : [];
}

async function writeRedirects(list: Redirect[]): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ id: ID, data: { list }, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: { list }, updatedAt: sql`now()` } });
}

/** Bron mag een wildcard-staart houden (`/oud/*`); de rest normaliseren we. */
function cleanSource(raw: string): string {
  const s = String(raw || "").trim();
  const wild = /\/\*+$/.test(s);
  const base = normPath(s.replace(/\/\*+$/, ""));
  return wild ? `${base === "/" ? "" : base}/*` : base;
}

/** Doel mag een volledige URL zijn (externe site) of een intern pad, eventueel met wildcard. */
function cleanTarget(raw: string): string {
  const t = String(raw || "").trim();
  if (/^https?:\/\//i.test(t)) return t.slice(0, 400);
  const wild = /\/\*+$/.test(t);
  const base = normPath(t.replace(/\/\*+$/, ""));
  return wild ? `${base === "/" ? "" : base}/*` : base;
}

const isWildcard = (s: string) => /\/\*+$/.test(String(s || ""));
const isExternal = (s: string) => /^https?:\/\//i.test(String(s || "").trim());

export type RedirectInput = {
  source: string;
  target: string;
  status?: number;
  active?: boolean;
  /** Bij bewerken: de bron zoals die nu is opgeslagen (maakt hernoemen mogelijk). */
  originalSource?: string;
  /**
   * "create" weigert een bron die al een regel heeft (knop "Nieuwe redirect" in de
   * Site-studio). Standaard blijft het gedrag upsert, want het portal-endpoint
   * werkt bestaande regels bij door ze simpelweg opnieuw op te sturen.
   */
  mode?: "create" | "upsert";
};

/**
 * Voegt toe of werkt bij (sleutel = bron). Gooit een Error met een
 * Nederlandse melding als de invoer niet klopt; de route vertaalt dat naar 400.
 */
export async function upsertRedirect(input: RedirectInput): Promise<Redirect[]> {
  const source = cleanSource(input.source);
  if (!source || source === "/" || source === "/*") {
    throw new Error("Vul een geldig bron-pad in, bijvoorbeeld /oude-pagina of /oude-map/*.");
  }
  // Bewust op de RUWE invoer: normPath("") geeft "/", dus een leeg doel zou hierna
  // ongemerkt een actieve 301 naar de homepage worden.
  if (!String(input.target ?? "").trim()) {
    throw new Error("Vul een doel in: een pad (/nieuwe-pagina) of een volledige URL.");
  }
  const target = cleanTarget(input.target);
  if (!target || target === "/*") throw new Error("Vul een doel in: een pad (/nieuwe-pagina) of een volledige URL.");
  if (target === source) throw new Error("Bron en doel zijn hetzelfde — dat levert een oneindige lus op.");
  // Wildcard-bron: matchRedirect matcht een wildcard óók op het prefix zelf
  // (`p === prefix || p.startsWith(prefix + "/")`), dus een doel dat binnen de
  // eigen bron valt stuurt de bezoeker eindeloos naar zichzelf terug.
  if (isWildcard(source) && !isExternal(target)) {
    const prefix = source.replace(/\/\*+$/, "");
    const targetBase = target.replace(/\/\*+$/, "");
    if (targetBase === prefix || targetBase.startsWith(prefix + "/")) {
      throw new Error(
        `Doel ${target} valt zelf onder ${source} — dat levert een oneindige lus op. Kies een doel buiten ${prefix}.`,
      );
    }
  }

  const entry: Redirect = {
    source,
    target,
    status: Number(input.status) === 302 ? 302 : 301,
    active: input.active === undefined ? true : Boolean(input.active),
  };

  const list = await listRedirects();
  const original = input.originalSource ? cleanSource(input.originalSource) : "";

  // Hernoemen: de oude regel verdwijnt, de nieuwe komt op dezelfde plek terug.
  if (original && original !== source) {
    const oldIdx = list.findIndex((r) => cleanSource(r.source) === original);
    if (list.some((r) => cleanSource(r.source) === source)) {
      throw new Error(`Er bestaat al een regel voor ${source}.`);
    }
    if (oldIdx >= 0) list[oldIdx] = entry;
    else list.push(entry);
  } else {
    const idx = list.findIndex((r) => cleanSource(r.source) === source);
    // Nieuwe regel op een bron die al bezet is: niet stil overschrijven. In een
    // gesorteerde, gefilterde tabel ziet de beheerder de bestaande regel niet staan.
    if (idx >= 0 && input.mode === "create") {
      throw new Error(`Er bestaat al een regel voor ${source}.`);
    }
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
  }

  await writeRedirects(list);
  return list;
}

export async function deleteRedirect(source: string): Promise<Redirect[]> {
  const key = cleanSource(source);
  const list = (await listRedirects()).filter((r) => cleanSource(r.source) !== key);
  await writeRedirects(list);
  return list;
}

/** Aan/uit zonder de rest van de regel aan te raken. */
export async function setRedirectActive(source: string, active: boolean): Promise<Redirect[]> {
  const key = cleanSource(source);
  const list = await listRedirects();
  const idx = list.findIndex((r) => cleanSource(r.source) === key);
  if (idx < 0) throw new Error("Deze redirect bestaat niet (meer).");
  list[idx] = { ...list[idx], active: Boolean(active) };
  await writeRedirects(list);
  return list;
}
