import "@/lib/load-env";
import { writeFileSync } from "node:fs";
import { bouwHandboek } from "@/lib/handboek";
import { HANDBOEK_CSS } from "@/lib/handboek-stijl";

/**
 * Het handboek als één zelfstandig HTML-bestand:
 *   npm run handboek:html [-- <pad>]
 *
 * Waarvoor: meesturen, uitprinten, of openen zonder toegang tot de portal. De
 * inhoud komt uit dezelfde bron als de pagina /handboek, dus de uitdraai kan
 * niet afwijken van wat het team op het scherm ziet.
 *
 * Met een DATABASE_URL in de omgeving staan de ECHTE ingestelde waarden erin;
 * zonder database vallen de getallen terug op de standaardwaarden uit de code.
 * Dat verschil zetten we in de kop van het bestand, zodat niemand een uitdraai
 * met standaardwaarden voor de werkelijkheid aanziet.
 */

const zoekIcoon =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

async function main() {
  const doel = process.argv[2] || "handboek.html";
  const metDb = Boolean(process.env.DATABASE_URL);
  const handboek = await bouwHandboek();

  const toc = handboek.delen
    .map(
      (d) =>
        `<div data-deel="${d.id}"><div class="hb-deelkop">${d.rom} · ${d.titel}</div>` +
        d.hoofdstukken
          .map((h) => `<a href="#${h.anker}" data-anker="${h.anker}"><span>${h.nr}</span>${h.titel}</a>`)
          .join("") +
        `</div>`,
    )
    .join("");

  const main = handboek.delen
    .map(
      (d) =>
        `<section class="hb-deel" id="${d.id}"><header><div class="hb-rom">${d.rom}</div><h2>${d.titel}</h2>` +
        `<p class="hb-deel-intro">${d.intro}</p></header><div class="hb-stapel">` +
        d.hoofdstukken
          .map(
            (h) =>
              `<article class="hb-hst" id="${h.anker}"><h3><span class="hb-nr">${h.nr}</span>${h.titel}</h3>` +
              `<div class="hb-body">${h.html}</div></article>`,
          )
          .join("") +
        `</div></section>`,
    )
    .join("");

  const html = `<!doctype html>
<html lang="nl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>GENTS Platformhandboek</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500;6..72,600&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>html,body{margin:0;padding:0}${HANDBOEK_CSS}</style>
</head>
<body>
<div class="hb">
  <header class="hb-mast"><div class="hb-mast-in">
    <div class="hb-merk">GENTS &nbsp;·&nbsp; SUITS YOU</div>
    <p class="hb-eyebrow">Handboek van het hele platform</p>
    <h1>Platformhandboek</h1>
    <p class="hb-lead">Website, kassa, handscanner, voorraad en portal: hoe alles werkt, welke logica eronder ligt, welke workflows erop draaien en welke knoppen het team zelf beheert.</p>
    <div class="hb-meta-rij">
      <span class="hb-meta">${handboek.stand.delen} delen</span>
      <span class="hb-meta">${handboek.stand.hoofdstukken} hoofdstukken</span>
      <span class="hb-meta">${handboek.stand.modules} modules</span>
      <span class="hb-meta">${handboek.stand.endpoints} endpoints</span>
      <span class="hb-meta">${handboek.stand.taken} geplande taken</span>
      <span class="hb-meta">${metDb ? "bedragen: ingestelde waarden" : "bedragen: standaardwaarden"}</span>
    </div>
  </div></header>
  <div class="hb-shell">
    <div class="hb-rail">
      <div class="hb-zoek">${zoekIcoon}<input id="hb-zoek" type="search" placeholder="Zoek in het handboek…  (/)" aria-label="Zoek in het handboek" autocomplete="off"></div>
      <div class="hb-uitslag" id="hb-uitslag" role="status">${handboek.stand.hoofdstukken} hoofdstukken</div>
      <nav class="hb-toc" id="hb-toc" aria-label="Inhoud">${toc}</nav>
    </div>
    <main class="hb-main">${main}
      <footer class="hb-slot"><p>Uitdraai van het platformhandboek. De actuele versie staat op <code>/handboek</code> en wordt bij elke uitrol opnieuw samengesteld uit de code en de ingestelde waarden.</p></footer>
    </main>
  </div>
</div>
<script>
(function () {
  var veld = document.getElementById("hb-zoek");
  var uitslag = document.getElementById("hb-uitslag");
  var toc = document.getElementById("hb-toc");
  var artikelen = Array.prototype.slice.call(document.querySelectorAll(".hb-hst"));
  var tekst = {};
  artikelen.forEach(function (a) { tekst[a.id] = (a.textContent || "").toLowerCase(); });

  function filter() {
    var woorden = (veld.value || "").trim().toLowerCase().split(/\\s+/).filter(Boolean);
    var raak = 0;
    artikelen.forEach(function (a) {
      var past = woorden.every(function (w) { return (tekst[a.id] || "").indexOf(w) >= 0; });
      a.classList.toggle("hb-verborgen", !past);
      var link = toc.querySelector('[data-anker="' + a.id + '"]');
      if (link) link.classList.toggle("hb-verborgen", !past);
      if (past) raak++;
    });
    document.querySelectorAll(".hb-deel").forEach(function (s) {
      var open = s.querySelectorAll(".hb-hst:not(.hb-verborgen)").length;
      s.classList.toggle("hb-verborgen", open === 0);
      var groep = toc.querySelector('[data-deel="' + s.id + '"]');
      if (groep) groep.classList.toggle("hb-verborgen", open === 0);
    });
    uitslag.textContent = woorden.length ? raak + " van " + artikelen.length + " hoofdstukken" : artikelen.length + " hoofdstukken";
  }
  veld.addEventListener("input", filter);
  document.addEventListener("keydown", function (e) {
    var inVeld = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (e.key === "/" && !inVeld) { e.preventDefault(); veld.focus(); }
    else if (e.key === "Escape" && inVeld) { veld.value = ""; filter(); veld.blur(); }
  });

  if ("IntersectionObserver" in window) {
    var zichtbaar = {};
    var waarnemer = new IntersectionObserver(function (regels) {
      regels.forEach(function (r) { zichtbaar[r.target.id] = r.isIntersecting; });
      var eerste = artikelen.filter(function (a) { return zichtbaar[a.id]; })[0];
      if (!eerste) return;
      Array.prototype.forEach.call(toc.querySelectorAll("a"), function (l) { l.classList.remove("hb-actief"); });
      var link = toc.querySelector('[data-anker="' + eerste.id + '"]');
      if (link) link.classList.add("hb-actief");
    }, { rootMargin: "-8% 0px -70% 0px", threshold: 0 });
    artikelen.forEach(function (a) { waarnemer.observe(a); });
  }
})();
</script>
</body>
</html>
`;

  writeFileSync(doel, html, "utf8");
  console.log(
    `handboek:html → ${doel} (${handboek.stand.hoofdstukken} hoofdstukken, ${Math.round(html.length / 1024)} kB, ` +
      `${metDb ? "ingestelde waarden" : "standaardwaarden — geen DATABASE_URL"})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
