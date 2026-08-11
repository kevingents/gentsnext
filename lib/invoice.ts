/**
 * Klantfactuur voor een betaalde weborder. Levert printbare HTML — dezelfde route
 * als de pakbon (lib/packing-slip.ts), zodat er geen PDF-afhankelijkheid bij komt:
 * de browser maakt er met "Bewaar als PDF" een keurige PDF van.
 *
 * Btw: de webshop is NL-only en alle prijzen zijn inclusief btw (zie
 * lib/shipping-zones.ts en de klantmails), dus de factuur rekent het btw-bedrag
 * terug uit het totaal. Een cadeaubon is een BETAALMIDDEL en geen korting: die gaat
 * er pas ná het factuurtotaal af, anders zou de btw-grondslag te laag uitvallen.
 *
 * Het GENTS-logo "GENTS — SUITS YOU" blijft ongewijzigd.
 */

type FactuurOrder = {
  orderNumber: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  companyName?: string | null;
  vatNumber?: string | null;
  createdAt?: Date | string | null;
  paidAt?: Date | string | null;
  subtotalCents: number;
  discountCents: number;
  shippingCents: number;
  giftcardCents: number;
  totalCents: number;
  voucherCode?: string | null;
};
type FactuurLine = { title?: string | null; sku?: string | null; size?: string | null; color?: string | null; quantity?: number | null; unitPriceCents?: number | null };
export type FactuurBedrijf = {
  bedrijfsnaam: string; adres: string; postcodePlaats: string;
  kvk: string; btwNummer: string; iban: string; btwPercent: number;
};

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function euro(cents: number): string {
  return (Number(cents || 0) / 100).toLocaleString("nl-NL", { style: "currency", currency: "EUR" });
}
function datum(v: Date | string | null | undefined): string {
  try {
    return new Date(v || Date.now()).toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return "";
  }
}

