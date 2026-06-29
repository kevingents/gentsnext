/* GENTS — MT-presentatie (visueel, diagram-first, uitgebreid). LAYOUT WIDE 13.33 x 7.5". */
const Pptx = require("pptxgenjs");
const { C, icon, shadow } = require("./lib.cjs");
const FA = require("react-icons/fa");
const path = require("path");

const W = 13.33, H = 7.5, M = 0.7;

async function main() {
  const p = new Pptx();
  p.defineLayout({ name: "G", width: W, height: H }); p.layout = "G";
  p.author = "GENTS"; p.title = "GENTS — De nieuwe omnichannel-stack";

  // ── icoon-cache ──
  const ic = {};
  const need = {
    diagram: FA.FaProjectDiagram, globe: FA.FaGlobe, cash: FA.FaCashRegister, scan: FA.FaBarcode,
    boxes: FA.FaBoxes, grid: FA.FaThLarge, brain: FA.FaBrain, shield: FA.FaShieldAlt,
    cart: FA.FaShoppingCart, store: FA.FaStore, phone: FA.FaMobileAlt, db: FA.FaDatabase,
    warehouse: FA.FaWarehouse, truck: FA.FaTruck, users: FA.FaUsers, check: FA.FaCheckCircle,
    box: FA.FaBox, lock: FA.FaLock, chart: FA.FaChartLine, sync: FA.FaSync, warn: FA.FaExclamationTriangle,
    star: FA.FaStar, pen: FA.FaPenFancy, book: FA.FaBookOpen, image: FA.FaImage, tie: FA.FaUserTie,
    ruler: FA.FaRulerCombined, puzzle: FA.FaPuzzlePiece, search: FA.FaSearchPlus, tag: FA.FaTags,
    card: FA.FaCreditCard, ship: FA.FaShippingFast, exchange: FA.FaExchangeAlt, route: FA.FaRoute,
    clipboard: FA.FaClipboardCheck, wallet: FA.FaWallet, home: FA.FaHome, hand: FA.FaHandHoldingUsd,
    coins: FA.FaCoins, redo: FA.FaRedo, euro: FA.FaEuroSign,
  };
  for (const [k, Comp] of Object.entries(need)) ic[k] = { gold: await icon(Comp, "#" + C.gold), navy: await icon(Comp, "#" + C.navy), white: await icon(Comp, "#FFFFFF"), slate: await icon(Comp, "#" + C.slate) };

  // ── helpers ──
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
  function chip(s, x, y, w, t, fill, color) { s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h: 0.3, rectRadius: 0.15, fill: { color: fill }, line: { type: "none" } }); s.addText(t, { x, y, w, h: 0.3, align: "center", valign: "middle", fontSize: 8.5, bold: true, color, margin: 0 }); }
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
    s.addText([{ text: "Samenwerking:  ", options: { bold: true, color: C.navy } }, { text: txt, options: { color: C.slate } }], { x: M, y: H - 0.52, w: W - 2 * M - 1.4, h: 0.38, fontSize: 10, valign: "middle" });
    s.addText(`GENTS · vertrouwelijk · ${page}`, { x: W - 2.9, y: H - 0.4, w: 2.2, h: 0.3, align: "right", fontSize: 8.5, color: C.slate });
  }
  function bullets(s, x, y, w, arr, fs = 12.5) { s.addText(arr.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 16 }, color: C.ink, breakLine: true, paraSpaceAfter: 7 } })), { x, y, w, h: 4.2, fontSize: fs, valign: "top" }); }
  function legend(s, x, y, items) { let lx = x; items.forEach((it) => { s.addShape(p.shapes.OVAL, { x: lx, y: y + 0.04, w: 0.16, h: 0.16, fill: { color: it[1] }, line: { type: "none" } }); s.addText(it[0], { x: lx + 0.22, y: y - 0.04, w: 1.7, h: 0.32, fontSize: 9.5, color: C.slate, valign: "middle", margin: 0 }); lx += 0.28 + 0.105 * it[0].length; }); }

  /* ════════ 1. TITEL ════════ */
  {
    const s = p.addSlide(); s.background = { color: C.navy };
    s.addShape(p.shapes.OVAL, { x: W - 4.8, y: -2.4, w: 6.5, h: 6.5, fill: { color: C.navy2 } });
    s.addShape(p.shapes.OVAL, { x: W - 2.2, y: 4.6, w: 3, h: 3, fill: { color: "1B2E50" } });
    s.addText("GENTS", { x: M, y: 1.25, w: 6, h: 0.7, fontFace: "Georgia", fontSize: 30, color: C.gold, charSpacing: 8, bold: true });
    s.addText("SUITS YOU", { x: M, y: 1.85, w: 6, h: 0.4, fontSize: 12, color: "FFFFFF", charSpacing: 6 });
    s.addText("De nieuwe omnichannel-stack", { x: M, y: 2.75, w: 11.6, h: 1.0, fontFace: "Georgia", fontSize: 40, color: "FFFFFF", bold: true });
    s.addText("Hoe site, kassa, handscanner, voorraad en portal samen één eigen platform vormen.", { x: M, y: 3.95, w: 10.8, h: 0.6, fontSize: 15, color: C.line });
    s.addText("Managementteam-presentatie", { x: M, y: 5.05, w: 8, h: 0.4, fontSize: 13, color: C.gold, charSpacing: 2 });
    const fy = 6.5, items = [["globe", "Site"], ["cash", "Kassa"], ["scan", "Scanner"], ["db", "Voorraad"], ["grid", "Portal"]];
    let fx = M;
    items.forEach((it, i) => { s.addImage({ data: ic[it[0]].gold, x: fx, y: fy, w: 0.3, h: 0.3 }); s.addText(it[1], { x: fx + 0.36, y: fy - 0.04, w: 1.3, h: 0.38, fontSize: 12, color: "FFFFFF", valign: "middle", margin: 0 }); fx += 1.55; if (i < items.length - 1) s.addText("›", { x: fx - 0.35, y: fy - 0.06, w: 0.3, h: 0.4, fontSize: 16, color: C.gold, valign: "middle", margin: 0 }); });
  }

  /* ════════ 2. OVERZICHT — hub & spoke ════════ */
  {
    const s = p.addSlide();
    head(s, "01", "diagram", "Alles draait om één centrale database", "Elk systeem leest en schrijft naar dezelfde bron — geen losse eilanden, geen dubbele data.");
    const cx = 6.66, cy = 4.2, rx = 4.55, ry = 1.85;
    const spokes = [
      ["globe", "Website", C.sky], ["card", "Mollie betaling", C.sky], ["ship", "Verzending / DHL", C.gold],
      ["warehouse", "SRS magazijn", C.gold], ["cash", "Kassa", C.gold], ["scan", "Handscanner", C.gold],
      ["grid", "Portal", C.navy2], ["brain", "AI-functies", C.navy2],
    ];
    const pos = spokes.map((_, i) => { const a = (Math.PI / 2) - i * (2 * Math.PI / 8); return [cx + rx * Math.cos(a), cy - ry * Math.sin(a)]; });
    pos.forEach(([px, py]) => seg(s, cx, cy, px - cx, py - cy, C.line, false));
    s.addShape(p.shapes.OVAL, { x: cx - 1.5, y: cy - 0.95, w: 3.0, h: 1.9, fill: { color: C.navy }, shadow: sh(0.22, 12, 4) });
    s.addImage({ data: ic.db.gold, x: cx - 0.32, y: cy - 0.62, w: 0.64, h: 0.64 });
    s.addText("Centrale database", { x: cx - 1.4, y: cy + 0.08, w: 2.8, h: 0.34, align: "center", fontFace: "Georgia", fontSize: 14, bold: true, color: "FFFFFF", margin: 0 });
    s.addText("voorraad-core · één waarheid", { x: cx - 1.4, y: cy + 0.42, w: 2.8, h: 0.3, align: "center", fontSize: 9.5, color: C.line, margin: 0 });
    spokes.forEach((sp, i) => { const [px, py] = pos[i]; const bw = 1.95, bh = 0.7; box(s, px - bw / 2, py - bh / 2, bw, bh, { icon: ic[sp[0]].navy, title: sp[1], fs: 11.5, lineColor: sp[2], shadow: true }); });
    foot(s, "Eén bron betekent: wat de winkel verkoopt ziet de site direct, en omgekeerd.", 2);
  }

  /* ════════ 3. ARCHITECTUUR (lagen) ════════ */
  {
    const s = p.addSlide();
    head(s, "02", "diagram", "Architectuur — drie systemen, één fundament", "Eigen site, portal en backend; geen Shopify-afhankelijkheid meer.");
    const top = [["globe", "Website gents.nl", "klant koopt online"], ["cash", "Kassa", "verkoop in de winkel"], ["scan", "Handscanner", "winkelmedewerker"]];
    const cw = 2.7, cgap = 0.55, cx0 = 3.0, cy = 1.95;
    top.forEach((t, i) => { const x = cx0 + i * (cw + cgap); box(s, x, cy, cw, 0.95, { icon: ic[t[0]].navy, title: t[1], sub: t[2], shadow: true, fs: 12.5 }); aDown(s, x + cw / 2, cy + 0.95, 0.5); });
    const corey = 3.55, corex = 3.0, corew = 3 * cw + 2 * cgap;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: corex, y: corey, w: corew, h: 1.15, rectRadius: 0.1, fill: { color: C.navy }, shadow: sh(0.18, 9, 3) });
    s.addImage({ data: ic.db.gold, x: corex + 0.3, y: corey + 0.36, w: 0.46, h: 0.46 });
    s.addText("Eén voorraad-core op de centrale database (Neon)", { x: corex + 0.95, y: corey + 0.14, w: corew - 1.2, h: 0.5, fontFace: "Georgia", fontSize: 16, bold: true, color: "FFFFFF", valign: "bottom", margin: 0 });
    s.addText("Catalogus · orders · voorraad · klanten · audit", { x: corex + 0.95, y: corey + 0.62, w: corew - 1.2, h: 0.4, fontSize: 10.5, color: C.line, margin: 0 });
    box(s, M, corey, 1.95, 1.15, { icon: ic.warehouse.navy, title: "SRS", sub: "magazijn (WMS)", fill: C.goldSoft, lineColor: C.gold });
    aRight(s, M + 1.95, corey + 0.58, corex - (M + 1.95));
    s.addText("magazijn-voorraad · 3×/dag", { x: M + 0.05, y: corey - 0.34, w: 3.0, h: 0.3, fontSize: 9, italic: true, color: C.slate });
    aDown(s, corex + corew / 2, corey + 1.15, 0.45);
    const oy = 5.6;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: oy, w: W - 2 * M, h: 0.78, rectRadius: 0.09, fill: { color: C.emeraldSoft }, line: { color: C.emerald, width: 1 } });
    s.addImage({ data: ic.check.navy, x: M + 0.25, y: oy + 0.2, w: 0.38, h: 0.38 });
    s.addText([{ text: "Real-time beschikbaarheid: ", options: { bold: true, color: C.navy } }, { text: "site, kassa én scanner zien altijd hetzelfde — nul oversell.", options: { color: C.ink } }], { x: M + 0.8, y: oy, w: W - 2 * M - 1, h: 0.78, fontSize: 13, valign: "middle", margin: 0 });
    foot(s, "Elk systeem hieronder schrijft naar dezelfde voorraad-core.", 3);
  }

  /* ════════ 4. ORDER TOT LEVERING (snake-flow) ════════ */
  {
    const s = p.addSlide();
    head(s, "03", "route", "Van bestelling tot levering", "De complete weborder-reis — betaling, slimme toewijzing, pick-scan en bezorgen of afhalen.");
    legend(s, M, 1.78, [["Klant", C.sky], ["Systeem", C.navy], ["Winkel / magazijn", C.gold]]);
    const cw = 3.55, gap = (W - 2 * M - 3 * cw) / 2, r1 = 2.35, r2 = 4.55, ch = 1.7;
    const xcol = [M, M + cw + gap, M + 2 * (cw + gap)];
    const S = [
      { n: 1, icon: ic.cart.navy, title: "Bestellen", sub: "Klant kiest op gents.nl: bezorgen of afhalen", lineColor: C.sky, badge: C.sky, x: xcol[0], y: r1 },
      { n: 2, icon: ic.card.navy, title: "Betalen (Mollie)", sub: "Betaling → order vastgelegd in de database", lineColor: C.navy, badge: C.navy, x: xcol[1], y: r1 },
      { n: 3, icon: ic.sync.navy, title: "Slimme toewijzing", sub: "Magazijn-eerst, anders winkel — kan splitsen", lineColor: C.navy, badge: C.navy, x: xcol[2], y: r1 },
      { n: 4, icon: ic.scan.navy, title: "Pick + scan", sub: "Handscanner: picken met scan-controle", lineColor: C.gold, badge: C.gold, x: xcol[2], y: r2 },
      { n: 5, icon: ic.ship.navy, title: "Verzenden / afhalen", sub: "DHL-label óf klaarzetten in de winkel", lineColor: C.gold, badge: C.gold, x: xcol[1], y: r2 },
      { n: 6, icon: ic.home.navy, title: "Geleverd", sub: "Thuis of afgehaald — klaar (of retour)", lineColor: C.sky, badge: C.sky, x: xcol[0], y: r2 },
    ];
    aRight(s, xcol[0] + cw + 0.05, r1 + ch / 2, gap - 0.1, C.slate);
    aRight(s, xcol[1] + cw + 0.05, r1 + ch / 2, gap - 0.1, C.slate);
    aDown(s, xcol[2] + cw / 2, r1 + ch + 0.05, r2 - (r1 + ch) - 0.1, C.slate);
    seg(s, xcol[2], r2 + ch / 2, -(gap - 0.1), 0, C.slate, true);
    seg(s, xcol[1], r2 + ch / 2, -(gap - 0.1), 0, C.slate, true);
    S.forEach((st) => step(s, st.x, st.y, cw, ch, st));
    s.addText("magazijn op voorraad? → magazijn.  Anders → winkel met voorraad.  Niet compleet? → splitsen over meerdere locaties.", { x: M, y: r2 + ch + 0.18, w: W - 2 * M, h: 0.35, align: "center", fontSize: 10, italic: true, color: C.slate });
    foot(s, "Toewijzing leest de voorraad-core; pick-scan en verzending schrijven terug.", 4);
  }

  /* ════════ 5. OMNICHANNEL (flow) ════════ */
  {
    const s = p.addSlide();
    head(s, "04", "sync", "Omnichannel — web én winkel, één voorraad", "Online en in de winkel schrijven naar dezelfde voorraad; iedereen ziet hetzelfde, direct.");
    const laneY = 2.1;
    box(s, M, laneY, 2.7, 0.92, { icon: ic.globe.navy, title: "Online", sub: "klant bestelt op gents.nl", fill: C.skySoft, lineColor: C.sky });
    aRight(s, M + 2.7, laneY + 0.46, 0.55, C.sky);
    box(s, M + 3.25, laneY, 2.7, 0.92, { icon: ic.lock.navy, title: "Reservering", sub: "anti-oversell, direct", fill: C.skySoft, lineColor: C.sky });
    const laneY2 = 3.55;
    box(s, M, laneY2, 2.7, 0.92, { icon: ic.store.navy, title: "Winkel", sub: "kassa-verkoop", fill: C.goldSoft, lineColor: C.gold });
    aRight(s, M + 2.7, laneY2 + 0.46, 0.55, C.gold);
    box(s, M + 3.25, laneY2, 2.7, 0.92, { icon: ic.scan.navy, title: "Handscanner", sub: "voorraad-mutaties", fill: C.goldSoft, lineColor: C.gold });
    const corex = M + 7.4, corey = 2.55, corew = 4.5, coreh = 1.85;
    seg(s, M + 5.95, laneY + 0.46, corex - (M + 5.95), (corey + coreh / 2) - (laneY + 0.46), C.sky, true);
    seg(s, M + 5.95, laneY2 + 0.46, corex - (M + 5.95), (corey + coreh / 2) - (laneY2 + 0.46), C.gold, true);
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: corex, y: corey, w: corew, h: coreh, rectRadius: 0.1, fill: { color: C.navy }, shadow: sh(0.18, 9, 3) });
    s.addImage({ data: ic.db.gold, x: corex + corew / 2 - 0.3, y: corey + 0.3, w: 0.6, h: 0.6 });
    s.addText("Voorraad-core", { x: corex, y: corey + 0.95, w: corew, h: 0.4, align: "center", fontFace: "Georgia", fontSize: 18, bold: true, color: "FFFFFF", margin: 0 });
    s.addText("één waarheid voor web + winkel", { x: corex, y: corey + 1.35, w: corew, h: 0.4, align: "center", fontSize: 11, color: C.line, margin: 0 });
    const oy = 5.05;
    aDown(s, corex + corew / 2, corey + coreh, 0.35, C.gold);
    box(s, M, oy, W - 2 * M, 0.82, { title: "Site, kassa én scanner tonen dezelfde voorraad — op het moment zelf.", fill: C.emeraldSoft, lineColor: C.emerald, icon: ic.check.navy, fs: 13.5, color: C.navy });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 6.05, w: W - 2 * M, h: 0.62, rectRadius: 0.09, fill: { color: C.amberSoft }, line: { color: C.amber, width: 1 } });
    s.addImage({ data: ic.warn.navy, x: M + 0.22, y: 6.18, w: 0.34, h: 0.34 });
    s.addText([{ text: "Voorbeeld: ", options: { bold: true, color: C.amber } }, { text: "twee klanten tegelijk op het laatste pak? De voorraad-lock laat er maar één afrekenen — geen teleurstelling.", options: { color: C.ink } }], { x: M + 0.72, y: 6.05, w: W - 2 * M - 0.9, h: 0.62, fontSize: 11.5, valign: "middle", margin: 0 });
    foot(s, "Mogelijk doordat alle kanalen op dezelfde core schrijven.", 5);
  }

  /* ════════ 6. VOORRAAD-FORMULE ════════ */
  {
    const s = p.addSlide();
    head(s, "05", "boxes", "Hoe de voorraad wordt berekend", "Eén formule combineert magazijn, kassa en web — minus wat al gereserveerd is.");
    const fy = 2.25, bh = 1.15;
    const terms = [
      { t: "Magazijn", s2: "SRS-basis", fill: C.goldSoft, ln: C.gold, op: "+" },
      { t: "Kassa", s2: "winkelverkoop", fill: C.skySoft, ln: C.sky, op: "+" },
      { t: "Web", s2: "online orders", fill: C.skySoft, ln: C.sky, op: "−" },
      { t: "Reserveringen", s2: "vastgehouden", fill: C.redSoft, ln: C.red, op: "=" },
    ];
    const bw = 2.35, opw = 0.55; let x = M;
    terms.forEach((tm) => { box(s, x, fy, bw, bh, { title: tm.t, sub: tm.s2, fill: tm.fill, lineColor: tm.ln, fs: 13.5 }); x += bw; const opCol = tm.op === "−" ? C.red : tm.op === "=" ? C.navy : C.emerald; s.addText(tm.op, { x, y: fy, w: opw, h: bh, align: "center", valign: "middle", fontFace: "Georgia", fontSize: 26, bold: true, color: opCol, margin: 0 }); x += opw; });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: fy, w: W - M - x, h: bh, rectRadius: 0.1, fill: { color: C.navy }, shadow: sh(0.18, 9, 3) });
    s.addText("BESCHIKBAAR", { x, y: fy + 0.22, w: W - M - x, h: 0.4, align: "center", fontFace: "Georgia", fontSize: 16, bold: true, color: C.gold, margin: 0 });
    s.addText("per artikel, per winkel", { x, y: fy + 0.64, w: W - M - x, h: 0.35, align: "center", fontSize: 10, color: C.line, margin: 0 });
    const ey = 3.95, ew = (W - 2 * M - 2 * 0.4) / 3;
    const ex = [
      { ic: "sync", t: "Altijd actueel", v: "Magazijn ververst 3×/dag; kassa- en web-mutaties tellen direct mee." },
      { ic: "lock", t: "Anti-oversell", v: "Een reservering trekt het stuk af. Het laatste pak kan maar één keer weg." },
      { ic: "check", t: "Geen fantoom", v: "Onderweg-voorraad telt pas mee ná de ontvangst-scan (volgende slide)." },
    ];
    ex.forEach((c, i) => { const cx = M + i * (ew + 0.4); s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: ey, w: ew, h: 1.55, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.09, 7, 2) }); s.addImage({ data: ic[c.ic].gold, x: cx + 0.28, y: ey + 0.28, w: 0.5, h: 0.5 }); s.addText(c.t, { x: cx + 0.95, y: ey + 0.26, w: ew - 1.1, h: 0.5, fontFace: "Georgia", fontSize: 14.5, bold: true, color: C.navy, valign: "middle", margin: 0 }); s.addText(c.v, { x: cx + 0.28, y: ey + 0.88, w: ew - 0.56, h: 0.6, fontSize: 11, color: C.slate, valign: "top", margin: 0 }); });
    foot(s, "Deze formule draait in de voorraad-core en voedt site, kassa en scanner.", 6);
  }

  /* ════════ 7. GOEDERENONTVANGST ════════ */
  {
    const s = p.addSlide();
    head(s, "06", "truck", "Goederenontvangst — scan-to-receive", "Voorraad telt pas mee ná de scan bij binnenkomst — geen fantoomvoorraad.");
    const ty = 2.35, stepw = 2.55, gap = (W - 2 * M - 4 * stepw) / 3, bh = 1.2;
    const steps = [
      { ic: "tag", t: "Besteld", s2: "bij magazijn/leverancier", fill: C.card, ln: C.line, foot: "" },
      { ic: "truck", t: "Onderweg", s2: "telt NIET mee", fill: C.amberSoft, ln: C.amber, foot: "anti-fantoom" },
      { ic: "scan", t: "Scannen", s2: "bij binnenkomst", fill: C.skySoft, ln: C.sky, foot: "slimme steekproef" },
      { ic: "check", t: "Voorraad", s2: "telt NU mee", fill: C.emeraldSoft, ln: C.emerald, foot: "verkoopbaar" },
    ];
    steps.forEach((st, i) => { const x = M + i * (stepw + gap); box(s, x, ty, stepw, bh, { icon: ic[st.ic].navy, title: st.t, sub: st.s2, fill: st.fill, lineColor: st.ln, fs: 14 }); if (st.foot) chip(s, x + 0.3, ty + bh + 0.12, stepw - 0.6, st.foot, st.ln === C.amber ? C.amber : st.ln === C.emerald ? C.emerald : C.sky, "FFFFFF"); if (i < 3) aRight(s, x + stepw + 0.04, ty + bh / 2, gap - 0.08); });
    const ey = 4.65, ew = (W - 2 * M - 0.4) / 2;
    const cards = [
      { ic: "search", t: "Slimme steekproef (AQL)", v: "Probleemartikelen tellen we altijd; de rest een waarde-gewogen steekproef. Bij te veel afwijkingen → 100% tellen. Het systeem leert per leverancier." },
      { ic: "warn", t: "Afwijking → supply chain", v: "Tekort, teveel of beschadigd? Automatisch een melding + dashboard (nauwkeurigheid per bron/winkel). Beschadigd wordt niet als voorraad geboekt." },
    ];
    cards.forEach((c, i) => { const cx = M + i * (ew + 0.4); s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: ey, w: ew, h: 1.55, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.09, 7, 2) }); s.addImage({ data: ic[c.ic].gold, x: cx + 0.28, y: ey + 0.26, w: 0.5, h: 0.5 }); s.addText(c.t, { x: cx + 0.95, y: ey + 0.24, w: ew - 1.1, h: 0.5, fontFace: "Georgia", fontSize: 14, bold: true, color: C.navy, valign: "middle", margin: 0 }); s.addText(c.v, { x: cx + 0.28, y: ey + 0.84, w: ew - 0.56, h: 0.62, fontSize: 10.5, color: C.slate, valign: "top", margin: 0 }); });
    foot(s, "Ook winkel→winkel-herverdeling loopt via deze flow, met advies rit of DHL.", 7);
  }

  /* ════════ 8. RETOUR-FLOW ════════ */
  {
    const s = p.addSlide();
    head(s, "07", "exchange", "Retour — soepel terug, omzet behouden", "Klant regelt het zelf; store credit is gratis en houdt de omzet binnen.");
    const cw = 2.18, gap = (W - 2 * M - 5 * cw) / 4, ry = 2.5, ch = 1.55;
    const xs = [0, 1, 2, 3, 4].map((i) => M + i * (cw + gap));
    const R = [
      { n: 1, icon: ic.exchange.navy, title: "Aanvragen", sub: "in account / retourportal", lineColor: C.sky, badge: C.sky },
      { n: 2, icon: ic.route.navy, title: "Methode", sub: "DHL-label of in de winkel", lineColor: C.sky, badge: C.sky },
      { n: 3, icon: ic.truck.navy, title: "Terugsturen", sub: "of inleveren in winkel", lineColor: C.gold, badge: C.gold },
      { n: 4, icon: ic.clipboard.navy, title: "Retour scannen", sub: "winkel/magazijn controleert", lineColor: C.gold, badge: C.gold },
      { n: 5, icon: ic.wallet.navy, title: "Terugbetalen", sub: "geld terug óf store credit", lineColor: C.navy, badge: C.navy },
    ];
    R.forEach((r, i) => { step(s, xs[i], ry, cw, ch, r); if (i < 4) aRight(s, xs[i] + cw + 0.04, ry + ch / 2, gap - 0.08, C.slate); });
    const oy = 4.7, ow = (W - 2 * M - 0.4) / 2;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: oy, w: ow, h: 1.5, rectRadius: 0.08, fill: { color: C.emeraldSoft }, line: { color: C.emerald, width: 1 } });
    s.addImage({ data: ic.hand.navy, x: M + 0.28, y: oy + 0.26, w: 0.5, h: 0.5 });
    s.addText("Store credit = gratis + voordeel", { x: M + 0.95, y: oy + 0.24, w: ow - 1.1, h: 0.5, fontFace: "Georgia", fontSize: 14, bold: true, color: C.navy, valign: "middle", margin: 0 });
    s.addText("Direct uitgekeerd, geen retourkosten, vaak met een extraatje — de klant blijft klant en de omzet blijft binnen.", { x: M + 0.28, y: oy + 0.84, w: ow - 0.56, h: 0.6, fontSize: 11, color: C.slate, valign: "top", margin: 0 });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M + ow + 0.4, y: oy, w: ow, h: 1.5, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 } });
    s.addImage({ data: ic.boxes.gold, x: M + ow + 0.68, y: oy + 0.26, w: 0.5, h: 0.5 });
    s.addText("Voorraad meteen terug", { x: M + ow + 1.35, y: oy + 0.24, w: ow - 1.5, h: 0.5, fontFace: "Georgia", fontSize: 14, bold: true, color: C.navy, valign: "middle", margin: 0 });
    s.addText("Een goedgekeurde retour komt direct weer beschikbaar in de voorraad-core — verkoopbaar via web én winkel.", { x: M + ow + 0.68, y: oy + 0.84, w: ow - 0.96, h: 0.6, fontSize: 11, color: C.slate, valign: "top", margin: 0 });
    foot(s, "Retourredenen en -percentages komen terug in het portal-dashboard.", 8);
  }

  /* ════════ scherm-mockups ════════ */
  function frame(s, x, y, w, h, kind) {
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: C.navy, width: 1.5 }, shadow: sh(0.16, 11, 4) });
    const barH = 0.34;
    s.addShape(p.shapes.RECTANGLE, { x: x + 0.02, y: y + 0.02, w: w - 0.04, h: barH, fill: { color: kind === "phone" ? C.navy : "EDF1F7" }, line: { type: "none" } });
    if (kind !== "phone") { ["E06C5E", "E0B23E", "5FBF6B"].forEach((c, i) => s.addShape(p.shapes.OVAL, { x: x + 0.16 + i * 0.2, y: y + 0.13, w: 0.12, h: 0.12, fill: { color: c }, line: { type: "none" } })); s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: x + 0.85, y: y + 0.09, w: w - 1.1, h: 0.2, rectRadius: 0.1, fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 } }); s.addText(kind === "tablet" ? "kassa · GENTS" : "gents.nl", { x: x + 0.95, y: y + 0.07, w: 2.5, h: 0.22, fontSize: 8, color: C.slate, valign: "middle", margin: 0 }); }
    return { ix: x + 0.12, iy: y + barH + 0.14, iw: w - 0.24, ih: h - barH - 0.26 };
  }

  /* 9. WEBSITE — PDP mockup */
  {
    const s = p.addSlide();
    head(s, "08", "globe", "De nieuwe website — gents.nl", "Een volledig eigen webshop: sneller, op maat en gekoppeld aan de winkel.");
    const fx = M, fy = 1.95, fw = 6.0, fh = 4.55;
    const f = frame(s, fx, fy, fw, fh, "browser");
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: f.ix + 0.1, y: f.iy + 0.1, w: 2.5, h: f.ih - 0.2, rectRadius: 0.05, fill: { color: "E7ECF3" }, line: { color: C.line, width: 0.75 } });
    s.addImage({ data: ic.tie.slate, x: f.ix + 1.05, y: f.iy + 1.2, w: 0.7, h: 0.7 });
    const rx = f.ix + 2.8;
    s.addText("GENTS — Pak navy", { x: rx, y: f.iy + 0.15, w: 2.9, h: 0.3, fontFace: "Georgia", fontSize: 12, bold: true, color: C.navy, margin: 0 });
    s.addText("€ 299,-", { x: rx, y: f.iy + 0.5, w: 2.9, h: 0.3, fontSize: 13, bold: true, color: C.gold, margin: 0 });
    ["46", "48", "50", "52", "54"].forEach((m, i) => { s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx + i * 0.55, y: f.iy + 0.95, w: 0.45, h: 0.32, rectRadius: 0.05, fill: { color: i === 2 ? C.navy : "FFFFFF" }, line: { color: C.line, width: 0.75 } }); s.addText(m, { x: rx + i * 0.55, y: f.iy + 0.95, w: 0.45, h: 0.32, align: "center", valign: "middle", fontSize: 8.5, color: i === 2 ? "FFFFFF" : C.ink, margin: 0 }); });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx, y: f.iy + 1.45, w: 2.85, h: 0.4, rectRadius: 0.06, fill: { color: C.navy }, line: { type: "none" } });
    s.addText("In winkelwagen", { x: rx, y: f.iy + 1.45, w: 2.85, h: 0.4, align: "center", valign: "middle", fontSize: 10, bold: true, color: "FFFFFF", margin: 0 });
    s.addText("Maak de look compleet", { x: rx, y: f.iy + 2.0, w: 2.85, h: 0.28, fontSize: 9, bold: true, color: C.slate, margin: 0 });
    [0, 1, 2].forEach((i) => s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: rx + i * 0.7, y: f.iy + 2.32, w: 0.6, h: 0.6, rectRadius: 0.05, fill: { color: "E7ECF3" }, line: { color: C.line, width: 0.75 } }));
    bullets(s, fx + fw + 0.5, 2.05, W - M - (fx + fw + 0.5), [
      "Maatadvies + pak-samensteller (los colbert/broek/gilet, één prijs)",
      "Shop-the-look: complete looks per gelegenheid",
      "Eerlijke social-proof uit eigen data — geen verzonnen cijfers",
      "Klant-account (magic-link): web- én winkel-historie samen",
      "Checkout met Mollie, vouchers, cadeaubonnen, zakelijk bestellen",
      "Reviews, AI-stijlgids-blog en meertalig (NL/EN/DE)",
    ], 12.5);
    foot(s, "Toont live de voorraad uit de core en de winkel-historie uit de kassa.", 9);
  }

  /* 10. KASSA — tablet mockup */
  {
    const s = p.addSlide();
    head(s, "09", "cash", "De nieuwe kassa-software", "Onze eigen kassa — minder afhankelijk van SRS, alle omzet in één bron.");
    const fx = M, fy = 1.95, fw = 6.0, fh = 4.55;
    const f = frame(s, fx, fy, fw, fh, "tablet");
    s.addText("Mandje", { x: f.ix + 0.1, y: f.iy + 0.05, w: 2, h: 0.25, fontSize: 9, bold: true, color: C.slate, margin: 0 });
    [["Pak navy — 50", "299,-"], ["Overhemd wit", "59,-"], ["Stropdas zijde", "39,-"]].forEach((r, i) => { const ry = f.iy + 0.4 + i * 0.5; s.addShape(p.shapes.RECTANGLE, { x: f.ix + 0.1, y: ry, w: 3.2, h: 0.42, fill: { color: i % 2 ? "F4F7FB" : "FFFFFF" }, line: { type: "none" } }); s.addText(r[0], { x: f.ix + 0.2, y: ry, w: 2.3, h: 0.42, fontSize: 9, color: C.ink, valign: "middle", margin: 0 }); s.addText("€ " + r[1], { x: f.ix + 2.5, y: ry, w: 0.85, h: 0.42, align: "right", fontSize: 9, color: C.ink, valign: "middle", margin: 0 }); });
    s.addShape(p.shapes.LINE, { x: f.ix + 0.1, y: f.iy + 2.0, w: 3.2, h: 0, line: { color: C.line, width: 1 } });
    s.addText("Totaal", { x: f.ix + 0.2, y: f.iy + 2.05, w: 1.5, h: 0.35, fontFace: "Georgia", fontSize: 12, bold: true, color: C.navy, valign: "middle", margin: 0 });
    s.addText("€ 397,-", { x: f.ix + 1.85, y: f.iy + 2.05, w: 1.45, h: 0.35, align: "right", fontFace: "Georgia", fontSize: 13, bold: true, color: C.gold, valign: "middle", margin: 0 });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: f.ix + 0.1, y: f.iy + 2.55, w: 3.2, h: 0.45, rectRadius: 0.06, fill: { color: C.emerald }, line: { type: "none" } });
    s.addText("Afrekenen", { x: f.ix + 0.1, y: f.iy + 2.55, w: 3.2, h: 0.45, align: "center", valign: "middle", fontSize: 11, bold: true, color: "FFFFFF", margin: 0 });
    s.addText("Klant koppelen · korting · cadeaubon", { x: f.ix + 3.5, y: f.iy + 0.05, w: 2.2, h: 0.5, fontSize: 8.5, color: C.slate, valign: "top", margin: 0 });
    for (let r = 0; r < 3; r++) for (let c = 0; c < 2; c++) s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: f.ix + 3.5 + c * 1.15, y: f.iy + 0.6 + r * 0.62, w: 1.0, h: 0.5, rectRadius: 0.05, fill: { color: "EEF2F8" }, line: { color: C.line, width: 0.75 } });
    bullets(s, fx + fw + 0.5, 2.05, W - M - (fx + fw + 0.5), [
      "Verkopen draaien nu op de eigen database — real-time omzet",
      "Betaalmethoden, kortingen, cadeaubonnen, loyalty, klant-koppeling",
      "Bestel voor klant uit ander filiaal · concept · parkeren",
      "Dagafsluiting met BTW-uitsplitsing — fiscaal sluitend",
      "Idempotent: nooit dubbel boeken, ook bij haperingen",
      "Kaartdata blijft bij de pinterminal — geen PCI-risico",
    ], 12.5);
    foot(s, "Schrijft naar dezelfde voorraad-core en klant-database als de webshop.", 10);
  }

  /* 11. HANDSCANNER — phone mockup */
  {
    const s = p.addSlide();
    head(s, "10", "scan", "De handscanner — één app voor de winkel", "Alle winkeltaken op één apparaat: orders, voorraad, ontvangst en herverdeling.");
    const fw = 2.95, fh = 4.55, fx = M + 0.6, fy = 1.9;
    const f = frame(s, fx, fy, fw, fh, "phone");
    s.addImage({ data: ic.store.gold, x: fx + 0.16, y: fy + 0.08, w: 0.2, h: 0.2 });
    s.addText("GENTS scanner", { x: fx + 0.42, y: fy + 0.04, w: 2.3, h: 0.28, fontSize: 9.5, bold: true, color: "FFFFFF", valign: "middle", margin: 0 });
    const tiles = [["truck", "Orders picken"], ["search", "Voorraad checken"], ["scan", "Inventariseren"], ["box", "Levering binnenmelden"], ["sync", "Naar andere winkel"], ["users", "Klantorder / reserveren"]];
    tiles.forEach((t, i) => { const ry = f.iy + i * 0.66; s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: f.ix + 0.05, y: ry, w: f.iw - 0.1, h: 0.56, rectRadius: 0.06, fill: { color: "FFFFFF" }, line: { color: C.line, width: 0.75 } }); s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: f.ix + 0.14, y: ry + 0.11, w: 0.34, h: 0.34, rectRadius: 0.05, fill: { color: C.mist }, line: { type: "none" } }); s.addImage({ data: ic[t[0]].navy, x: f.ix + 0.2, y: ry + 0.17, w: 0.22, h: 0.22 }); s.addText(t[1], { x: f.ix + 0.6, y: ry, w: f.iw - 0.7, h: 0.56, fontSize: 9.5, bold: true, color: C.navy, valign: "middle", margin: 0 }); });
    bullets(s, fx + fw + 0.55, 2.0, W - M - (fx + fw + 0.55), [
      "Orders picken (web + afhaal) met urgentie en scan-controle",
      "Voorraad checken: eigen winkel, magazijn én andere winkels",
      "Inventariseren: tellen vs systeem, verschillen direct verwerken",
      "Levering binnenmelden: scannen → pas dán voorraad (anti-fantoom)",
      "Naar andere winkel sturen: herverdeling + advies rit of DHL",
      "Klantorder / reserveren + schade melden — alles via scannen",
    ], 12.5);
    foot(s, "Werkt op dezelfde voorraad-core; ontvangst boekt pas bij de scan.", 11);
  }

  /* 12. PORTAL — dashboard mockup */
  {
    const s = p.addSlide();
    head(s, "11", "grid", "De portal — kantoor- en winkelbrein", "Eén plek waar het team álles beheert — zonder developer.");
    const fx = M, fy = 1.95, fw = 6.4, fh = 4.55;
    const f = frame(s, fx, fy, fw, fh, "browser");
    s.addShape(p.shapes.RECTANGLE, { x: f.ix, y: f.iy, w: 1.5, h: f.ih, fill: { color: C.navy }, line: { type: "none" } });
    ["Dashboard", "Orders", "Klanten", "Voorraad", "Nieuwe site", "Marketing", "Instellingen"].forEach((n, i) => s.addText(n, { x: f.ix + 0.18, y: f.iy + 0.18 + i * 0.42, w: 1.25, h: 0.32, fontSize: 9, color: i === 0 ? C.gold : "C9D3E2", valign: "middle", margin: 0 }));
    const gx = f.ix + 1.7, gw = (f.iw - 1.7 - 0.2 - 0.2) / 2;
    [["Omzet vandaag", "€ 12.480"], ["Open orders", "37"], ["Retour-%", "6,2%"], ["Voorraad-waarde", "€ 1,4 mln"]].forEach((k, i) => { const kx = gx + (i % 2) * (gw + 0.2), ky = f.iy + 0.1 + Math.floor(i / 2) * 1.0; s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: kx, y: ky, w: gw, h: 0.85, rectRadius: 0.06, fill: { color: "F6F8FC" }, line: { color: C.line, width: 0.75 } }); s.addText(k[1], { x: kx + 0.15, y: ky + 0.12, w: gw - 0.3, h: 0.4, fontFace: "Georgia", fontSize: 15, bold: true, color: C.navy, margin: 0 }); s.addText(k[0], { x: kx + 0.15, y: ky + 0.52, w: gw - 0.3, h: 0.28, fontSize: 8.5, color: C.slate, margin: 0 }); });
    const chy = f.iy + 2.2; s.addText("Omzet per week", { x: gx, y: chy - 0.05, w: 2, h: 0.25, fontSize: 8.5, bold: true, color: C.slate, margin: 0 });
    [0.5, 0.8, 0.65, 1.0, 0.9, 1.15, 0.95].forEach((hh, i) => s.addShape(p.shapes.RECTANGLE, { x: gx + i * 0.42, y: chy + 1.3 - hh, w: 0.3, h: hh, fill: { color: i === 5 ? C.gold : C.navy2 }, line: { type: "none" } }));
    bullets(s, fx + fw + 0.5, 2.05, W - M - (fx + fw + 0.5), [
      "Orders, retouren en niet-leverbaar real-time volgen",
      "Klanten beheren: zoeken, segmenteren, loyalty en deals",
      "Voorraad, inkoop, ritten en herverdeling coördineren",
      "Webshop zelf instellen: verzending, cutoffs, kortingen, KPI's",
      "Marketing, content en SEO in eigen hand (met AI)",
      "Rapportages, eigen dashboards en exports · rechten per rol",
    ], 12);
    foot(s, "Praat veilig via een beveiligde tussenlaag met de backend (zie veiligheid).", 12);
  }

  /* 13. AI-FUNCTIES (grid) */
  {
    const s = p.addSlide();
    head(s, "12", "brain", "Slimme & AI-functies", "AI door de hele keten: minder handwerk, betere content, slimmere beslissingen.");
    const items = [
      ["star", "Review-samenvattingen", "AI vat echte reviews samen"],
      ["pen", "Productteksten + SEO", "on-brand, alleen op feiten"],
      ["chart", "Klantinzichten voor MT", "kansen/risico's, geen PII"],
      ["book", "AI-stijlgids / blog", "automatisch, echte producten"],
      ["image", "Lerende beeld-studio", "leert van afkeuren"],
      ["ruler", "Maatadvies", "voorfilter op jouw maat"],
      ["puzzle", "MixMatch pak-samensteller", "los → compleet pak, hogere AOV"],
      ["search", "Manco-steekproef", "gericht controleren bij inkoop"],
      ["route", "Verzendadvies rit/DHL", "goedkoopste passende route"],
    ];
    const cols = 3, gw = (W - 2 * M - (cols - 1) * 0.4) / cols, gh = 1.3, gyy = 1.95, gap = 0.32;
    items.forEach((it, i) => { const cx = M + (i % cols) * (gw + 0.4), cy = gyy + Math.floor(i / cols) * (gh + gap); s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: cy, w: gw, h: gh, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.08, 6, 2) }); s.addShape(p.shapes.OVAL, { x: cx + 0.22, y: cy + 0.24, w: 0.6, h: 0.6, fill: { color: C.navy }, line: { type: "none" } }); s.addImage({ data: ic[it[0]].gold, x: cx + 0.37, y: cy + 0.39, w: 0.3, h: 0.3 }); s.addText(it[1], { x: cx + 0.95, y: cy + 0.2, w: gw - 1.1, h: 0.45, fontFace: "Georgia", fontSize: 12.5, bold: true, color: C.navy, valign: "middle", margin: 0 }); s.addText(it[2], { x: cx + 0.95, y: cy + 0.68, w: gw - 1.1, h: 0.5, fontSize: 9.5, color: C.slate, valign: "top", margin: 0 }); });
    foot(s, "De AI-lagen voeden de productpagina's, het dashboard, de blog en de inkoop.", 13);
  }

  /* 14. VEILIGHEID */
  {
    const s = p.addSlide();
    head(s, "13", "shield", "Backup, veiligheid & betrouwbaarheid", "Klantdata veilig, geen platform-risico, en niets valt om bij een storing.");
    const cols = [
      { t: "Veiligheid", ic: "lock", items: ["Identiteit ondertekend (HMAC) — geen spoofing", "Geheimen nooit in de URL", "Webhooks & crons fail-closed", "Rate-limiting + audit op klantdata"] },
      { t: "Betrouwbaarheid", ic: "sync", items: ["Idempotent: nooit dubbel geboekt", "Anti-oversell op één database", "Fail-soft: SRS-storing breekt niets", "Eén transactionele bron van waarheid"] },
      { t: "Backup & privacy", ic: "db", items: ["Dagelijkse off-site backup", "Herstel-knop in de back-office", "AVG: export & verwijder", "Multi-agent security-audit gedaan"] },
    ];
    const cw = (W - 2 * M - 2 * 0.4) / 3, cyy = 2.0;
    cols.forEach((c, i) => { const cx = M + i * (cw + 0.4); s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: cyy, w: cw, h: 4.0, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.09, 7, 2) }); s.addShape(p.shapes.OVAL, { x: cx + cw / 2 - 0.35, y: cyy + 0.3, w: 0.7, h: 0.7, fill: { color: C.navy }, line: { type: "none" } }); s.addImage({ data: ic[c.ic].gold, x: cx + cw / 2 - 0.18, y: cyy + 0.47, w: 0.36, h: 0.36 }); s.addText(c.t, { x: cx, y: cyy + 1.05, w: cw, h: 0.4, align: "center", fontFace: "Georgia", fontSize: 15, bold: true, color: C.navy, margin: 0 }); s.addText(c.items.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 14 }, color: C.ink, breakLine: true, paraSpaceAfter: 8 } })), { x: cx + 0.3, y: cyy + 1.6, w: cw - 0.6, h: 2.2, fontSize: 10.5, valign: "top" }); });
    foot(s, "Beveiliging zit in beide systemen; audit-logs maken misbruik traceerbaar.", 14);
  }

  /* 15. KOSTEN */
  {
    const s = p.addSlide();
    head(s, "14", "coins", "Wat kost het platform per maand?", "Lage vaste softwarekosten; de rest schaalt netjes mee met de verkoop.");
    const cats = [
      { ic: "redo", t: "Vast", sub: "software-abonnementen", total: "± € 155", rng: "bandbreedte € 67–303", fill: C.skySoft, ln: C.sky, items: [["Vercel — hosting (3 projecten)", "37"], ["SendCloud — verzendlabels", "87"], ["Resend — e-mail", "19"], ["Domein + overige", "12"]] },
      { ic: "cart", t: "Variabel", sub: "schaalt met de verkoop", total: "± € 650", rng: "bij ~750 orders/mnd", fill: C.goldSoft, ln: C.gold, items: [["Mollie — betaalverwerking", "610"], ["Neon — database", "33"], ["Vercel Blob — opslag", "3"], ["Claude — AI-functies", "2"]] },
      { ic: "image", t: "Incidenteel", sub: "per campagne / collectie", total: "± € 10", rng: "gemiddeld per maand", fill: C.emeraldSoft, ln: C.emerald, items: [["FASHN — AI-modelfoto's", "8"], ["FAL — hero-beelden", "2"], ["WhatsApp — nu uit", "0"]] },
    ];
    const cw = (W - 2 * M - 2 * 0.4) / 3, cyy = 1.95, chh = 3.5;
    cats.forEach((c, i) => {
      const cx = M + i * (cw + 0.4);
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx, y: cyy, w: cw, h: chh, rectRadius: 0.08, fill: { color: C.card }, line: { color: C.line, width: 1 }, shadow: sh(0.1, 8, 2) });
      s.addShape(p.shapes.OVAL, { x: cx + 0.28, y: cyy + 0.28, w: 0.62, h: 0.62, fill: { color: c.ln }, line: { type: "none" } });
      s.addImage({ data: ic[c.ic].white, x: cx + 0.43, y: cyy + 0.43, w: 0.32, h: 0.32 });
      s.addText(c.t, { x: cx + 1.02, y: cyy + 0.26, w: cw - 1.2, h: 0.36, fontFace: "Georgia", fontSize: 16, bold: true, color: C.navy, valign: "middle", margin: 0 });
      s.addText(c.sub, { x: cx + 1.02, y: cyy + 0.62, w: cw - 1.2, h: 0.3, fontSize: 9.5, color: C.slate, valign: "middle", margin: 0 });
      s.addShape(p.shapes.LINE, { x: cx + 0.28, y: cyy + 1.08, w: cw - 0.56, h: 0, line: { color: C.line, width: 1 } });
      c.items.forEach((it, k) => {
        const ry = cyy + 1.2 + k * 0.4;
        s.addText(it[0], { x: cx + 0.28, y: ry, w: cw - 1.25, h: 0.38, fontSize: 10.5, color: C.ink, valign: "middle", margin: 0 });
        s.addText("€ " + it[1], { x: cx + cw - 1.05, y: ry, w: 0.77, h: 0.38, align: "right", fontSize: 10.5, bold: true, color: it[1] === "0" ? C.slate : C.ink, valign: "middle", margin: 0 });
      });
      s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: cx + 0.2, y: cyy + chh - 0.92, w: cw - 0.4, h: 0.72, rectRadius: 0.07, fill: { color: c.fill }, line: { type: "none" } });
      s.addText(c.total, { x: cx + 0.38, y: cyy + chh - 0.88, w: cw - 0.76, h: 0.42, fontFace: "Georgia", fontSize: 21, bold: true, color: C.navy, valign: "middle", margin: 0 });
      s.addText(c.rng, { x: cx + 0.38, y: cyy + chh - 0.46, w: cw - 0.76, h: 0.28, fontSize: 9, color: C.slate, valign: "middle", margin: 0 });
    });
    // totaal-band
    const ty = 5.7;
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: ty, w: W - 2 * M, h: 0.78, rectRadius: 0.09, fill: { color: C.navy }, shadow: sh(0.16, 9, 3) });
    s.addImage({ data: ic.euro.gold, x: M + 0.3, y: ty + 0.21, w: 0.36, h: 0.36 });
    s.addText([
      { text: "Totaal ≈ € 815 / maand", options: { bold: true, color: C.gold, fontSize: 15 } },
      { text: "   bij ~750 online orders — waarvan € 610 betaalverwerking (≈ € 0,80/order). Vaste software om álles te draaien: slechts ~€ 155/mnd.", options: { color: "FFFFFF", fontSize: 11.5 } },
    ], { x: M + 0.85, y: ty, w: W - 2 * M - 1.1, h: 0.78, valign: "middle", margin: 0 });
    foot(s, "Exclusief DHL-porto (verzendkosten ~€3–4k, logistiek/COGS) en advertentiebudget — én géén Shopify-platformfee meer.", 15);
  }

  /* 16. SLOT */
  {
    const s = p.addSlide(); s.background = { color: C.navy };
    s.addText("De kern", { x: M, y: 0.75, w: 6, h: 0.4, fontSize: 13, color: C.gold, charSpacing: 3 });
    s.addText("Eén eigen, slim platform — sneller, veiliger en minder afhankelijk.", { x: M, y: 1.2, w: 11.8, h: 1.3, fontFace: "Georgia", fontSize: 30, color: "FFFFFF", bold: true });
    const pil = [["check", "Eigen regie", "Geen Shopify-lock-in; alles in eigen beheer en zelf instelbaar."], ["brain", "Slim", "AI en automatisering door de hele keten — minder handwerk, meer omzet."], ["shield", "Betrouwbaar", "Anti-oversell, idempotent en beveiligd; niets valt om bij een storing."]];
    const cw = (W - 2 * M - 2 * 0.4) / 3, py = 3.0;
    pil.forEach((pl, k) => { const x = M + k * (cw + 0.4); s.addShape(p.shapes.ROUNDED_RECTANGLE, { x, y: py, w: cw, h: 2.5, rectRadius: 0.09, fill: { color: C.navy2 }, line: { type: "none" } }); s.addImage({ data: ic[pl[0]].gold, x: x + 0.32, y: py + 0.32, w: 0.5, h: 0.5 }); s.addText(pl[1], { x: x + 0.32, y: py + 0.95, w: cw - 0.64, h: 0.45, fontFace: "Georgia", fontSize: 18, bold: true, color: C.gold, margin: 0 }); s.addText(pl[2], { x: x + 0.32, y: py + 1.45, w: cw - 0.64, h: 0.95, fontSize: 12.5, color: C.line, valign: "top", margin: 0 }); });
    s.addShape(p.shapes.ROUNDED_RECTANGLE, { x: M, y: 5.85, w: W - 2 * M, h: 0.62, rectRadius: 0.09, fill: { color: "1B2E50" }, line: { type: "none" } });
    s.addText([{ text: "Status:  ", options: { bold: true, color: C.gold } }, { text: "de kern draait live (test-omgeving). Go-live = enkele schakelaars (Mollie live, indexeren aan).", options: { color: "FFFFFF" } }], { x: M + 0.3, y: 5.85, w: W - 2 * M - 0.6, h: 0.62, fontSize: 12.5, valign: "middle", margin: 0 });
    s.addText("GENTS — SUITS YOU", { x: M, y: 6.75, w: 6, h: 0.4, fontFace: "Georgia", fontSize: 13, color: C.gold, charSpacing: 4 });
  }

  const out = path.join(__dirname, "GENTS-omnichannel-MT.pptx");
  await p.writeFile({ fileName: out });
  console.log("WRITTEN", out);
}
main().catch((e) => { console.error(e); process.exit(1); });
