/**
 * Pakbon (delivery note) voor een ship-from-store weborder. Levert printbare HTML
 * die de winkel in een nieuw venster opent en direct afdrukt. Geen prijzen (het is
 * een paklijst, geen factuur). Het GENTS-logo "GENTS — SUITS YOU" blijft ongewijzigd.
 */

type SlipOrder = {
  orderNumber: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  street?: string | null;
  houseNumber?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
  createdAt?: Date | string | null;
};
type SlipLine = { title?: string | null; sku?: string | null; size?: string | null; color?: string | null; quantity?: number | null };

function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function renderPackingSlip(order: SlipOrder, lines: SlipLine[], opts?: { store?: string }): string {
  const naam = [order.firstName, order.lastName].filter(Boolean).join(" ").trim() || "—";
  const adres = [
    `${esc(order.street)} ${esc(order.houseNumber)}`.trim(),
    `${esc(order.postalCode)} ${esc(order.city)}`.trim(),
    esc(order.country || "NL"),
  ].filter((s) => s && s !== "NL" ? true : s === "NL").join("<br>");
  let datum = "";
  try { datum = new Date(order.createdAt || Date.now()).toLocaleDateString("nl-NL", { day: "2-digit", month: "long", year: "numeric" }); } catch { datum = ""; }

  const rows = lines.map((l) => {
    const variant = [l.color, l.size].filter(Boolean).map(esc).join(" · ");
    return `<tr>
      <td class="qty">${Number(l.quantity || 1)}×</td>
      <td><div class="title">${esc(l.title || "Artikel")}</div>${variant ? `<div class="muted">${variant}</div>` : ""}</td>
      <td class="sku">${esc(l.sku || "")}</td>
      <td class="check"><span class="box"></span></td>
    </tr>`;
  }).join("");

  return `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><title>Pakbon ${esc(order.orderNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 13px/1.5 Arial, sans-serif; color: #0a1f33; margin: 0; padding: 28px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0a1f33; padding-bottom: 14px; margin-bottom: 18px; }
  .logo { font-weight: 700; letter-spacing: .14em; font-size: 17px; }
  .logo small { display: block; font-weight: 400; letter-spacing: .3em; font-size: 9px; color: #6b7280; }
  .doc { text-align: right; }
  .doc h1 { margin: 0; font-size: 20px; }
  .doc .muted { color: #6b7280; font-size: 12px; }
  .meta { display: flex; gap: 40px; margin-bottom: 20px; }
  .meta h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: #6b7280; margin: 0 0 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #6b7280; border-bottom: 1px solid #e5e7eb; padding: 6px 8px; }
  td { padding: 9px 8px; border-bottom: 1px solid #eef0f2; vertical-align: top; }
  td.qty { font-weight: 700; white-space: nowrap; }
  td.sku { color: #6b7280; font-size: 11px; }
  td.check { text-align: right; }
  .title { font-weight: 600; }
  .muted { color: #6b7280; font-size: 11px; }
  .box { display: inline-block; width: 15px; height: 15px; border: 1.5px solid #0a1f33; border-radius: 3px; }
  .note { margin-top: 22px; padding: 10px 12px; background: #f6f7f9; border-radius: 6px; font-size: 12px; color: #374151; }
  @media print { body { padding: 0; } .note { background: #f6f7f9 !important; -webkit-print-color-adjust: exact; } }
</style></head>
<body onload="window.print()">
  <div class="head">
    <div class="logo">GENTS<small>SUITS YOU</small></div>
    <div class="doc"><h1>Pakbon</h1><div class="muted">${esc(order.orderNumber)}${datum ? ` · ${esc(datum)}` : ""}</div></div>
  </div>
  <div class="meta">
    <div><h2>Verzenden naar</h2><strong>${esc(naam)}</strong><br>${adres}${order.email ? `<br>${esc(order.email)}` : ""}${order.phone ? `<br>${esc(order.phone)}` : ""}</div>
    ${opts?.store ? `<div><h2>Vanuit winkel</h2><strong>${esc(opts.store)}</strong></div>` : ""}
  </div>
  <table>
    <thead><tr><th>Aantal</th><th>Artikel</th><th>SKU</th><th style="text-align:right">Gepakt</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="note">Controleer elk artikel (maat &amp; model) voordat je de verzending sluit. Bij een gesplitste order: stuur pas als het complete deel klaarligt.</div>
</body></html>`;
}