export function renderInvoice(order: FactuurOrder, lines: FactuurLine[], bedrijf: FactuurBedrijf): string {
  const naam = [order.firstName, order.lastName].filter(Boolean).join(" ").trim() || esc(order.email) || "—";
  const adresRegels = [
    order.companyName || "",
    naam,
    `${order.street || ""} ${order.houseNumber || ""}`.trim(),
    `${order.postalCode || ""} ${order.city || ""}`.trim(),
    (order.country || "NL") === "NL" ? "Nederland" : String(order.country),
  ].filter(Boolean);

  /* Goederenwaarde = wat er daadwerkelijk geleverd is, inclusief verzending en na
     korting. Dit is de btw-grondslag; de cadeaubon staat er bewust buiten. */
  const goederen = Math.max(0, order.subtotalCents - order.discountCents + order.shippingCents);
  const pct = Number(bedrijf.btwPercent) > 0 ? Number(bedrijf.btwPercent) : 21;
  const btw = Math.round(goederen - goederen / (1 + pct / 100));
  const restBetaald = Math.max(0, goederen - (order.giftcardCents || 0));

  const rows = lines
    .map((l) => {
      const aantal = Number(l.quantity || 1);
      const stuk = Number(l.unitPriceCents || 0);
      const variant = [l.color, l.size].filter(Boolean).map(esc).join(" · ");
      return `<tr>
      <td class="qty">${aantal}×</td>
      <td><div class="title">${esc(l.title || "Artikel")}</div>${variant ? `<div class="muted">${variant}</div>` : ""}${l.sku ? `<div class="muted">${esc(l.sku)}</div>` : ""}</td>
      <td class="num">${euro(stuk)}</td>
      <td class="num">${euro(stuk * aantal)}</td>
    </tr>`;
    })
    .join("");

  const voet = [
    bedrijf.kvk ? `KvK ${esc(bedrijf.kvk)}` : "",
    bedrijf.btwNummer ? `Btw-nr ${esc(bedrijf.btwNummer)}` : "",
    bedrijf.iban ? `IBAN ${esc(bedrijf.iban)}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>Factuur ${esc(order.orderNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 Arial, sans-serif; color: #0a1f33; margin: 0; padding: 28px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0a1f33; padding-bottom: 14px; margin-bottom: 18px; }
  .logo { font-weight: 700; letter-spacing: .14em; font-size: 17px; }
  .logo small { display: block; font-weight: 400; letter-spacing: .3em; font-size: 9px; color: #6b7280; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 20px; }
  .doc .muted { color: #6b7280; font-size: 12px; }
  .meta { display: flex; gap: 40px; margin-bottom: 22px; }
  .meta h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
  th.num, td.num { text-align: right; white-space: nowrap; }
  td { padding: 9px 8px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
  td.qty { font-weight: 700; white-space: nowrap; }
  .title { font-weight: 600; }
  .muted { color: #6b7280; font-size: 11px; }
  .totalen { margin-left: auto; margin-top: 16px; width: 300px; }
  .totalen div { display: flex; justify-content: space-between; padding: 4px 8px; }
  .totalen .eind { border-top: 1px solid #0a1f33; margin-top: 6px; padding-top: 8px; font-weight: 700; font-size: 15px; }
  .voet { margin-top: 28px; border-top: 1px solid #eef0f2; padding-top: 12px; font-size: 11px; color: #6b7280; }
  .print { margin-bottom: 18px; }
  .print button { font: 13px Arial, sans-serif; padding: 9px 16px; border: 1px solid #0a1f33; background: #0a1f33; color: #fff; cursor: pointer; }
  @media print { body { padding: 0; } .print { display: none; } }
</style></head>
<body>
  <div class="print"><button type="button" onclick="window.print()">Opslaan als pdf / afdrukken</button></div>
  <div class="head">
    <div class="logo">GENTS<small>SUITS YOU</small></div>
    <div class="doc">
      <h1>Factuur</h1>
      <div class="muted">${esc(order.orderNumber)}</div>
      <div class="muted">${esc(datum(order.paidAt || order.createdAt))}</div>
    </div>
  </div>

  <div class="meta">
    <div>
      <h2>Factuuradres</h2>
      ${adresRegels.map((r) => esc(r)).join("<br>")}
      ${order.vatNumber ? `<br><span class="muted">Btw-nr ${esc(order.vatNumber)}</span>` : ""}
    </div>
    <div>
      <h2>Van</h2>
      ${esc(bedrijf.bedrijfsnaam)}<br>${esc(bedrijf.adres)}<br>${esc(bedrijf.postcodePlaats)}
    </div>
  </div>

  <table>
    <thead><tr><th>Aantal</th><th>Artikel</th><th class="num">Stuk</th><th class="num">Totaal</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totalen">
    <div><span>Subtotaal</span><span>${euro(order.subtotalCents)}</span></div>
    ${order.discountCents > 0 ? `<div><span>Korting${order.voucherCode ? ` (${esc(order.voucherCode)})` : ""}</span><span>− ${euro(order.discountCents)}</span></div>` : ""}
    <div><span>Verzendkosten</span><span>${order.shippingCents === 0 ? "Gratis" : euro(order.shippingCents)}</span></div>
    <div class="muted"><span>Waarvan btw ${pct}%</span><span>${euro(btw)}</span></div>
    <div class="eind"><span>Totaal</span><span>${euro(goederen)}</span></div>
    ${order.giftcardCents > 0 ? `<div><span>Betaald met cadeaubon</span><span>− ${euro(order.giftcardCents)}</span></div><div><span>Voldaan</span><span>${euro(restBetaald)}</span></div>` : ""}
  </div>

  <div class="voet">
    ${esc(bedrijf.bedrijfsnaam)} · ${esc(bedrijf.adres)}, ${esc(bedrijf.postcodePlaats)}${voet ? ` · ${voet}` : ""}<br>
    Alle bedragen zijn inclusief btw. Deze factuur is voldaan${order.paidAt ? ` op ${esc(datum(order.paidAt))}` : ""}.
  </div>
</body></html>`;
}
