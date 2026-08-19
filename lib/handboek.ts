import { HANDBOEK, type Deel, type Hoofdstuk } from "@/content/handboek";
import handboekIndex from "@/content/handboek-index.json";
import vercelConfig from "@/vercel.json";
import { getSettings, type Settings } from "@/lib/settings";
import { getReservationHoldMinutes } from "@/lib/reservation-config";
import { getReceivingConfig } from "@/lib/receiving-config";
import { getTransferRoutesConfig } from "@/lib/transfer-routes";
import { getStores } from "@/lib/stores";

/**
 * Het handboek samenstellen: verhaal (content/handboek) + LEVENDE getallen +
 * automatisch afgeleide lijsten (content/handboek-index, gemaakt bij elke build).
 *
 * WAAROM DIT ZO MOET. Een handboek veroudert op twee manieren, en allebei zijn ze
 * stil. Een getal dat in de tekst staat loopt uit de pas zodra iemand aan de knop
 * draait — dan noemt de handleiding € 4,99 retourkosten terwijl de winkel € 5,95
 * rekent, en dat merk je pas aan een klant met een schermafdruk. En een lijst van
 * wat er bestaat mist elke functie die er ná het schrijven bij kwam.
 *
 * Daarom: geen enkel bedrag, uur of drempel staat in de tekst. Er staat een
 * plaatshouder, en die wordt hier gevuld uit exact dezelfde bron waar de site zelf
 * mee rekent. Loopt het uit elkaar, dan is de site kapot — niet het handboek.
 *
 * Plaatshouders:
 *   {{knop.<pad>}}            een instelling (lib/settings), bv. knop.retailSafetyStock
 *   {{kaart.reserveringMinuten}}      de reserveringskaart
 *   {{kaart.ontvangst.<sleutel>}}     de ontvangst-/steekproefkaart
 *   {{kaart.ritten.<sleutel>}}        de rittenkaart
 * Optioneel met een opmaak: |euro |uur |pct |janee |aanuit
 */

export type HandboekHoofdstuk = { nr: string; titel: string; anker: string; html: string };
export type HandboekDeel = { id: string; rom: string; titel: string; intro: string; hoofdstukken: HandboekHoofdstuk[] };
export type Handboek = {
  delen: HandboekDeel[];
  stand: { delen: number; hoofdstukken: number; modules: number; endpoints: number; tabellen: number; taken: number };
};

type Kaarten = {
  reserveringMinuten: number;
  ontvangst: Record<string, number>;
  ritten: { dhlCostCents: number; maxRouteWaitDays: number; routes: number };
};

/* ── opmaak ──────────────────────────────────────────────────────────────── */

const euro = (centen: unknown) =>
  "€ " + (Math.round(Number(centen) || 0) / 100).toFixed(2).replace(".", ",");
const uur = (u: unknown) => String(Math.round(Number(u) || 0)).padStart(2, "0") + ":00";
const pct = (f: unknown) => {
  const n = Number(f) || 0;
  const waarde = n <= 1 ? n * 100 : n;
  return (Math.round(waarde * 10) / 10).toString().replace(".", ",") + "%";
};
const janee = (v: unknown) => (v ? "ja" : "nee");
const aanuit = (v: unknown) => (v ? "aan" : "uit");

const OPMAAK: Record<string, (v: unknown) => string> = { euro, uur, pct, janee, aanuit };

/** Punt-pad in een object opzoeken, zonder te klappen op een ontbrekende tak. */
function pak(bron: unknown, pad: string): unknown {
  return pad.split(".").reduce<unknown>((acc, sleutel) => {
    if (acc && typeof acc === "object" && sleutel in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[sleutel];
    }
    return undefined;
  }, bron);
}

/* ── HTML-hulpjes (alle inhoud is eigen tekst; escape blijft de regel) ───── */

