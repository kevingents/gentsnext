/* GENTS — Supply-chain-presentatie (kassa, website, portal). LAYOUT WIDE 13.33 x 7.5".
 *
 * Draaien:  node scripts/deck/supplychain.cjs
 * Vereist:  npm i --no-save pptxgenjs react-icons sharp react react-dom
 * Schrijft: scripts/deck/GENTS-supplychain.pptx
 *
 * Zelfde huisstijl-helpers als de MT-presentatie (scripts/deck/build.cjs); de inhoud
 * is de keten zoals die in de code staat — voorraadformule, allocatie, ontvangst
 * (F1-F4), inventarisatie, retour — plus de knoppen die de afdeling zelf beheert.
 * Cijfers hieronder zijn de DEFAULTS uit lib/settings.ts, lib/receiving-config.ts,
 * lib/transfer-routes.ts en lib/reservation-config.ts; wat in de portal is bijgesteld
 * gaat vóór. Bij een wijziging daar: dit deck opnieuw draaien.
 */
const Pptx = require("pptxgenjs");
const { C, icon, shadow } = require("./lib.cjs");
const FA = require("react-icons/fa");
const path = require("path");

const W = 13.33, H = 7.5, M = 0.7;

async function main() {
  const p = new Pptx();
  p.defineLayout({ name: "G", width: W, height: H }); p.layout = "G";
  p.author = "GENTS"; p.title = "GENTS — Supply chain: kassa, website en portal";

  // ── icoon-cache ──
  const ic = {};
  const need = {
    diagram: FA.FaProjectDiagram, warehouse: FA.FaWarehouse, truck: FA.FaTruck, boxes: FA.FaBoxes,
    scan: FA.FaBarcode, cash: FA.FaCashRegister, globe: FA.FaGlobe, db: FA.FaDatabase,
    store: FA.FaStore, shield: FA.FaShieldAlt, exchange: FA.FaExchangeAlt, clipboard: FA.FaClipboardCheck,
    sliders: FA.FaSlidersH, calendar: FA.FaCalendarAlt, clock: FA.FaClock, search: FA.FaSearchPlus,
    warn: FA.FaExclamationTriangle, check: FA.FaCheckCircle, sync: FA.FaSync, route: FA.FaRoute,
    ship: FA.FaShippingFast, bell: FA.FaBell, chart: FA.FaChartLine, lock: FA.FaLock, tag: FA.FaTags,
    scale: FA.FaBalanceScale, undo: FA.FaUndo, list: FA.FaListUl, grid: FA.FaThLarge, flag: FA.FaFlag,
    boxOpen: FA.FaBoxOpen, ban: FA.FaBan, target: FA.FaBullseye, stopwatch: FA.FaStopwatch,
    hourglass: FA.FaHourglassHalf, wrench: FA.FaWrench, tshirt: FA.FaTshirt, euro: FA.FaEuroSign,
  };
  const ontbreekt = Object.entries(need).filter(([, v]) => typeof v !== "function").map(([k]) => k);
  if (ontbreekt.length) throw new Error("Onbekende iconen: " + ontbreekt.join(", "));
  for (const [k, Comp] of Object.entries(need)) {
    ic[k] = { gold: await icon(Comp, "#" + C.gold), navy: await icon(Comp, "#" + C.navy), white: await icon(Comp, "#FFFFFF"), slate: await icon(Comp, "#" + C.slate) };
  }

  // ── helpers (gelijk aan build.cjs, zodat beide decks er hetzelfde uitzien) ──
  const sh = (o = 0.1, b = 8, off = 2, a = 90) => shadow(o, b, off, a);
  function box(s, x, y, w, h, o = {}) {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: Math.min(0.09, h / 6), fill: { color: o.fill || C.card }, line: o.line === false ? { type: "none" } : { color: o.lineColor || C.line, width: o.lw || 1 }, shadow: o.shadow ? sh(0.1) : undefined });
    if (o.icon) s.addImage({ data: o.icon, x: x + 0.16, y: y + h / 2 - 0.21, w: 0.42, h: 0.42 });
    const tx = o.icon ? x + 0.72 : x + 0.14, tw = o.icon ? w - 0.86 : w - 0.28;
    if (o.sub) {
      s.addText(o.title, { x: tx, y: y + 0.12, w: tw, h: 0.42, align: o.icon ? "left" : "center", valign: "bottom", fontFace: "Georgia", fontSize: o.fs || 13, bold: true, color: o.color || C.navy, margin: 0 });
      s.addText(o.sub, { x: tx, y: y + h / 2 + 0.04, w: tw, h: h / 2 - 0.1, align: o.icon ? "left" : "center", valign: "top", fontSize: o.subFs || 9.5, color: o.subColor || C.slate, margin: 0 });
    } else s.addText(o.title, { x: tx, y, w: tw, h, align: o.icon ? "left" : "center", valign: "middle", fontFace: o.face || "Georgia", fontSize: o.fs || 13, bold: o.bold !== false, color: o.color || C.navy, margin: 0 });
  }
  const aDown = (s, cx, y, len, col) => s.addShape(p.shapes.LINE, { x: cx, y, w: 0, h: len, line: { color: col || C.gold, width: 2.25, endArrowType: "triangle" } });
  const aRight = (s, x, cy, len, col) => s.addShape(p.shapes.LINE, { x, y: cy, w: len, h: 0, line: { color: col || C.gold, width: 2.25, endArrowType: "triangle" } });
  const seg = (s, x, y, w, h, col, arrow) => s.addShape(p.shapes.LINE, { x, y, w, h, line: { color: col || C.gold, width: 2.25, endArrowType: arrow ? "triangle" : "none" } });
  function chip(s, x, y, w, t, fill, color, h) { const hh = h || 0.3; s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h: hh, rectRadius: hh / 2, fill: { color: fill }, line: { type: "none" } }); s.addText(t, { x, y, w, h: hh, align: "center", valign: "middle", fontSize: 8.5, bold: true, color, margin: 0 }); }
  function badge(s, x, y, n, col) { s.addShape(p.shapes.OVAL, { x, y, w: 0.42, h: 0.42, fill: { color: col || C.gold }, line: { type: "none" }, shadow: sh(0.14, 4, 1) }); s.addText(String(n), { x, y, w: 0.42, h: 0.42, align: "center", valign: "middle", fontFace: "Georgia", fontSize: 15, bold: true, color: "FFFFFF", margin: 0 }); }
  function step(s, x, y, w, h, o) {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.09, fill: { color: o.fill || C.card }, line: { color: o.lineColor || C.line, width: 1.25 }, shadow: sh(0.1, 7, 2) });
    s.addImage({ data: o.icon, x: x + w / 2 - 0.26, y: y + 0.2, w: 0.52, h: 0.52 });
    s.addText(o.title, { x: x + 0.12, y: y + 0.78, w: w - 0.24, h: 0.34, align: "center", fontFace: "Georgia", fontSize: 13, bold: true, color: C.navy, valign: "middle", margin: 0 });
    s.addText(o.sub, { x: x + 0.14, y: y + 1.12, w: w - 0.28, h: h - 1.2, align: "center", fontSize: 9.5, color: C.slate, valign: "top", margin: 0 });
    badge(s, x - 0.14, y - 0.14, o.n, o.badge || C.gold);
  }
  function head(s, num, iconKey, title, headline) {
    s.background = { color: C.mist };
    s.addShape(p.shapes.OVAL, { x: M, y: 0.5, w: 0.82, h: 0.82, fill: { color: C.navy }, shadow: sh(0.16, 6, 2) });
    s.addImage({ data: ic[iconKey].gold, x: M + 0.21, y: 0.71, w: 0.4, h: 0.4 });
    s.addText(num, { x: W - 1.7, y: 0.42, w: 1.0, h: 0.6, align: "right", fontFace: "Georgia", fontSize: 30, color: C.line, bold: true });
    s.addText(title, { x: M + 1.02, y: 0.48, w: 9.6, h: 0.5, fontFace: "Georgia", fontSize: 22, bold: true, color: C.navy, valign: "middle", margin: 0 });
    s.addText(headline, { x: M + 1.02, y: 0.99, w: 11.1, h: 0.46, fontSize: 12.5, italic: true, color: C.slate, valign: "top", margin: 0 });
    s.addShape(p.shapes.LINE, { x: M, y: 1.62, w: W - 2 * M, h: 0, line: { color: C.line, width: 1 } });
  }
  function foot(s, txt, page) {
    s.addText([{ text: "Kern:  ", options: { bold: true, color: C.navy } }, { text: txt, options: { color: C.slate } }], { x: M, y: H - 0.52, w: W - 2 * M - 1.4, h: 0.38, fontSize: 10, valign: "middle" });
    s.addText(`GENTS · supply chain · ${page}`, { x: W - 3.1, y: H - 0.4, w: 2.4, h: 0.3, align: "right", fontSize: 8.5, color: C.slate });
  }
  /** Kaart met icoon-kop en verklarende tekst. */
  function card(s, x, y, w, h, o) {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: o.fill || C.card }, line: { color: o.lineColor || C.line, width: 1 }, shadow: sh(0.09, 7, 2) });
    s.addImage({ data: ic[o.ic][o.iconTone || "gold"], x: x + 0.26, y: y + 0.24, w: 0.46, h: 0.46 });
    s.addText(o.t, { x: x + 0.86, y: y + 0.2, w: w - 1.0, h: 0.54, fontFace: "Georgia", fontSize: o.fs || 13.5, bold: true, color: C.navy, valign: "middle", margin: 0 });
    s.addText(o.v, { x: x + 0.26, y: y + 0.82, w: w - 0.52, h: h - 0.95, fontSize: o.vfs || 10.5, color: C.slate, valign: "top", margin: 0 });
  }
  /** Genummerde regel (beslisladder / stappenlijst). */
  function rule(s, x, y, w, n, t, v, col) {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.66, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 } });
    s.addShape(p.shapes.OVAL, { x: x + 0.14, y: y + 0.15, w: 0.36, h: 0.36, fill: { color: col || C.navy }, line: { type: "none" } });
    s.addText(String(n), { x: x + 0.14, y: y + 0.15, w: 0.36, h: 0.36, align: "center", valign: "middle", fontSize: 11, bold: true, color: "FFFFFF", margin: 0 });
    s.addText([{ text: t + "  ", options: { bold: true, color: C.navy } }, { text: v, options: { color: C.slate } }], { x: x + 0.62, y, w: w - 0.78, h: 0.66, fontSize: 10.5, valign: "middle", margin: 0 });
  }
  /** Volle band onderaan een slide. */
  function band(s, y, o) {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y, w: W - 2 * M, h: o.h || 0.72, rectRadius: 0.09, fill: { color: o.fill || C.emeraldSoft }, line: { color: o.lineColor || C.emerald, width: 1 } });
    s.addImage({ data: ic[o.ic].navy, x: M + 0.24, y: y + (o.h || 0.72) / 2 - 0.18, w: 0.36, h: 0.36 });
    s.addText([{ text: o.t + "  ", options: { bold: true, color: C.navy } }, { text: o.v, options: { color: C.ink } }], { x: M + 0.78, y, w: W - 2 * M - 1.0, h: o.h || 0.72, fontSize: o.fs || 11.5, valign: "middle", margin: 0 });
  }
  /** Tabel met navy kopregel. */
  function table(s, y, cols, rows, rowH) {
    const head = cols.map((c) => ({ text: c.t, options: { bold: true, color: "FFFFFF", fill: { color: C.navy }, fontSize: 10.5, align: c.align || "left" } }));
    const body = rows.map((r, i) => r.map((cell, k) => ({
      text: cell,
      options: { color: k === 0 ? C.navy : k === 1 ? C.ink : C.slate, bold: k === 0, fontSize: 10, align: cols[k].align || "left", fill: { color: i % 2 ? C.mist : "FFFFFF" } },
    })));
    s.addTable([head, ...body], {
      x: M, y, w: W - 2 * M, colW: cols.map((c) => c.w), rowH: rowH || 0.36,
      border: { pt: 0.5, color: C.line }, valign: "middle", margin: [2, 6, 2, 6], autoPage: false,
    });
  }

  /* ════════ 1. TITEL ════════ */
  {
    const s = p.addSlide(); s.background = { color: C.navy };
    s.addShape(p.shapes.OVAL, { x: W - 4.8, y: -2.4, w: 6.5, h: 6.5, fill: { color: C.navy2 } });
    s.addShape(p.shapes.OVAL, { x: W - 2.2, y: 4.6, w: 3, h: 3, fill: { color: "1B2E50" } });
    s.addText("GENTS", { x: M, y: 1.25, w: 6, h: 0.7, fontFace: "Georgia", fontSize: 30, color: C.gold, charSpacing: 8, bold: true });
    s.addText("SUITS YOU", { x: M, y: 1.85, w: 6, h: 0.4, fontSize: 12, color: "FFFFFF", charSpacing: 6 });
    s.addText("Supply chain — hoe de keten werkt", { x: M, y: 2.75, w: 11.6, h: 1.0, fontFace: "Georgia", fontSize: 40, color: "FFFFFF", bold: true });
    s.addText("Kassa, website en portal: de logica, de workflows en de knoppen die jij beheert.", { x: M, y: 3.95, w: 10.8, h: 0.6, fontSize: 15, color: C.line });
    s.addText("Voor de afdeling supply chain", { x: M, y: 5.05, w: 8, h: 0.4, fontSize: 13, color: C.gold, charSpacing: 2 });
    const fy = 6.5, items = [["db", "Voorraad"], ["truck", "Ontvangst"], ["exchange", "Herverdeling"], ["route", "Toewijzing"], ["sliders", "Instellingen"]];
    let fx = M;
    items.forEach((it, i) => {
      s.addImage({ data: ic[it[0]].gold, x: fx, y: fy, w: 0.3, h: 0.3 });
      s.addText(it[1], { x: fx + 0.36, y: fy - 0.04, w: 1.6, h: 0.38, fontSize: 12, color: "FFFFFF", valign: "middle", margin: 0 });
      fx += 0.36 + 0.105 * it[1].length + 0.55;
      if (i < items.length - 1) s.addText("›", { x: fx - 0.42, y: fy - 0.06, w: 0.3, h: 0.4, fontSize: 16, color: C.gold, valign: "middle", margin: 0 });
    });
  }

  /* ════════ 2. JOUW PLEK IN DE KETEN ════════ */
  {
    const s = p.addSlide();
    head(s, "01", "diagram", "Jouw plek in de keten", "SRS levert de magazijnbasis. De core legt daar élke winkel- en webmutatie realtime overheen. Jij bestuurt de regels.");
    const lx = M, lw = 2.6, cx = 4.25, cw = 4.4, rx = 9.4, rw = 3.23;
    box(s, lx, 2.25, lw, 1.0, { icon: ic.warehouse.navy, title: "SRS", sub: "magazijn (WMS)", fill: C.goldSoft, lineColor: C.gold, fs: 13 });
    box(s, lx, 3.75, lw, 1.0, { icon: ic.truck.navy, title: "Zendingen", sub: "leverancier / winkel", fill: C.goldSoft, lineColor: C.gold, fs: 13 });
    s.addText("bruto voorraad per filiaal", { x: lx, y: 3.28, w: lw, h: 0.28, fontSize: 8.5, italic: true, color: C.slate, align: "center", margin: 0 });
    s.addText("telt pas mee ná de scan", { x: lx, y: 4.78, w: lw, h: 0.28, fontSize: 8.5, italic: true, color: C.slate, align: "center", margin: 0 });
    seg(s, lx + lw + 0.05, 2.75, cx - lx - lw - 0.15, 0.75, C.gold, true);
    seg(s, lx + lw + 0.05, 4.25, cx - lx - lw - 0.15, -0.75, C.gold, true);
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: 2.6, w: cw, h: 1.9, rectRadius: 0.1, fill: { color: C.navy }, shadow: sh(0.2, 10, 3) });
    s.addImage({ data: ic.db.gold, x: cx + cw / 2 - 0.32, y: 2.85, w: 0.64, h: 0.64 });
    s.addText("Voorraad-core", { x: cx, y: 3.55, w: cw, h: 0.4, align: "center", fontFace: "Georgia", fontSize: 19, bold: true, color: "FFFFFF", margin: 0 });
    s.addText("één grootboek · één getal voor iedereen", { x: cx, y: 3.95, w: cw, h: 0.34, align: "center", fontSize: 10.5, color: C.line, margin: 0 });
    const rechts = [["globe", "Website", "belooft levertijd + reserveert"], ["cash", "Kassa", "verkoop, retour, apart leggen"], ["scan", "Handscanner", "picken, ontvangen, tellen"]];
    rechts.forEach((r, i) => {
      const y = 1.95 + i * 1.15;
      box(s, rx, y, rw, 0.9, { icon: ic[r[0]].navy, title: r[1], sub: r[2], lineColor: C.sky, fs: 12.5, subFs: 8.5, shadow: true });
      seg(s, cx + cw + 0.05, 3.55, rx - cx - cw - 0.15, (y + 0.45) - 3.55, C.sky, true);
    });
    band(s, 5.55, { ic: "grid", t: "De portal is jouw stuurhut:", v: "werklijsten (ontvangst, niet leverbaar, retour), dashboards (nauwkeurigheid, miss-rate, drift) en álle instellingen — zonder tussenkomst van een ontwikkelaar.", h: 0.8, fill: C.skySoft, lineColor: C.sky });
    foot(s, "Kassa, site en scanner schrijven naar dezelfde core; jij stelt de regels in waarmee die core rekent.", 2);
  }

  /* ════════ 3. DE FORMULE ════════ */
  {
    const s = p.addSlide();
    head(s, "02", "boxes", "Wat betekent 'beschikbaar'?", "Eén formule, overal hetzelfde — op de site, aan de kassa en op de scanner.");
    const fy = 2.05, bh = 1.05, bw = 2.25, opw = 0.45;
    const terms = [
      { t: "SRS-baseline", s2: "magazijn + winkels", fill: C.goldSoft, ln: C.gold, op: "+" },
      { t: "Kassa-delta", s2: "verkoop / retour / correctie", fill: C.skySoft, ln: C.sky, op: "−" },
      { t: "Web-reservering", s2: "lopende orders + holds", fill: C.skySoft, ln: C.sky, op: "−" },
      { t: "Veiligheids-\nvoorraad", s2: "budget per artikel", fill: C.redSoft, ln: C.red, op: "" },
    ];
    let x = (W - (4 * bw + 3 * opw)) / 2;
    terms.forEach((tm, i) => {
      box(s, x, fy, bw, bh, { title: tm.t, sub: tm.s2, fill: tm.fill, lineColor: tm.ln, fs: 12.5, subFs: 8.5 });
      x += bw;
      if (i < 3) { s.addText(tm.op, { x, y: fy, w: opw, h: bh, align: "center", valign: "middle", fontFace: "Georgia", fontSize: 24, bold: true, color: tm.op === "−" ? C.red : C.emerald, margin: 0 }); x += opw; }
    });
    aDown(s, W / 2, fy + bh + 0.05, 0.4, C.navy);
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M + 1.6, y: 3.6, w: W - 2 * M - 3.2, h: 0.95, rectRadius: 0.1, fill: { color: C.navy }, shadow: sh(0.18, 9, 3) });
    s.addText("BESCHIKBAAR", { x: M + 1.6, y: 3.72, w: W - 2 * M - 3.2, h: 0.4, align: "center", fontFace: "Georgia", fontSize: 18, bold: true, color: C.gold, margin: 0 });
    s.addText("per artikel, per locatie — het getal dat de klant ziet en de kassier verkoopt", { x: M + 1.6, y: 4.1, w: W - 2 * M - 3.2, h: 0.34, align: "center", fontSize: 10.5, color: C.line, margin: 0 });
    const cy = 4.85, cw2 = (W - 2 * M - 2 * 0.35) / 3, chh = 1.5;
    card(s, M, cy, cw2, chh, { ic: "truck", t: "Onderweg telt niet", v: "Een zending die gepickt of onderweg is verhoogt niets. De voorraad ontstaat pas bij de ontvangst-scan — geen fantoomvoorraad." });
    card(s, M + cw2 + 0.35, cy, cw2, chh, { ic: "lock", t: "Nooit dubbel geboekt", v: "Elke mutatie is idempotent op (ref, kanaal, artikel). Een offline kassa die later synchroniseert boekt dezelfde bon niet twee keer." });
    card(s, M + 2 * (cw2 + 0.35), cy, cw2, chh, { ic: "sync", t: "Zelfherstellend", v: "Zodra SRS de mutatie zelf verwerkt heeft, valt de delta uit de som. Een gemiste sync corrigeert bij de volgende ronde." });
    foot(s, "Site, kassa en scanner rekenen niet ieder hun eigen som — ze lezen dezelfde uitkomst.", 3);
  }

  /* ════════ 4. VEILIGHEIDSVOORRAAD ════════ */
  {
    const s = p.addSlide();
    head(s, "03", "shield", "Veiligheidsvoorraad — een budget per artikel", "Niet 2 per maat per winkel, maar 2 stuks per artikel over álle winkels samen.");
    const lw = 6.9;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 1.95, w: lw, h: 2.85, rectRadius: 0.09, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.09, 7, 2) });
    s.addText("Eén artikel = artikelnummer + kleur, met de hele maatboog eronder", { x: M + 0.3, y: 2.1, w: lw - 0.6, h: 0.34, fontSize: 11, bold: true, color: C.navy, margin: 0 });
    const cols = [["Almere · M", "1"], ["Utrecht · L", "1"], ["Breda · L", "3"], ["Zwolle · XL", "4"], ["Magazijn", "12"]];
    const bw = (lw - 0.6 - 4 * 0.14) / 5;
    cols.forEach((c, i) => {
      const x = M + 0.3 + i * (bw + 0.14);
      const vast = i < 2;
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 2.55, w: bw, h: 1.0, rectRadius: 0.07, fill: { color: vast ? C.redSoft : C.mist }, line: { color: vast ? C.red : C.line, width: 1 } });
      s.addText(c[1], { x, y: 2.62, w: bw, h: 0.46, align: "center", fontFace: "Georgia", fontSize: 20, bold: true, color: C.navy, margin: 0 });
      s.addText(c[0], { x, y: 3.08, w: bw, h: 0.4, align: "center", fontSize: 8.5, color: C.slate, margin: 0 });
      if (vast) chip(s, x + 0.1, 3.6, bw - 0.2, "1 vast", C.red, "FFFFFF", 0.26);
    });
    s.addText("Het budget van 2 gaat naar de DUNSTE regels: daar zit het risico (displaystuk, mistelling). De diepte blijft online verkoopbaar.", { x: M + 0.3, y: 4.0, w: lw - 0.6, h: 0.6, fontSize: 10.5, color: C.slate, valign: "top", margin: 0 });
    const rx = M + lw + 0.35, rw = W - M - (M + lw + 0.35);
    const knoppen = [["Winkels", "2", "stuks per artikel"], ["Magazijn", "0", "geen marge nodig"], ["Winkelkanaal", "0", "kassa + onderling"]];
    knoppen.forEach((k, i) => {
      const y = 1.95 + i * 0.75;
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx, y, w: rw, h: 0.62, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 } });
      s.addText(k[0], { x: rx + 0.2, y, w: rw - 1.3, h: 0.62, fontSize: 11, bold: true, color: C.navy, valign: "middle", margin: 0 });
      s.addText(k[1], { x: rx + rw - 1.15, y, w: 0.5, h: 0.62, align: "right", fontFace: "Georgia", fontSize: 17, bold: true, color: C.gold, valign: "middle", margin: 0 });
      s.addText(k[2], { x: rx + 0.2, y: y + 0.3, w: rw - 1.3, h: 0.28, fontSize: 8.5, color: C.slate, valign: "middle", margin: 0 });
    });
    card(s, rx, 4.25, rw, 1.25, { ic: "ban", t: "Tekort-bescherming", v: "Onder haar eigen minimum levert een winkel geen weborder.", fs: 12, vfs: 9.5 });
    band(s, 5.6, { ic: "warn", t: "Waarom dit veranderd is:", v: "de marge werd eerst van élke (winkel, maat)-regel afgetrokken. Dat hield 44.855 van de 55.999 stuks winkelvoorraad vast (80%) en zette 262 producten met voorraad online op uitverkocht.", h: 0.85, fill: C.amberSoft, lineColor: C.amber, fs: 11 });
    foot(s, "Web en winkel hebben een eigen marge: online koop je op afstand, in de winkel heb je het artikel in je handen.", 4);
  }

  /* ════════ 5. TOEWIJZING ════════ */
  {
    const s = p.addSlide();
    head(s, "04", "route", "Wie levert de weborder?", "De toewijzing loopt een vaste ladder af — pas als een stap niet lukt, zakt hij naar de volgende.");
    const lw = 6.9;
    const ladder = [
      ["Compleet vanaf één locatie", "scheelt een tweede pakket en een tweede pickronde"],
      ["Magazijn eerst", "winkelvoorraad bewaren we voor de winkelklant"],
      ["Meerdere kandidaten?", "de locatie met de meeste voorraad wint"],
      ["Niet compleet?", "zo min mogelijk splitsen, magazijn + diepte eerst"],
      ["Open en vóór cutoff", "een dichte winkel of feestdag schuift naar de eerste verzenddag"],
    ];
    ladder.forEach((r, i) => rule(s, M, 1.95 + i * 0.76, lw, i + 1, r[0], "— " + r[1], i === 1 ? C.gold : C.navy));
    const rx = M + lw + 0.35, rw = W - M - (M + lw + 0.35);
    s.addText("En verder houdt hij rekening met", { x: rx, y: 1.9, w: rw, h: 0.3, fontSize: 10.5, bold: true, color: C.navy, margin: 0 });
    const extra = [
      ["tshirt", "Pak-sets blijven bij elkaar"],
      ["ban", "Gepauzeerd filiaal wordt overgeslagen"],
      ["shield", "Onderbevoorrade winkel beschermd"],
      ["globe", "België → bij voorkeur Antwerpen"],
      ["boxes", "Overstock-eerst (optie, uit)"],
    ];
    extra.forEach((e, i) => {
      const y = 2.28 + i * 0.62;
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx, y, w: rw, h: 0.52, rectRadius: 0.07, fill: { color: C.card }, line: { color: C.line, width: 1 } });
      s.addImage({ data: ic[e[0]].gold, x: rx + 0.16, y: y + 0.13, w: 0.26, h: 0.26 });
      s.addText(e[1], { x: rx + 0.52, y, w: rw - 0.65, h: 0.52, fontSize: 9.5, color: C.ink, valign: "middle", margin: 0 });
    });
    band(s, 5.85, { ic: "search", t: "Zelf doorrekenen:", v: "in de portal zie je met “waar gaat deze order heen?” precies welke locatie(s) zouden leveren, hoe hij splitst en welke tekorten er zijn — zonder dat er iets geboekt wordt.", h: 0.78, fill: C.skySoft, lineColor: C.sky });
    foot(s, "Dezelfde ladder bepaalt de levertijd die de klant vooraf te zien krijgt.", 5);
  }

  /* ════════ 6. CUTOFFS & VERZENDDAGEN ════════ */
  {
    const s = p.addSlide();
    head(s, "05", "clock", "Cutoffs, verzenddagen en beloftes", "Eén definitie voedt zowel de belofte aan de klant als de pick-deadline in de winkel.");
    const cw = (W - 2 * M - 0.35) / 2;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 1.95, w: cw, h: 2.5, rectRadius: 0.09, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.09, 7, 2) });
    s.addImage({ data: ic.stopwatch.gold, x: M + 0.26, y: 2.12, w: 0.42, h: 0.42 });
    s.addText("Tot hoe laat kan het weg?", { x: M + 0.82, y: 2.08, w: cw - 1.0, h: 0.5, fontFace: "Georgia", fontSize: 14.5, bold: true, color: C.navy, valign: "middle", margin: 0 });
    const tijden = [["Magazijn", "17:00", "vrijdag 16:00"], ["Winkels", "17:00", "vrijdag 17:00"], ["Per filiaal", "eigen uur", "afwijkende ophaaltijd"], ["Winkel-plafond", "sluitingstijd", "min de overdrachtsmarge"]];
    tijden.forEach((t, i) => {
      const y = 2.7 + i * 0.42;
      s.addText(t[0], { x: M + 0.3, y, w: 2.0, h: 0.38, fontSize: 10.5, bold: true, color: C.navy, valign: "middle", margin: 0 });
      s.addText(t[1], { x: M + 2.3, y, w: 1.5, h: 0.38, fontSize: 10.5, color: C.gold, bold: true, valign: "middle", margin: 0 });
      s.addText(t[2], { x: M + 3.8, y, w: cw - 4.1, h: 0.38, fontSize: 9.5, color: C.slate, valign: "middle", margin: 0 });
    });
    const rx = M + cw + 0.35;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx, y: 1.95, w: cw, h: 2.5, rectRadius: 0.09, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.09, 7, 2) });
    s.addImage({ data: ic.calendar.gold, x: rx + 0.26, y: 2.12, w: 0.42, h: 0.42 });
    s.addText("Op welke dagen vertrekt er iets?", { x: rx + 0.82, y: 2.08, w: cw - 1.0, h: 0.5, fontFace: "Georgia", fontSize: 14.5, bold: true, color: C.navy, valign: "middle", margin: 0 });
    const dagen = [["Zondag", "nee", C.red], ["Zaterdag — winkels", "ja", C.emerald], ["Zaterdag — magazijn", "nee", C.red], ["Feestdagen NL/BE", "automatisch per jaar", C.slate]];
    dagen.forEach((d, i) => {
      const y = 2.7 + i * 0.42;
      s.addText(d[0], { x: rx + 0.3, y, w: 3.2, h: 0.38, fontSize: 10.5, bold: true, color: C.navy, valign: "middle", margin: 0 });
      s.addText(d[1], { x: rx + 3.5, y, w: cw - 3.8, h: 0.38, fontSize: 10, color: d[2], bold: true, valign: "middle", margin: 0 });
    });
    const c3 = (W - 2 * M - 2 * 0.35) / 3;
    card(s, M, 4.6, c3, 1.45, { ic: "flag", t: "Extra sluitingsdagen", v: "Bedrijfssluiting of inventarisatie: zet de datum erbij, dan belooft de site niets.", fs: 12.5, vfs: 9.5 });
    card(s, M + c3 + 0.35, 4.6, c3, 1.45, { ic: "ban", t: "Filiaal pauzeren", v: "Verbouwing of onderbezetting: de winkel krijgt tijdelijk geen orders.", fs: 12.5, vfs: 9.5 });
    card(s, M + 2 * (c3 + 0.35), 4.6, c3, 1.45, { ic: "hourglass", t: "Pick-deadline", v: "De winkel ziet “vandaag 17:00”; oranje onder 2 uur, rood als hij voorbij is.", fs: 12.5, vfs: 9.5 });
    band(s, 6.18, { ic: "warn", t: "Let op:", v: "een te ruime cutoff belooft “vandaag verzonden” op een moment dat er niets meer vertrekt. Zet hier het échte ophaalmoment neer.", h: 0.6, fill: C.amberSoft, lineColor: C.amber, fs: 10.5 });
    foot(s, "Levertijd = verzenddag + transit; uit een winkel rekent hij standaard één dag extra.", 6);
  }

  /* ════════ 7. GOEDERENONTVANGST ════════ */
  {
    const s = p.addSlide();
    head(s, "06", "truck", "Goederenontvangst — scan-to-receive", "Voorraad ontstaat bij de scan, niet bij de pakbon. Onderweg telt bij niemand mee.");
    const ty = 2.0, stepw = 2.55, gap = (W - 2 * M - 4 * stepw) / 3, bh = 1.15;
    const steps = [
      { ic: "tag", t: "Aangemeld", s2: "verwachte regels (ASN)", fill: C.card, ln: C.line, chipT: "gepickt" },
      { ic: "truck", t: "Onderweg", s2: "telt NIET mee", fill: C.amberSoft, ln: C.amber, chipT: "onderweg" },
      { ic: "scan", t: "Scannen", s2: "steekproefplan vastgezet", fill: C.skySoft, ln: C.sky, chipT: "bezig" },
      { ic: "check", t: "Voorraad", s2: "telt NU mee", fill: C.emeraldSoft, ln: C.emerald, chipT: "ontvangen" },
    ];
    steps.forEach((st, i) => {
      const x = M + i * (stepw + gap);
      box(s, x, ty, stepw, bh, { icon: ic[st.ic].navy, title: st.t, sub: st.s2, fill: st.fill, lineColor: st.ln, fs: 13.5 });
      chip(s, x + 0.45, ty + bh + 0.1, stepw - 0.9, st.chipT, st.ln === C.line ? C.slate : st.ln, "FFFFFF");
      if (i < 3) aRight(s, x + stepw + 0.04, ty + bh / 2, gap - 0.08);
    });
    const cw = (W - 2 * M - 0.35) / 2, cy = 3.85;
    card(s, M, cy, cw, 1.5, { ic: "clipboard", t: "Tellen (de normale weg)", v: "Scannen tegen de verwachte regels. Alleen wat écht geteld is wordt geboekt — het ontbrekende stuk wordt nooit toegevoegd. Afwijkingen gaan naar jouw werklijst.", fs: 13.5, vfs: 10 });
    card(s, M + cw + 0.35, cy, cw, 1.5, { ic: "stopwatch", t: "Alles binnenmelden (blind)", v: "Geen tijd om te tellen? Dan boekt hij de verwachte aantallen. Bewust géén afwijkingen: er is niet geteld, dus er is ook geen manco-signaal.", fs: 13.5, vfs: 10 });
    band(s, 5.55, { ic: "ban", t: "Beschadigd of verkeerd geleverd?", v: "Meld het bij de scan. Die stuks gaan in quarantaine — ze worden niet als verkoopbare voorraad geboekt, ook niet bij blind binnenmelden.", h: 0.75, fill: C.redSoft, lineColor: C.red });
    band(s, 6.35, { ic: "sync", t: "Overdracht naar SRS:", v: "de ontvangst-delta overbrugt het gat tot SRS de Receive zelf verwerkt heeft; daarna valt hij uit de som — nooit dubbel geteld.", h: 0.5, fill: C.mist, lineColor: C.line, fs: 10 });
    foot(s, "Dezelfde flow geldt voor magazijn-aanvullingen, leveranciers én winkel-naar-winkel.", 7);
  }

  /* ════════ 8. SLIMME STEEKPROEF ════════ */
  {
    const s = p.addSlide();
    head(s, "07", "search", "De slimme steekproef", "Niet alles tellen, wél altijd het risico tellen — en het systeem leert per leverancier.");
    s.addText("ALTIJD 100% TELLEN BIJ", { x: M, y: 1.8, w: 4, h: 0.3, fontSize: 9.5, bold: true, color: C.navy, charSpacing: 1, margin: 0 });
    const tw = (W - 2 * M - 3 * 0.3) / 4;
    const trig = [["boxes", "Kleine partij", "≤ 20 stuks"], ["flag", "Nieuwe bron", "< 3 ontvangsten"], ["warn", "Bron met manco", "≥ 10% afwijking"], ["euro", "Hoge waarde", "≥ € 150 per stuk"]];
    trig.forEach((t, i) => {
      const x = M + i * (tw + 0.3);
      box(s, x, 2.12, tw, 0.92, { icon: ic[t[0]].navy, title: t[1], sub: t[2], fill: C.goldSoft, lineColor: C.gold, fs: 12, subFs: 9 });
    });
    s.addText("ANDERS — STEEKPROEF", { x: M, y: 3.2, w: 4, h: 0.3, fontSize: 9.5, bold: true, color: C.navy, charSpacing: 1, margin: 0 });
    const hw = (W - 2 * M - 0.35) / 2;
    card(s, M, 3.5, hw, 1.35, { ic: "target", t: "Verplicht: probleemartikelen", v: "Artikelen die in 180 dagen ≥ 2× manco kwamen én in ≥ 15% van de gevallen — die tellen we altijd.", fs: 13, vfs: 10 });
    card(s, M + hw + 0.35, 3.5, hw, 1.35, { ic: "scale", t: "Aanvullen: waarde-gewogen", v: "Tot n = max(8 regels; 1,5 × √regels × bron-vertrouwen), de duurste regels eerst.", fs: 13, vfs: 10 });
    const uy = 4.95, uw = (W - 2 * M - 0.35) / 2;
    box(s, M, uy, uw, 0.8, { icon: ic.check.navy, title: "Weinig afwijkingen → accepteren", sub: "de niet-getelde regels boeken op verwacht", fill: C.emeraldSoft, lineColor: C.emerald, fs: 13, subFs: 9.5 });
    box(s, M + uw + 0.35, uy, uw, 0.8, { icon: ic.warn.navy, title: "Te veel → tel de hele levering", sub: "de zending schiet naar 100%, nog niets geboekt", fill: C.redSoft, lineColor: C.red, fs: 13, subFs: 9.5 });
    s.addText("Grens: 2,5% van de getelde regels (afgerond naar beneden).", { x: M, y: 5.78, w: W - 2 * M, h: 0.3, align: "center", fontSize: 9.5, italic: true, color: C.slate, margin: 0 });
    const ly = 6.15, lw2 = (W - 2 * M - 3 * 0.25) / 4;
    const ladder = [["Nieuw", "alles tellen", C.amber], ["Normaal", "gewone steekproef", C.slate], ["Betrouwbaar", "steekproef × 0,6", C.emerald], ["Aangescherpt", "terug naar 100%", C.red]];
    ladder.forEach((l, i) => {
      const x = M + i * (lw2 + 0.25);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: ly, w: lw2, h: 0.62, rectRadius: 0.08, fill: { color: C.card }, line: { color: l[2], width: 1 } });
      s.addText(l[0], { x: x + 0.14, y: ly + 0.04, w: lw2 - 0.28, h: 0.3, fontSize: 10.5, bold: true, color: C.navy, margin: 0 });
      s.addText(l[1], { x: x + 0.14, y: ly + 0.32, w: lw2 - 0.28, h: 0.26, fontSize: 9, color: C.slate, margin: 0 });
      if (i < 3) s.addText("›", { x: x + lw2 + 0.02, y: ly + 0.1, w: 0.21, h: 0.4, align: "center", fontSize: 14, color: C.gold, margin: 0 });
    });
    foot(s, "Bron-vertrouwen groeit met 10 schone ontvangsten (≤ 2% manco) en zakt bij 10% manco — automatisch.", 8);
  }

  /* ════════ 9. AFWIJKINGEN ════════ */
  {
    const s = p.addSlide();
    head(s, "08", "warn", "Afwijkingen — jouw werklijst", "Elk verschil tussen besteld en geteld komt hier terecht, met de bron erbij.");
    const lw = 6.2;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 1.95, w: lw, h: 2.35, rectRadius: 0.09, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.09, 7, 2) });
    s.addText("Wat er gemeld wordt", { x: M + 0.28, y: 2.08, w: lw - 0.56, h: 0.36, fontFace: "Georgia", fontSize: 14, bold: true, color: C.navy, margin: 0 });
    const codes = [["Tekort", C.red], ["Teveel", C.amber], ["Niet besteld", C.amber], ["Beschadigd", C.red], ["Verkeerd artikel", C.red], ["Kwaliteit", C.amber], ["Verkeerd gelabeld", C.amber]];
    const cwid = (lw - 0.56 - 2 * 0.16) / 3;
    codes.forEach((c, i) => {
      const x = M + 0.28 + (i % 3) * (cwid + 0.16);
      const y = 2.52 + Math.floor(i / 3) * 0.46;
      chip(s, x, y, cwid, c[0], c[1], "FFFFFF", 0.34);
    });
    s.addText("Alleen geverifieerde regels tellen mee — wie blind binnenmeldt, meldt niets.", { x: M + 0.28, y: 3.9, w: lw - 0.56, h: 0.32, fontSize: 9.5, italic: true, color: C.slate, margin: 0 });
    const rx = M + lw + 0.35, rw = W - M - (M + lw + 0.35);
    s.addText("Jij handelt af", { x: rx, y: 1.95, w: rw, h: 0.3, fontSize: 10.5, bold: true, color: C.navy, margin: 0 });
    const flow = [["open", "binnengekomen", C.slate], ["claim ingediend", "bij bron / leverancier", C.sky], ["gecrediteerd", "geld terug ontvangen", C.emerald], ["afgeschreven", "verlies genomen", C.amber], ["opgelost", "verder geen actie", C.emerald]];
    flow.forEach((f, i) => {
      const y = 2.3 + i * 0.48;
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx, y, w: rw, h: 0.4, rectRadius: 0.07, fill: { color: C.card }, line: { color: f[2], width: 1 } });
      s.addText(f[0], { x: rx + 0.16, y, w: 1.9, h: 0.4, fontSize: 10, bold: true, color: C.navy, valign: "middle", margin: 0 });
      s.addText(f[1], { x: rx + 2.0, y, w: rw - 2.16, h: 0.4, fontSize: 9, color: C.slate, valign: "middle", margin: 0 });
    });
    s.addText("Wat het dashboard laat zien (90 dagen)", { x: M, y: 4.5, w: 6, h: 0.3, fontSize: 10.5, bold: true, color: C.navy, margin: 0 });
    const kw = (W - 2 * M - 3 * 0.3) / 4;
    const kpis = [["Nauwkeurigheid per bron", "welke leverancier levert scheef"], ["Nauwkeurigheid per winkel", "waar wordt slordig geteld"], ["Verdeling per code", "tekort, schade, niet besteld"], ["Dock-to-stock", "uren tussen onderweg en geboekt"]];
    kpis.forEach((k, i) => {
      const x = M + i * (kw + 0.3);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: 4.85, w: kw, h: 1.0, rectRadius: 0.08, fill: { color: C.navy }, line: { type: "none" }, shadow: sh(0.14, 8, 2) });
      s.addText(k[0], { x: x + 0.18, y: 4.98, w: kw - 0.36, h: 0.4, fontFace: "Georgia", fontSize: 12, bold: true, color: C.gold, margin: 0 });
      s.addText(k[1], { x: x + 0.18, y: 5.38, w: kw - 0.36, h: 0.4, fontSize: 9, color: C.line, valign: "top", margin: 0 });
    });
    band(s, 6.1, { ic: "sync", t: "Waarom dit dubbel werkt:", v: "elke afgehandelde afwijking voedt ook het manco-profiel — de volgende zending van diezelfde bron wordt automatisch strenger of juist lichter gecontroleerd.", h: 0.72, fill: C.skySoft, lineColor: C.sky });
    foot(s, "Melden kost een tik op de scanner; niet melden kost de claim-termijn bij de leverancier.", 9);
  }

  /* ════════ 10. HERVERDELING ════════ */
  {
    const s = p.addSlide();
    head(s, "09", "exchange", "Herverdeling tussen winkels", "De stuks gaan er bij de bron direct af en komen er bij het doel pas bij de scan bij.");
    const bw = 3.0, y0 = 2.1, bh = 1.05;
    box(s, M, y0, bw, bh, { icon: ic.store.navy, title: "Bronwinkel", sub: "heeft over", fill: C.goldSoft, lineColor: C.gold });
    chip(s, M + 0.5, y0 + bh + 0.12, bw - 1.0, "− 1 direct", C.red, "FFFFFF");
    box(s, M + 4.4, y0, bw, bh, { icon: ic.truck.navy, title: "Onderweg", sub: "rit of DHL", fill: C.amberSoft, lineColor: C.amber });
    chip(s, M + 4.9, y0 + bh + 0.12, bw - 1.0, "telt nergens", C.amber, "FFFFFF");
    box(s, M + 8.8, y0, bw, bh, { icon: ic.store.navy, title: "Doelwinkel", sub: "heeft nodig", fill: C.emeraldSoft, lineColor: C.emerald });
    chip(s, M + 9.3, y0 + bh + 0.12, bw - 1.0, "+ 1 bij de scan", C.emerald, "FFFFFF");
    aRight(s, M + bw + 0.15, y0 + bh / 2, 4.4 - bw - 0.3);
    aRight(s, M + 4.4 + bw + 0.15, y0 + bh / 2, 4.4 - bw - 0.3);
    const cy = 3.95, cw = (W - 2 * M - 2 * 0.3) / 3;
    card(s, M, cy, cw, 1.45, { ic: "shield", t: "Gate op de bron", v: "Heeft de bronwinkel fysiek te weinig? Dan weigert de uitwisseling — anders zou de bron negatief raken en het doel fantoomvoorraad krijgen.", fs: 12.5, vfs: 9.5 });
    card(s, M + cw + 0.3, cy, cw, 1.45, { ic: "scan", t: "Pick-bon met barcode", v: "Bij een aanvraag rolt er een pick-bon uit de kassaprinter van de bronwinkel. Scannen = verstuurd; een tweede scan doet niets.", fs: 12.5, vfs: 9.5 });
    card(s, M + 2 * (cw + 0.3), cy, cw, 1.45, { ic: "route", t: "Rit of DHL?", v: "Zitten beide winkels op dezelfde rit die binnen 4 dagen vertrekt? Dan gratis mee. Anders DHL (± € 7, morgen). Spoed = altijd DHL.", fs: 12.5, vfs: 9.5 });
    band(s, 5.65, { ic: "sliders", t: "Wat jij instelt:", v: "de ritten (naam, welke winkels, welke weekdagen), de DHL-prijs en hoeveel dagen wachten op een rit nog acceptabel is. Zonder ritten adviseert hij altijd DHL.", h: 0.75, fill: C.skySoft, lineColor: C.sky });
    band(s, 6.45, { ic: "boxOpen", t: "Ontvangen gaat via dezelfde scan-to-receive:", v: "de doelwinkel telt of meldt blind binnen — inclusief afwijking als er iets mist.", h: 0.42, fill: C.mist, lineColor: C.line, fs: 10 });
    foot(s, "Overstock in de ene winkel is het tekort van de andere — deze route is jouw goedkoopste inkoop.", 10);
  }

  /* ════════ 11. INVENTARISATIE ════════ */
  {
    const s = p.addSlide();
    head(s, "10", "clipboard", "Inventarisatie", "Jij zet de telling klaar, de winkel telt, jij keurt het verschil goed.");
    const sw = 2.85, gap = (W - 2 * M - 4 * sw) / 3, sy = 2.05, shh = 1.75;
    const st = [
      { n: 1, icon: ic.sliders.navy, title: "Klaarzetten", sub: "alles, productgroep, artikelen of één sectie", lineColor: C.navy, badge: C.navy },
      { n: 2, icon: ic.scan.navy, title: "Tellen", sub: "scannen op de handscanner, met foto en maat", lineColor: C.gold, badge: C.gold },
      { n: 3, icon: ic.list.navy, title: "Afronden", sub: "niet-gescand wordt 0 — het tekort wordt zichtbaar", lineColor: C.gold, badge: C.gold },
      { n: 4, icon: ic.check.navy, title: "Goedkeuren", sub: "verschillen worden als correctie geboekt", lineColor: C.emerald, badge: C.emerald },
    ];
    st.forEach((x, i) => { const px = M + i * (sw + gap); step(s, px, sy, sw, shh, x); if (i < 3) aRight(s, px + sw + 0.04, sy + shh / 2, gap - 0.08); });
    const cy = 4.2, cw = (W - 2 * M - 2 * 0.3) / 3;
    card(s, M, cy, cw, 1.5, { ic: "lock", t: "Apart gelegd telt mee", v: "Wat gereserveerd is of op de paspop staat, wordt niet als “weg” geboekt: de teller ziet het en de zeroing houdt er rekening mee.", fs: 12.5, vfs: 9.5 });
    card(s, M + cw + 0.3, cy, cw, 1.5, { ic: "chart", t: "Overzicht over alle winkels", v: "Afgeronde tellingen wachten op jouw goedkeuring. Historie en zoeken per artikel: wanneer is dit voor het laatst geteld?", fs: 12.5, vfs: 9.5 });
    card(s, M + 2 * (cw + 0.3), cy, cw, 1.5, { ic: "shield", t: "Correctie is idempotent", v: "Twee keer goedkeuren boekt niet twee keer. De correctie staat in hetzelfde grootboek als kassa en web.", fs: 12.5, vfs: 9.5 });
    band(s, 5.95, { ic: "target", t: "Praktisch:", v: "een deeltelling per sectie of productgroep kost een winkel een half uur en levert meer op dan één jaarlijkse telling — zet ze in de weken dat het rustig is.", h: 0.72, fill: C.emeraldSoft, lineColor: C.emerald });
    foot(s, "Een telling verandert pas voorraad nadat jij hem hebt goedgekeurd.", 11);
  }

  /* ════════ 12. NIET LEVERBAAR ════════ */
  {
    const s = p.addSlide();
    head(s, "11", "ban", "Niet leverbaar — de winkel vindt het stuk niet", "Automatisch opgelost waar het kan, met een keuze voor jou waar het niet kan.");
    const lw = 7.6;
    const stappen = [
      ["Fantoom-stuk eraf", "de voorraad van die winkel wordt direct gecorrigeerd, zodat het niet opnieuw verkocht wordt"],
      ["Opnieuw toewijzen", "de order wordt herberekend zónder die winkel — magazijn eerst, anders een andere winkel"],
      ["Lukt dat niet? Make-whole", "annuleren + terugbetalen, of een retour starten voor een al verzonden deel"],
    ];
    stappen.forEach((r, i) => rule(s, M, 2.0 + i * 0.85, lw, i + 1, r[0], "— " + r[1], i === 2 ? C.red : C.navy));
    const rx = M + lw + 0.35, rw = W - M - (M + lw + 0.35);
    card(s, rx, 2.0, rw, 1.3, { ic: "bell", t: "De klant hoort het", v: "Bericht bij annulering + tot 3 alternatieven op maat. Beide zijn aan/uit te zetten.", fs: 12.5, vfs: 9.5 });
    card(s, rx, 3.4, rw, 1.3, { ic: "chart", t: "Miss-rate per winkel", v: "Hoe vaak een winkel niet kon leveren (90 dagen) — een betrouwbaarheidssignaal per filiaal.", fs: 12.5, vfs: 9.5 });
    band(s, 4.85, { ic: "warn", t: "Waarom dit gebeurt:", v: "de systeemvoorraad stond hoger dan het rek. Meestal derving, een verkeerde telling of een stuk dat al bij een klant lag. De correctie is meteen ook de meting.", h: 0.72, fill: C.amberSoft, lineColor: C.amber });
    const iy = 5.75, iw = (W - 2 * M - 2 * 0.3) / 3;
    const idee = [["Structureel hoge miss-rate?", "telling of tekort-bescherming inzetten"], ["Vaak dezelfde artikelen?", "kandidaat voor extra veiligheidsvoorraad"], ["Vaak dezelfde winkel?", "kort pauzeren tot de voorraad klopt"]];
    idee.forEach((t, i) => {
      const x = M + i * (iw + 0.3);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: iy, w: iw, h: 0.72, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 } });
      s.addText(t[0], { x: x + 0.18, y: iy + 0.06, w: iw - 0.36, h: 0.32, fontSize: 10, bold: true, color: C.navy, margin: 0 });
      s.addText(t[1], { x: x + 0.18, y: iy + 0.36, w: iw - 0.36, h: 0.3, fontSize: 9, color: C.slate, margin: 0 });
    });
    foot(s, "Elke melding corrigeert de voorraad én levert een cijfer op waarmee je kunt sturen.", 12);
  }

  /* ════════ 13. RETOUREN ════════ */
  {
    const s = p.addSlide();
    head(s, "12", "undo", "Retouren — terug de voorraad in", "De klant regelt het zelf; jouw werk begint als de goederen fysiek binnen zijn.");
    const cw = 2.18, gap = (W - 2 * M - 5 * cw) / 4, ry = 2.0, ch = 1.55;
    const R = [
      { n: 1, icon: ic.undo.navy, title: "Aanmelden", sub: "in het account of retourportaal", lineColor: C.sky, badge: C.sky },
      { n: 2, icon: ic.route.navy, title: "Methode", sub: "DHL-label of naar de winkel", lineColor: C.sky, badge: C.sky },
      { n: 3, icon: ic.truck.navy, title: "Terug", sub: "onderweg of ingeleverd", lineColor: C.gold, badge: C.gold },
      { n: 4, icon: ic.clipboard.navy, title: "Ontvangen", sub: "controle + terugbetaling", lineColor: C.gold, badge: C.gold },
      { n: 5, icon: ic.boxes.navy, title: "Terug in voorraad", sub: "jouw afvinklijst", lineColor: C.emerald, badge: C.emerald },
    ];
    R.forEach((r, i) => { const x = M + i * (cw + gap); step(s, x, ry, cw, ch, r); if (i < 4) aRight(s, x + cw + 0.04, ry + ch / 2, gap - 0.08, C.slate); });
    const cy = 3.85, cwid = (W - 2 * M - 2 * 0.3) / 3;
    card(s, M, cy, cwid, 1.5, { ic: "list", t: "Werklijst “terug te scannen”", v: "Retouren die binnen zijn maar nog niet fysiek in SRS geboekt. Afvinken zodra het stuk terug hangt — telt idempotent.", fs: 12.5, vfs: 9.5 });
    card(s, M + cwid + 0.3, cy, cwid, 1.5, { ic: "warn", t: "Retoursignalen", v: "Een artikel dat ≥ 3× terugkomt, in ≥ 30% van de verkopen én gemiddeld binnen 7 dagen: meestal een maat- of kwaliteitsprobleem.", fs: 12.5, vfs: 9.5 });
    card(s, M + 2 * (cwid + 0.3), cy, cwid, 1.5, { ic: "euro", t: "Wat het kost", v: "14 dagen bedenktijd. Geld terug: € 4,99 retourkosten. Kiest de klant tegoed, dan is de retour gratis — dat houdt de omzet binnen.", fs: 12.5, vfs: 9.5 });
    band(s, 5.6, { ic: "store", t: "In de winkel ingeleverd?", v: "de kassa ziet vooraf welke retouren onderweg zijn naar dat filiaal, verwerkt de terugbetaling en boekt het stuk in dezelfde core terug.", h: 0.75, fill: C.skySoft, lineColor: C.sky });
    foot(s, "Signalen uit retouren horen terug te komen in inkoop: maatverdeling, pasvorm en kwaliteit.", 13);
  }

  /* ════════ 14. KASSA · SITE · PORTAL ════════ */
  {
    const s = p.addSlide();
    head(s, "13", "grid", "Wat kassa, website en portal jou opleveren", "Drie schermen, één keten — dit is wat er voor jouw afdeling uit komt.");
    const cw = (W - 2 * M - 2 * 0.35) / 3, cy = 1.95, chh = 4.05;
    const kolommen = [
      { ic: "cash", t: "De kassa", kleur: C.gold, items: ["Elke verkoop, retour en correctie is direct een voorraadmutatie", "Werkt door bij storing en synchroniseert daarna — nooit dubbel", "Bestel voor de klant: bezorgen of afhalen in een ander filiaal", "Reserveren / apart leggen houdt voorraad hard vast (2 uur)", "Paspop-markering: zichtbaar apart, blijft verkoopbaar", "Dagafsluiting met btw-uitsplitsing en kasstaat"] },
      { ic: "globe", t: "De website", kleur: C.sky, items: ["Toont het netto beschikbare getal, niet de bruto SRS-stand", "Zet bij het afrekenen een harde claim op de voorraad", "Belooft levertijd op basis van jouw cutoffs en verzenddagen", "Click & collect en afhalen in een gekozen filiaal", "Terug-op-voorraad-meldingen = vraagsignaal per maat", "Levert de order met een kant-en-klaar toewijzingsplan"] },
      { ic: "grid", t: "De portal", kleur: C.navy2, items: ["Ontvangst-afwijkingen afhandelen (claim, credit, afschrijven)", "Niet-leverbaar-meldingen en miss-rate per winkel", "Retouren die terug de voorraad in moeten", "Inventarisaties klaarzetten en goedkeuren", "Order doorrekenen: waar zou hij vandaan komen?", "Alle instellingen van de volgende twee slides"] },
    ];
    kolommen.forEach((k, i) => {
      const x = M + i * (cw + 0.35);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: cy, w: cw, h: chh, rectRadius: 0.09, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.1, 8, 2) });
      s.addShape(p.shapes.OVAL, { x: x + 0.28, y: cy + 0.26, w: 0.6, h: 0.6, fill: { color: k.kleur }, line: { type: "none" } });
      s.addImage({ data: ic[k.ic].white, x: x + 0.42, y: cy + 0.4, w: 0.32, h: 0.32 });
      s.addText(k.t, { x: x + 1.0, y: cy + 0.26, w: cw - 1.2, h: 0.6, fontFace: "Georgia", fontSize: 17, bold: true, color: C.navy, valign: "middle", margin: 0 });
      s.addShape(p.shapes.LINE, { x: x + 0.28, y: cy + 1.02, w: cw - 0.56, h: 0, line: { color: C.line, width: 1 } });
      s.addText(k.items.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 14 }, color: C.ink, breakLine: true, paraSpaceAfter: 6 } })), { x: x + 0.28, y: cy + 1.15, w: cw - 0.56, h: chh - 1.3, fontSize: 10, valign: "top" });
    });
    band(s, 6.2, { ic: "db", t: "Alle drie schrijven naar hetzelfde grootboek:", v: "wat de kassa verkoopt ziet de site meteen, en wat de site reserveert ziet de winkel meteen.", h: 0.62, fill: C.mist, lineColor: C.line, fs: 11 });
    foot(s, "Geen exports, geen tussenbestanden, geen “welk systeem heeft gelijk?”.", 14);
  }

  /* ════════ 15. INSTELLINGEN 1/2 ════════ */
  {
    const s = p.addSlide();
    head(s, "14", "sliders", "Wat jij instelt — voorraad en levering", "Geen ontwikkelaar nodig: dit staat in de portal en werkt binnen een halve minuut door.");
    table(s, 1.9,
      [{ t: "Instelling", w: 3.5 }, { t: "Nu", w: 2.3 }, { t: "Wat het doet", w: 6.13 }],
      [
        ["Veiligheidsvoorraad winkels", "2 stuks", "Per artikel over álle winkels samen — die stuks verkoopt de site niet"],
        ["Veiligheidsvoorraad magazijn", "0", "Zelfde soort budget, maar over de magazijnlocaties"],
        ["Marge winkelkanaal", "0", "Kassa en winkels onderling: de verkoper heeft het artikel in handen"],
        ["Onderbevoorrade winkel beschermen", "aan", "Winkel met een tekort levert geen weborder — tenzij als laatste redmiddel"],
        ["Overstock eerst versturen", "uit (vanaf 3 over)", "Laat een winkel die ruim boven haar ideaal zit vóór het magazijn leveren"],
        ["Gepauzeerde filialen", "geen", "Verbouwing, vakantie of onderbezetting: tijdelijk geen orders toewijzen"],
        ["Extra sluitingsdagen", "geen", "Bedrijfssluiting of inventarisatie: die dag vertrekt er niets"],
        ["Cutoff magazijn / winkels", "17:00 (vr 16:00 / 17:00)", "Laatste moment dat een pakket vandaag nog de deur uit kan"],
        ["Overdrachtsmarge winkel", "0 minuten", "Zoveel eerder dan sluitingstijd sluit de winkel-cutoff (inpakken)"],
        ["Verzenden zaterdag / zondag", "winkels ja / nee", "Vervoerders halen op zondag niet op; magazijn werkt door de week"],
        ["Levertijd standaard", "2–3 werkdagen", "Belofte op de site; uit een winkel rekent hij één dag extra"],
      ], 0.35);
    band(s, 6.3, { ic: "grid", t: "Waar:", v: "portal → Nieuwe site → Instellingen. Alles hierboven is business-logica, geen code — daarom staat het bewust niet in de serverconfiguratie.", h: 0.45, fill: C.skySoft, lineColor: C.sky, fs: 10 });
    foot(s, "Eén wijziging werkt tegelijk door op de site, in de kassa en op de scanner.", 15);
  }

  /* ════════ 16. INSTELLINGEN 2/2 ════════ */
  {
    const s = p.addSlide();
    head(s, "15", "sliders", "Wat jij instelt — ontvangst en logistiek", "De strengheid van de controle is een knop, geen aanname.");
    table(s, 1.9,
      [{ t: "Instelling", w: 3.5 }, { t: "Nu", w: 2.3 }, { t: "Wat het doet", w: 6.13 }],
      [
        ["Toegestane afwijking (AQL)", "2,5%", "Welk deel van de getelde regels mag afwijken vóór de levering wordt afgekeurd"],
        ["Minimale steekproef", "8 regels", "Ondergrens, ook als de levering klein is"],
        ["Kleine partij → alles tellen", "≤ 20 stuks", "Onder deze grens is steekproeven zinloos: gewoon alles tellen"],
        ["Hoge waarde → alles tellen", "≥ € 150 per stuk", "Pakken en colberts nooit steekproefsgewijs binnenmelden"],
        ["Nieuwe bron → alles tellen", "< 3 ontvangsten", "Eerst leren hoe nauwkeurig deze bron levert"],
        ["Bron aanscherpen", "≥ 10% manco", "Terug naar 100% tellen; na 10 schone ontvangsten juist een kleinere steekproef"],
        ["Probleemartikel", "≥ 2× manco én ≥ 15%", "Dit artikel wordt in elke zending verplicht meegeteld"],
        ["Manco-venster", "180 dagen", "Hoe ver de ontvangst-historie meetelt in het profiel"],
      ], 0.36);
    const cw = (W - 2 * M - 3 * 0.28) / 4, cy = 5.45;
    const kaarten = [
      { ic: "route", t: "Ritten & DHL", v: "Geen ritten ingesteld → advies is altijd DHL (± € 7)." },
      { ic: "lock", t: "Reservering", v: "2 uur vasthouden — winkel én online." },
      { ic: "undo", t: "Retour", v: "14 dagen bedenktijd, € 4,99 bij geld terug, gratis bij tegoed." },
      { ic: "bell", t: "Meldingen aan onszelf", v: "Wie de nachtelijke bewaking krijgt. Leeg = niemand." },
    ];
    kaarten.forEach((k, i) => card(s, M + i * (cw + 0.28), cy, cw, 1.3, { ...k, fs: 11.5, vfs: 9 }));
    foot(s, "Ontvangst-, rit- en reserveringsinstellingen staan op hun eigen kaart in de portal; de rest onder Instellingen.", 16);
  }

  /* ════════ 17. RITME ════════ */
  {
    const s = p.addSlide();
    head(s, "16", "calendar", "Jouw ritme", "Wat je dagelijks afvinkt, wat wekelijks loont en waar je per maand op stuurt.");
    const cw = (W - 2 * M - 2 * 0.35) / 3, cy = 1.95, chh = 4.3;
    const kol = [
      { t: "Elke dag", kleur: C.gold, ic: "clock", items: ["Open zendingen ontvangen en afsluiten", "Nieuwe ontvangst-afwijkingen afhandelen", "Niet-leverbaar-meldingen oplossen", "Retouren afvinken die terug de voorraad in gaan", "Pick-deadlines: staat er iets op rood?"] },
      { t: "Elke week", kleur: C.sky, ic: "list", items: ["Deeltelling klaarzetten en goedgekeurde tellingen verwerken", "Herverdelen: overstock in de ene winkel, tekort in de andere", "Miss-rate per winkel bekijken", "Openstaande claims bij leveranciers nalopen", "Terug-op-voorraad-aanvragen als vraagsignaal lezen"] },
      { t: "Elke maand", kleur: C.navy2, ic: "chart", items: ["Nauwkeurigheid per bron — input voor het leveranciersgesprek", "Dock-to-stock: hoe lang staat een zending stil?", "Retoursignalen doorgeven aan inkoop (maat, pasvorm, kwaliteit)", "Drempels bijstellen: veiligheidsvoorraad, AQL, ritten", "Cutoffs herijken rond feestdagen en koopavonden"] },
    ];
    kol.forEach((k, i) => {
      const x = M + i * (cw + 0.35);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: cy, w: cw, h: chh, rectRadius: 0.09, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.1, 8, 2) });
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: cy, w: cw, h: 0.82, rectRadius: 0.09, fill: { color: k.kleur }, line: { type: "none" } });
      s.addImage({ data: ic[k.ic].white, x: x + 0.28, y: cy + 0.22, w: 0.38, h: 0.38 });
      s.addText(k.t, { x: x + 0.8, y: cy, w: cw - 1.0, h: 0.82, fontFace: "Georgia", fontSize: 17, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
      s.addText(k.items.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 14 }, color: C.ink, breakLine: true, paraSpaceAfter: 8 } })), { x: x + 0.28, y: cy + 1.0, w: cw - 0.56, h: chh - 1.15, fontSize: 10.5, valign: "top" });
    });
    band(s, 6.4, { ic: "target", t: "Vuistregel:", v: "alles wat je dagelijks afvinkt kost minuten; alles wat blijft liggen kost voorraad, claim-termijn of een teleurgestelde klant.", h: 0.45, fill: C.emeraldSoft, lineColor: C.emerald, fs: 10 });
    foot(s, "De werklijsten in de portal staan in deze volgorde — bovenaan wat vandaag moet.", 17);
  }

  /* ════════ 18. BEWAKING ════════ */
  {
    const s = p.addSlide();
    head(s, "17", "bell", "Bewaking die vanzelf draait", "Een aantal controles loopt op de achtergrond en meldt zich alleen als er iets is.");
    const cw = (W - 2 * M - 0.35) / 2, cy = 1.95, chh = 1.5;
    const jobs = [
      { ic: "hourglass", t: "Elke 10 minuten", v: "Verlopen reserveringen worden vrijgegeven en de anti-oversell-teller wordt herijkt op de werkelijke claims." },
      { ic: "bell", t: "Elke 4 uur", v: "Klanten die op een uitverkochte maat wachten krijgen bericht zodra hij terug is — of na 14 dagen een alternatief." },
      { ic: "shield", t: "Elke nacht om 05:30", v: "Kassabon-bewaking: ontbrekende bonnen in de dagstaat, of meer geretourneerd dan verkocht. Schone stand = geen mail." },
      { ic: "sync", t: "Elke 4 uur", v: "Catalogus-synchronisatie: nieuwe en gewijzigde artikelen, zodat scannen en zoeken het artikel kennen." },
    ];
    jobs.forEach((j, i) => card(s, M + (i % 2) * (cw + 0.35), cy + Math.floor(i / 2) * (chh + 0.3), cw, chh, { ...j, fs: 13.5, vfs: 10 }));
    band(s, 5.3, { ic: "chart", t: "Zelf meekijken:", v: "de portal toont de drift-monitor van de voorraadreserveringen — hoe vaak en hoeveel de teller wegliep van de werkelijke claims. Loopt die op, dan is dat een signaal, geen ruis.", h: 0.75, fill: C.skySoft, lineColor: C.sky });
    band(s, 6.2, { ic: "warn", t: "Belangrijk:", v: "de bewaking mailt naar de adressen die bij “Meldingen aan onszelf” staan. Staat daar niemand, dan blijft de melding onopgemerkt in het logboek staan.", h: 0.62, fill: C.amberSoft, lineColor: C.amber, fs: 11 });
    foot(s, "Stil is goed nieuws: er wordt alleen gemaild als er daadwerkelijk iets afwijkt.", 18);
  }

  /* ════════ 19. GRENZEN ════════ */
  {
    const s = p.addSlide();
    head(s, "18", "wrench", "Grenzen en wat er nog komt", "Eerlijk over wat er vandaag niet in zit — zodat niemand ernaar zoekt.");
    const cw = (W - 2 * M - 0.35) / 2, cy = 1.95, chh = 1.65;
    const items = [
      { ic: "warehouse", t: "SRS blijft het magazijnsysteem", v: "Er gaat géén weborder naar SRS. Onze ontvangst-mutatie overbrugt het gat tot SRS de ontvangst zelf heeft verwerkt; dat overdrachtsmoment toetsen we vóór livegang." },
      { ic: "cash", t: "Pinnen aan de kassa", v: "De pinbetaling loopt nog via de bestaande terminal, los van de kassasoftware. Integratie vraagt een keuze in terminal en betaalprovider." },
      { ic: "tag", t: "Catalogus en prijzen", v: "De kassa werkt nog met SRS-artikeldata, de site met de eigen catalogus. De vóórraad is wél gedeeld; het samenvoegen van artikeldata staat op de routekaart." },
      { ic: "db", t: "Voorraad elke 5 minuten", v: "De vijf-minuten-delta uit SRS loopt al mee in een schaduwtabel. Pas als die exact gelijk loopt aan de huidige bron schakelen we over." },
    ];
    items.forEach((it, i) => card(s, M + (i % 2) * (cw + 0.35), cy + Math.floor(i / 2) * (chh + 0.3), cw, chh, { ...it, fs: 13.5, vfs: 10 }));
    band(s, 5.6, { ic: "check", t: "Wat wél al leeft:", v: "de gedeelde voorraad, de toewijzing, scan-to-receive met steekproef, herverdeling, inventarisatie, niet-leverbaar en de retour-werklijst — inclusief de bijbehorende dashboards.", h: 0.8, fill: C.emeraldSoft, lineColor: C.emerald });
    foot(s, "Alles op deze slide is bekend en gepland — geen verrassingen in de winkel.", 19);
  }

  /* ════════ 20. SLOT — VIJF SPELREGELS ════════ */
  {
    const s = p.addSlide(); s.background = { color: C.navy };
    s.addShape(p.shapes.OVAL, { x: W - 3.6, y: -1.6, w: 5.2, h: 5.2, fill: { color: C.navy2 } });
    s.addText("De kern", { x: M, y: 0.7, w: 6, h: 0.4, fontSize: 13, color: C.gold, charSpacing: 3 });
    s.addText("Vijf spelregels voor de hele keten", { x: M, y: 1.15, w: 11.8, h: 0.9, fontFace: "Georgia", fontSize: 32, color: "FFFFFF", bold: true });
    const regels = [
      ["Voorraad ontstaat bij de scan", "niet bij de pakbon en niet bij het versturen"],
      ["Onderweg telt bij niemand mee", "de bron is 'm kwijt, het doel heeft 'm nog niet"],
      ["Wat je niet telt, kun je niet claimen", "blind binnenmelden is een keuze, geen meting"],
      ["Dubbel boeken kan niet", "elke mutatie is idempotent — ook na een storing"],
      ["De knoppen staan in de portal", "business-regels horen niet in code te zitten"],
    ];
    regels.forEach((r, i) => {
      const y = 2.35 + i * 0.78;
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y, w: W - 2 * M, h: 0.66, rectRadius: 0.09, fill: { color: C.navy2 }, line: { type: "none" } });
      s.addShape(p.shapes.OVAL, { x: M + 0.18, y: y + 0.13, w: 0.4, h: 0.4, fill: { color: C.gold }, line: { type: "none" } });
      s.addText(String(i + 1), { x: M + 0.18, y: y + 0.13, w: 0.4, h: 0.4, align: "center", valign: "middle", fontFace: "Georgia", fontSize: 14, bold: true, color: C.navy, margin: 0 });
      s.addText([{ text: r[0] + "  ", options: { bold: true, color: "FFFFFF", fontSize: 14 } }, { text: "— " + r[1], options: { color: C.line, fontSize: 12 } }], { x: M + 0.75, y, w: W - 2 * M - 1.0, h: 0.66, valign: "middle", margin: 0 });
    });
    s.addText("GENTS — SUITS YOU", { x: M, y: 6.75, w: 6, h: 0.4, fontFace: "Georgia", fontSize: 13, color: C.gold, charSpacing: 4 });
    s.addText("Vragen of iets dat anders moet? Zeg het — de meeste regels op deze slides zijn een instelling.", { x: W - 8.2, y: 6.75, w: 7.5, h: 0.4, align: "right", fontSize: 10.5, color: C.line, valign: "middle" });
  }

  const out = path.join(__dirname, "GENTS-supplychain.pptx");
  await p.writeFile({ fileName: out });
  console.log("WRITTEN", out);
}
main().catch((e) => { console.error(e); process.exit(1); });
