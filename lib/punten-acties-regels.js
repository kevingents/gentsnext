/**
 * lib/punten-acties-regels.js
 *
 * De rekenregels van de eigen puntenacties ("koop dit, krijg extra punten"),
 * los van database en instellingen. Plain JS zodat `node --test` erbij kan —
 * zelfde opzet als lib/ab-regels.js. De DB-kant staat in lib/punten-acties.ts.
 *
 * Wat hier gebeurt is geldwerk: een vertypte actie deelt punten uit aan iedereen
 * die iets koopt. Vandaar plafonds op elke beloningssoort en tests op de wiskunde.
 */

/** Hoofdletter- en spatie-ongevoelig: de portal typt deze waarden met de hand. */
export function norm(s) {
  return String(s == null ? "" : s).trim().toLowerCase();
}

/** Lege lijst = "geen eis", dus alles matcht. Anders moet de waarde erin staan. */
export function bevat(lijst, waarde) {
  if (!Array.isArray(lijst) || lijst.length === 0) return true;
  return lijst.some((x) => norm(x) === norm(waarde));
}

/** Matcht één orderregel de voorwaarde van een actie? */
export function regelMatcht(regel, voorwaarde) {
  const v = voorwaarde || {};
  if (!bevat(v.hoofdgroepen, regel.hoofdgroep)) return false;
  if (!bevat(v.merken, regel.merk)) return false;
  if (Array.isArray(v.skus) && v.skus.length > 0) {
    if (!v.skus.some((s) => norm(s) === norm(regel.sku))) return false;
  }
  return true;
}

/**
 * Wat levert deze actie op voor deze orderregels? 0 = geen treffer.
 *
 * De drempel (minBestedingCents) telt over de MATCHENDE regels, niet over de
 * hele order: "besteed 200 aan pakken" hoort niet te slagen omdat er ook nog
 * voor 200 aan sokken in het mandje ligt.
 */
export function puntenVoorActie(actie, regels) {
  if (!actie || !Array.isArray(regels)) return 0;
  const raak = regels.filter((r) => regelMatcht(r, actie.voorwaarde));
  if (raak.length === 0) return 0;

  const bedrag = raak.reduce((n, r) => n + (Number(r.bedragCents) || 0), 0);
  const stuks = raak.reduce((n, r) => n + (Number(r.qty) || 0), 0);
  const drempel = Math.max(0, Math.round(Number(actie.voorwaarde?.minBestedingCents) || 0));
  if (drempel > 0 && bedrag < drempel) return 0;

  const b = actie.beloning || {};
  let punten = 0;
  if (b.soort === "per_euro") {
    // Hele euro's naar beneden, net als de gewone spaarsnelheid.
    punten = Math.floor(Math.floor(bedrag / 100) * (Math.max(0, Number(b.puntenPerEuro) || 0)));
  } else if (b.soort === "per_artikel") {
    punten = Math.floor(Math.max(0, Number(b.punten) || 0) * stuks);
  } else {
    punten = Math.max(0, Math.round(Number(b.punten) || 0));
  }

  const plafond = Math.max(0, Math.round(Number(actie.maxPerOrder) || 0));
  return plafond > 0 ? Math.min(punten, plafond) : punten;
}

/**
 * Loopt de actie op deze dag? Vergelijkt op de AMSTERDAMSE kalenderdag: met een
 * kale Date-vergelijking eindigt "tot 31 augustus" om middernacht UTC, en dat is
 * 02:00 in de winkel — de laatste avond van de actie zou dan misgaan.
 */
export function loopt(actie, op) {
  if (!actie || actie.actief === false) return false;
  const dag = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Amsterdam", dateStyle: "short" }).format(
    op instanceof Date && !Number.isNaN(op.getTime()) ? op : new Date(),
  );
  if (actie.van && dag < actie.van) return false;
  if (actie.tot && dag > actie.tot) return false;
  return true;
}

/* Kleine letters, cijfers en streepjes; begint met een letter of cijfer. Eén
   teken mag: "z" is een prima code voor een actie, en een stille ondergrens van
   twee tekens zou een geldige actie zonder uitleg weigeren. */
const SLUG = /^[a-z0-9][a-z0-9-]{0,48}$/;
const DATUM = /^\d{4}-\d{2}-\d{2}$/;

function klem(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

function lijst(x, max) {
  if (!Array.isArray(x)) return undefined;
  const uniek = [...new Set(x.map((s) => String(s).trim()).filter(Boolean))];
  return uniek.slice(0, max);
}

/**
 * Maakt portal-invoer schoon. Een actie zonder geldige code of naam valt af: de
 * code is de sleutel in het spaarpunten-grootboek, dus daar mag nooit iets raars
 * in belanden. Dubbele codes vallen ook af — anders vechten twee acties om
 * dezelfde grootboekregel en wint er stil één.
 *
 * Plafonds: 100.000 punten is bij de standaardkoers € 5.000 per order. Ver boven
 * elk reëel gebruik, en toch een dak op een vertypte actie.
 */
export function schoneActies(raw) {
  if (!Array.isArray(raw)) return [];
  const gezien = new Set();
  const out = [];

  for (const item of raw.slice(0, 50)) {
    const o = item || {};
    const slug = String(o.slug == null ? "" : o.slug).trim().toLowerCase();
    const naam = String(o.naam == null ? "" : o.naam).trim().slice(0, 80);
    if (!SLUG.test(slug) || !naam || gezien.has(slug)) continue;
    gezien.add(slug);

    const v = o.voorwaarde || {};
    const b = o.beloning || {};
    const soort = String(b.soort || "vast");
    const beloning =
      soort === "per_euro"
        ? { soort: "per_euro", puntenPerEuro: klem(b.puntenPerEuro, 0, 100) }
        : soort === "per_artikel"
          ? { soort: "per_artikel", punten: klem(b.punten, 0, 100000) }
          : { soort: "vast", punten: klem(b.punten, 0, 100000) };

    out.push({
      slug,
      naam,
      actief: o.actief !== false,
      van: DATUM.test(String(o.van || "")) ? String(o.van) : undefined,
      tot: DATUM.test(String(o.tot || "")) ? String(o.tot) : undefined,
      voorwaarde: {
        hoofdgroepen: lijst(v.hoofdgroepen, 20),
        skus: lijst(v.skus, 200),
        merken: lijst(v.merken, 20),
        minBestedingCents: Math.max(0, Math.round(Number(v.minBestedingCents) || 0)),
      },
      beloning,
      maxPerOrder: klem(o.maxPerOrder, 0, 100000),
    });
  }
  return out;
}