const esc = (v: unknown) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const tabel = (koppen: string[], rijen: string[][], klasse = "") =>
  `<div class="tabel-wrap"><table${klasse ? ` class="${klasse}"` : ""}><thead><tr>${koppen
    .map((k) => `<th scope="col">${esc(k)}</th>`)
    .join("")}</tr></thead><tbody>${rijen
    .map((r) => `<tr>${r.map((cel) => `<td>${cel}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;

/* ── automatisch afgeleide hoofdstukken ─────────────────────────────────── */

/** Cron-uitdrukking → leesbare zin. Niet volledig, wel eerlijk over wat het niet weet. */
export function leesbaarSchema(expr: string): string {
  const [min, uurDeel, dag, maand, weekdag] = String(expr || "").trim().split(/\s+/);
  if (!min || !uurDeel) return expr;
  const tijd = (u: string, m: string) => `${String(u).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  if (min.startsWith("*/")) return `elke ${min.slice(2)} minuten`;
  if (uurDeel === "*") return `elk uur op :${String(min).padStart(2, "0")}`;
  if (uurDeel.startsWith("*/")) return `elke ${uurDeel.slice(2)} uur (op :${String(min).padStart(2, "0")})`;
  if (uurDeel.includes(",")) return `dagelijks om ${uurDeel.split(",").map((u) => tijd(u, min)).join(" en ")}`;
  if (dag && dag !== "*") return `op de ${dag.replace(",", "e en ")}e van de maand om ${tijd(uurDeel, min)}`;
  if (weekdag && weekdag !== "*") return `wekelijks om ${tijd(uurDeel, min)}`;
  return `dagelijks om ${tijd(uurDeel, min)}`;
}

/** De taken zoals ze in vercel.json staan, met de uitleg uit de kop van de route. */
function taakRijen(): string[][] {
  const crons = (vercelConfig as { crons?: { path: string; schedule: string }[] }).crons || [];
  const uitleg = new Map(
    handboekIndex.endpoints.map((e) => [e.pad, e.samenvatting]),
  );
  return crons
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((c) => [
      `<code>${esc(c.path.replace("/api/cron/", ""))}</code>`,
      `<span class="mono">${esc(leesbaarSchema(c.schedule))}</span>`,
      esc((uitleg.get(c.path) || "").split(". ")[0] || ""),
    ]);
}

/** Instellingen: de belangrijke knoppen met hun ECHTE waarde, plus alles wat er nog meer is. */
function instellingenHtml(s: Settings, kaarten: Kaarten): string {
  type Rij = { groep: string; label: string; waarde: string };
  const rijen: Rij[] = [
    { groep: "Verzending", label: "Gratis verzending vanaf", waarde: euro(s.freeShippingCents) },
    { groep: "Verzending", label: "Verzendkosten", waarde: euro(s.shippingCents) },
    { groep: "Verzending", label: "Toeslag snellere levering", waarde: euro(s.expressSurchargeCents) },
    { groep: "Verzending", label: "Cutoff magazijn / winkels", waarde: `${uur(s.warehouseCutoffHour)} / ${uur(s.storeCutoffHour)}` },
    { groep: "Verzending", label: "Overdrachtsmarge winkel", waarde: `${s.storeHandoverMinutes} minuten` },
    { groep: "Verzending", label: "Verzenden zaterdag (winkels) / zondag", waarde: `${janee(s.dispatchOnSaturdayStores)} / ${janee(s.dispatchOnSunday)}` },
    { groep: "Verzending", label: "Gepauzeerde filialen", waarde: s.pausedBranchIds.length ? s.pausedBranchIds.join(", ") : "geen" },
    { groep: "Verzending", label: "Extra sluitingsdagen", waarde: s.extraClosureDates.length ? s.extraClosureDates.join(", ") : "geen" },
    { groep: "Levertijd", label: "Standaard", waarde: `${s.standardMinDays}–${s.standardMaxDays} werkdagen` },
    { groep: "Levertijd", label: "Transit magazijn / extra uit winkel", waarde: `${s.warehouseTransitDays} / +${s.storeExtraDays} dag` },
    { groep: "Voorraad", label: "Veiligheidsvoorraad winkels", waarde: `${s.retailSafetyStock} stuks per artikel` },
    { groep: "Voorraad", label: "Veiligheidsvoorraad magazijn", waarde: String(s.warehouseSafetyStock) },
    { groep: "Voorraad", label: "Marge winkelkanaal", waarde: String(s.storeChannelSafetyStock) },
    { groep: "Voorraad", label: "Onderbevoorrade winkel beschermen", waarde: aanuit(s.protectUnderstockedRetail) },
    { groep: "Voorraad", label: "Overstock eerst versturen", waarde: `${aanuit(s.routeOverstockFirst.enabled)} (vanaf ${s.routeOverstockFirst.minSurplus} over)` },
    { groep: "Voorraad", label: "Reservering vasthouden", waarde: `${kaarten.reserveringMinuten} minuten` },
    { groep: "Ontvangst", label: "Toegestane afwijking", waarde: pct(kaarten.ontvangst.aql) },
    { groep: "Ontvangst", label: "Minimale steekproef", waarde: `${kaarten.ontvangst.nMin} regels` },
    { groep: "Ontvangst", label: "Kleine partij → alles tellen", waarde: `t/m ${kaarten.ontvangst.smallLotPieces} stuks` },
    { groep: "Ontvangst", label: "Hoge waarde → alles tellen", waarde: `vanaf ${euro(kaarten.ontvangst.highValueCents)}` },
    { groep: "Ontvangst", label: "Nieuwe bron → alles tellen", waarde: `< ${kaarten.ontvangst.newSourceReceipts} ontvangsten` },
    { groep: "Ontvangst", label: "Aanscherpen / versoepelen", waarde: `${pct(kaarten.ontvangst.sourceTightenRate)} manco / ${pct(kaarten.ontvangst.sourceReducedRate)} na ${kaarten.ontvangst.reducedAfterCleanReceipts} schone` },
    { groep: "Ontvangst", label: "Probleemartikel", waarde: `${kaarten.ontvangst.mancoLineMinHits}× én ${pct(kaarten.ontvangst.mancoLineRate)} binnen ${kaarten.ontvangst.mancoWindowDays} dagen` },
    { groep: "Logistiek", label: "Ritten winkel→winkel", waarde: kaarten.ritten.routes ? `${kaarten.ritten.routes} ingesteld` : "geen (advies altijd DHL)" },
    { groep: "Logistiek", label: "DHL-kosten uitwisseling", waarde: euro(kaarten.ritten.dhlCostCents) },
    { groep: "Logistiek", label: "Max wachttijd op een rit", waarde: `${kaarten.ritten.maxRouteWaitDays} dagen` },
    { groep: "Retour", label: "Bedenktijd", waarde: `${s.returnConfig.windowDays} dagen` },
    { groep: "Retour", label: "Retourkosten bij geld terug", waarde: euro(s.returnConfig.dhlReturnCostCents) },
    { groep: "Retour", label: "Gratis bij tegoed", waarde: janee(s.returnConfig.freeOnCredit) },
    { groep: "Retour", label: "Signaaldrempel", waarde: `${s.returnConfig.signalMinReturns}× · ${s.returnConfig.signalMinRatePct}% · binnen ${s.returnConfig.signalFastDays} dagen` },
    { groep: "Retour", label: "Niet leverbaar: bericht / alternatieven", waarde: `${aanuit(s.unfulfillableConfig.emailEnabled)} / ${s.unfulfillableConfig.alternativesCount}` },
    { groep: "Loyalty", label: "Spaarsnelheid", waarde: `${s.loyaltyConfig.pointsPerEuro} punt per euro` },
    { groep: "Loyalty", label: "Inwisselkoers", waarde: `${s.loyaltyConfig.redeemCentsPerPoint} cent per punt` },
    { groep: "Loyalty", label: "Drempel / stap", waarde: `${s.loyaltyConfig.redeemMinPoints} / ${s.loyaltyConfig.redeemStepPoints} punten` },
    { groep: "Loyalty", label: "Wachttijd voor besteedbaar", waarde: `${s.loyaltyConfig.vestingDays} dagen` },
    { groep: "Loyalty", label: "Coulance-dak per keer", waarde: `${s.loyaltyConfig.serviceMaxPerActie} punten` },
    { groep: "Commercie", label: "Staffelkorting", waarde: `${aanuit(s.tieredDiscount.enabled)} (vanaf ${s.tieredDiscount.minItems} stuks, ${s.tieredDiscount.percentOff}%)` },
    { groep: "Commercie", label: "Cadeaubon", waarde: `${aanuit(s.giftcardConfig.enabled)}, ${euro(s.giftcardConfig.minCents)}–${euro(s.giftcardConfig.maxCents)}, ${s.giftcardConfig.validityMonths} maanden geldig` },
    { groep: "Commercie", label: "Sale-weergave na prijsverlaging", waarde: `${s.saleAnnouncementDays} dagen` },
    { groep: "Commercie", label: "Betaalprovider", waarde: s.paymentProvider },
    { groep: "Melden", label: "Terug op voorraad", waarde: `${aanuit(s.stockNotifyConfig.enabled)}, alternatief na ${s.stockNotifyConfig.alternativeAfterDays} dagen` },
    { groep: "Melden", label: "Meldingen aan onszelf", waarde: s.alertEmails.length ? `${s.alertEmails.length} ontvanger(s)` : "niemand ingesteld" },
    { groep: "Meten", label: "Heatmap", waarde: `${aanuit(s.heatmap.aan)}, ${s.heatmap.bewaardagen} dagen ruwe data, ${s.heatmap.steekproefPct}% van de sessies` },
  ];

  const groepen = [...new Set(rijen.map((r) => r.groep))];
  const blokken = groepen
    .map((g) =>
      `<h4>${esc(g)}</h4>` +
      tabel(
        ["Instelling", "Nu"],
        rijen.filter((r) => r.groep === g).map((r) => [esc(r.label), `<span class="mono">${esc(r.waarde)}</span>`]),
      ),
    )
    .join("");

  /* Alles wat hierboven niet met naam genoemd is, tóch tonen. Zo verschijnt een
     nieuwe instelling vanzelf in het handboek in plaats van stil te ontbreken. */
  const genoemd = new Set([
    "freeShippingCents", "shippingCents", "expressSurchargeCents", "warehouseCutoffHour", "storeCutoffHour",
    "storeHandoverMinutes", "dispatchOnSaturdayStores", "dispatchOnSunday", "pausedBranchIds", "extraClosureDates",
    "standardMinDays", "standardMaxDays", "warehouseTransitDays", "storeExtraDays", "expressTransitDays",
    "retailSafetyStock", "warehouseSafetyStock", "storeChannelSafetyStock", "protectUnderstockedRetail",
    "routeOverstockFirst", "returnConfig", "unfulfillableConfig", "loyaltyConfig", "tieredDiscount",
    "giftcardConfig", "saleAnnouncementDays", "paymentProvider", "stockNotifyConfig", "alertEmails", "heatmap",
    "branchCutoffs", "warehouseCutoffByDay", "storeCutoffByDay",
  ]);
  const rest = Object.keys(s)
    .filter((k) => !genoemd.has(k))
    .sort()
    .map((k) => {
      const v = (s as unknown as Record<string, unknown>)[k];
      const omschrijving = Array.isArray(v)
        ? `${v.length} regel(s)`
        : v && typeof v === "object"
          ? `${Object.keys(v as object).length} veld(en)`
          : typeof v === "string"
            ? (v.length > 40 ? `${v.length} tekens` : v || "leeg")
            : String(v);
      return [`<code>${esc(k)}</code>`, `<span class="mono">${esc(omschrijving)}</span>`];
    });

  return (
    blokken +
    (rest.length
      ? `<h4>Overige instellingen</h4><p>Beheerd in de portal, te uitgebreid voor een tabelregel — hier alleen als bewijs dat ze bestaan.</p>${tabel(["Sleutel", "Inhoud"], rest)}`
      : "")
  );
}

function modulesHtml(): string {
  const per = new Map<string, typeof handboekIndex.modules>();
  for (const m of handboekIndex.modules) {
    const lijst = per.get(m.domein) || [];
    lijst.push(m);
    per.set(m.domein, lijst);
  }
  const volgorde = [
    "Catalogus", "Site en content", "Kopen en orders", "Klant en marketing",
    "Kassa", "Keten en voorraad", "Meten", "Platform", "Overig",
  ];
  const domeinen = [...per.keys()].sort((a, b) => {
    const ia = volgorde.indexOf(a), ib = volgorde.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return domeinen
    .map((d) => {
      const lijst = (per.get(d) || []).slice().sort((a, b) => a.naam.localeCompare(b.naam));
      return (
        `<h4>${esc(d)} <span class="mono">(${lijst.length})</span></h4>` +
        tabel(
          ["Module", "Wat het doet"],
          lijst.map((m) => [`<code>${esc(m.naam)}</code>`, esc(m.samenvatting)]),
          "tab-breed",
        )
      );
    })
    .join("");
}

function endpointsHtml(): string {
  const per = new Map<string, typeof handboekIndex.endpoints>();
  for (const e of handboekIndex.endpoints) {
    const lijst = per.get(e.poort) || [];
    lijst.push(e);
    per.set(e.poort, lijst);
  }
  const volgorde = [
    "Publiek", "Klantsessie", "Studio-token (portal en beheerder)", "Core-token (kassa en scanner)", "Cron-geheim",
  ];
  const poorten = [...per.keys()].sort((a, b) => {
    const ia = volgorde.indexOf(a), ib = volgorde.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return poorten
    .map((p) => {
      const lijst = per.get(p) || [];
      return (
        `<h4>${esc(p)} <span class="mono">(${lijst.length})</span></h4>` +
        tabel(
          ["Endpoint", "Methoden", "Waarvoor"],
          lijst.map((e) => [
            `<code>${esc(e.pad)}</code>`,
            `<span class="mono">${esc(e.methoden.join(" ") || "—")}</span>`,
            esc(e.samenvatting),
          ]),
          "tab-breed",
        )
      );
    })
    .join("");
}

function tabellenHtml(): string {
  const lijst = handboekIndex.tabellen;
  return (
    `<h4>Alle tabellen <span class="mono">(${lijst.length})</span></h4>` +
    `<div class="chips">${lijst.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>`
  );
}

function winkelsHtml(): string {
  const winkels = getStores();
  return tabel(
    ["Winkel", "Plaats", "Adres", "Telefoon"],
    winkels.map((w) => [esc(w.title), esc(w.city), esc(String(w.address || "").trim()), `<span class="mono">${esc(w.phone)}</span>`]),
  );
}

/* ── samenstellen ───────────────────────────────────────────────────────── */

function vulPlaatshouders(html: string, s: Settings, kaarten: Kaarten): string {
  return html.replace(/\{\{([a-zA-Z0-9_.]+)(?:\|([a-z]+))?\}\}/g, (heel, pad: string, fmt?: string) => {
    let waarde: unknown;
    if (pad.startsWith("knop.")) waarde = pak(s, pad.slice(5));
    else if (pad === "kaart.reserveringMinuten") waarde = kaarten.reserveringMinuten;
    else if (pad.startsWith("kaart.ontvangst.")) waarde = kaarten.ontvangst[pad.slice("kaart.ontvangst.".length)];
    else if (pad.startsWith("kaart.ritten.")) waarde = pak(kaarten.ritten, pad.slice("kaart.ritten.".length));
    if (waarde === undefined || waarde === null) {
      // Zichtbaar laten, niet stil weglaten: een kapotte plaatshouder hoort op te vallen.
      return `<span class="mono">?${esc(pad)}</span>`;
    }
    const opmaak = fmt ? OPMAAK[fmt] : undefined;
    return esc(opmaak ? opmaak(waarde) : String(waarde));
  });
}

function autoHtml(bron: NonNullable<Hoofdstuk["auto"]>, s: Settings, kaarten: Kaarten): string {
  switch (bron) {
    case "crons":
      return tabel(["Taak", "Wanneer", "Wat hij doet"], taakRijen());
    case "instellingen":
      return instellingenHtml(s, kaarten);
    case "modules":
      return modulesHtml();
    case "endpoints":
      return endpointsHtml();
    case "tabellen":
      return tabellenHtml();
    case "winkels":
      return winkelsHtml();
    default:
      return "";
  }
}

async function leesKaarten(): Promise<Kaarten> {
  const [minuten, ontvangst, ritten] = await Promise.all([
    getReservationHoldMinutes().catch(() => 120),
    getReceivingConfig().catch(() => null),
    getTransferRoutesConfig().catch(() => null),
  ]);
  return {
    reserveringMinuten: minuten,
    ontvangst: (ontvangst ?? {}) as unknown as Record<string, number>,
    ritten: {
      dhlCostCents: ritten?.dhlCostCents ?? 700,
      maxRouteWaitDays: ritten?.maxRouteWaitDays ?? 4,
      routes: ritten?.routes?.length ?? 0,
    },
  };
}

const anker = (deel: Deel, h: Hoofdstuk) => `${deel.id}-${h.nr.replace(/\./g, "-")}`;

/** Het complete handboek, klaar om te renderen. */
export async function bouwHandboek(): Promise<Handboek> {
  const [settings, kaarten] = await Promise.all([getSettings(), leesKaarten()]);

  const delen: HandboekDeel[] = HANDBOEK.map((deel) => ({
    id: deel.id,
    rom: deel.rom,
    titel: deel.titel,
    intro: deel.intro,
    hoofdstukken: deel.hoofdstukken.map((h) => ({
      nr: h.nr,
      titel: h.titel,
      anker: anker(deel, h),
      html:
        vulPlaatshouders(h.html || "", settings, kaarten) +
        (h.auto ? autoHtml(h.auto, settings, kaarten) : ""),
    })),
  }));

  const crons = (vercelConfig as { crons?: unknown[] }).crons || [];
  return {
    delen,
    stand: {
      delen: delen.length,
      hoofdstukken: delen.reduce((n, d) => n + d.hoofdstukken.length, 0),
      modules: handboekIndex.modules.length,
      endpoints: handboekIndex.endpoints.length,
      tabellen: handboekIndex.tabellen.length,
      taken: crons.length,
    },
  };
}
