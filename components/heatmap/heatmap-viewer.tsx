"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  APPARATEN,
  CEL_KOLOMMEN,
  CEL_RIJ_PX,
  REFERENTIE_BREEDTE,
  type Apparaat,
} from "@/lib/heatmap-paginas";

/**
 * De heatmap-viewer: de échte pagina in een frame, met de kleurlaag eroverheen.
 *
 * Waarom de echte pagina en geen opgeslagen schermafdruk: een schermafdruk
 * veroudert stil. Een prijs verandert, een blok verhuist, en dan wijst de
 * kleurvlek maanden later naar iets wat er niet meer staat — terwijl niemand
 * ziet dat het beeld oud is. Door de site zelf in te laden kijk je altijd naar
 * de pagina zoals hij nú is. Dat het frame same-origin is (X-Frame-Options
 * SAMEORIGIN) is precies wat dit mogelijk maakt: we kunnen de hoogte van het
 * document uitlezen en de overlay er exact op leggen.
 *
 * Het frame is niet aanklikbaar: er ligt een vanger overheen. Anders klik je in
 * een echte winkelwagen of start je een echte afrekensessie terwijl je denkt
 * dat je naar een plaatje kijkt.
 */

type Cel = { cx: number; cy: number; n: number; doden: number; woede: number };
type Element = { selector: string; label: string; n: number; doden: number; woede: number };
type ScrollPunt = { bucket: number; weergaven: number; aandeel: number };

type Detail = {
  paginaKey: string;
  titel: string;
  apparaat: Apparaat;
  dagen: number;
  cellen: Cel[];
  elementen: Element[];
  scroll: ScrollPunt[];
  weergaven: number;
  medianeScroll: number;
  voorbeeldPaden: { pad: string; n: number }[];
  docHoogte: number;
  vensterHoogte: number;
  referentieBreedte: number;
};

type OverzichtRij = {
  paginaKey: string;
  titel: string;
  kliks: number;
  doden: number;
  woede: number;
  weergaven: number;
  medianeScroll: number;
};

type Laag = "kliks" | "dood" | "scroll";

const LAGEN: { key: Laag; titel: string; uitleg: string }[] = [
  { key: "kliks", titel: "Kliks", uitleg: "Waar wordt geklikt — feller is vaker." },
  { key: "dood", titel: "Dode kliks", uitleg: "Kliks op iets dat niet klikbaar is. Hier verwacht de klant een knop." },
  { key: "scroll", titel: "Scrollbereik", uitleg: "Hoe ver komt men. Donker = door weinig mensen gezien." },
];

const DAGKEUZES = [7, 30, 90];

/* ─────────────────────────── Kleurschaal ──────────────────────────────── */

type Stop = [number, [number, number, number]];

const PALET_KLIK: Stop[] = [
  [0.0, [20, 40, 160]],
  [0.35, [0, 190, 220]],
  [0.55, [70, 205, 90]],
  [0.78, [250, 215, 55]],
  [1.0, [215, 35, 35]],
];

// Dode kliks krijgen een eigen schaal. Met dezelfde kleuren zou je op één blik
// niet zien of je naar "hier wordt veel geklikt" of "hier klikt men mis" kijkt,
// en dat zijn tegenovergestelde conclusies.
const PALET_DOOD: Stop[] = [
  [0.0, [60, 20, 90]],
  [0.5, [170, 40, 190]],
  [1.0, [255, 90, 60]],
];

function kleur(t: number, stops: Stop[]): [number, number, number] {
  const p = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    const [t1, c1] = stops[i - 1];
    const [t2, c2] = stops[i];
    if (p <= t2) {
      const f = t2 === t1 ? 0 : (p - t1) / (t2 - t1);
      return [
        Math.round(c1[0] + (c2[0] - c1[0]) * f),
        Math.round(c1[1] + (c2[1] - c1[1]) * f),
        Math.round(c1[2] + (c2[2] - c1[2]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

/**
 * Tekent de kleurlaag. Eerst grijswaarden opbouwen met overlappende
 * verlopen, daarna in één keer inkleuren — dat is hoe een heatmap aan z'n
 * vloeiende vlekken komt in plaats van losse stippen.
 *
 * De wortel over de waarde is geen opsmuk: met een lineaire schaal drukt één
 * uitschieter (de "In winkelwagen"-knop) de rest van de pagina naar bijna nul
 * en zie je nergens anders meer iets.
 */
function tekenHeat(canvas: HTMLCanvasElement, cellen: Cel[], breedte: number, hoogte: number, laag: Laag) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || breedte <= 0 || hoogte <= 0) return;
  canvas.width = breedte;
  canvas.height = hoogte;
  ctx.clearRect(0, 0, breedte, hoogte);

  const waardeVan = (c: Cel) => (laag === "dood" ? c.doden : c.n);
  const zichtbaar = cellen.filter((c) => waardeVan(c) > 0);
  if (!zichtbaar.length) return;

  const max = Math.max(...zichtbaar.map(waardeVan));
  const kolom = breedte / CEL_KOLOMMEN;
  const straal = Math.max(16, kolom * 1.6);

  for (const c of zichtbaar) {
    const x = (c.cx + 0.5) * kolom;
    const y = (c.cy + 0.5) * CEL_RIJ_PX;
    const sterkte = Math.min(1, Math.sqrt(waardeVan(c) / max));
    const verloop = ctx.createRadialGradient(x, y, 0, x, y, straal);
    verloop.addColorStop(0, `rgba(0,0,0,${sterkte.toFixed(3)})`);
    verloop.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = verloop;
    ctx.beginPath();
    ctx.arc(x, y, straal, 0, Math.PI * 2);
    ctx.fill();
  }

  const stops = laag === "dood" ? PALET_DOOD : PALET_KLIK;
  const beeld = ctx.getImageData(0, 0, breedte, hoogte);
  const d = beeld.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (!a) continue;
    const [r, g, b] = kleur(a / 255, stops);
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = b;
    // Ondergrens op de dekking: een cel met één klik moet zichtbaar zijn,
    // anders lijkt een rustige pagina ten onrechte helemaal ongebruikt.
    d[i + 3] = Math.min(235, Math.max(a, a > 8 ? 45 : 0));
  }
  ctx.putImageData(beeld, 0, 0);
}

/* ──────────────────────────── Component ───────────────────────────────── */

export function HeatmapViewer({ paginas }: { paginas: { key: string; titel: string }[] }) {
  const [pagina, setPagina] = useState(paginas[0]?.key || "/");
  const [apparaat, setApparaat] = useState<Apparaat>("mobiel");
  const [dagen, setDagen] = useState(30);
  const [laag, setLaag] = useState<Laag>("kliks");
  const [dekking, setDekking] = useState(0.75);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [overzicht, setOverzicht] = useState<OverzichtRij[]>([]);
  const [padKeuze, setPadKeuze] = useState("");
  const [bezig, setBezig] = useState(true);
  const [fout, setFout] = useState("");
  const [frameHoogte, setFrameHoogte] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const breedte = detail?.referentieBreedte || REFERENTIE_BREEDTE[apparaat];

  useEffect(() => {
    let afgebroken = false;
    fetch(`/api/studio/site/heatmap?dagen=${dagen}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (!afgebroken && j?.ok) setOverzicht(j.paginas || []);
      })
      .catch(() => {});
    return () => {
      afgebroken = true;
    };
  }, [dagen]);

  useEffect(() => {
    let afgebroken = false;
    setBezig(true);
    setFout("");
    const url = `/api/studio/site/heatmap?pagina=${encodeURIComponent(pagina)}&apparaat=${apparaat}&dagen=${dagen}`;
    fetch(url, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j) => {
        if (afgebroken) return;
        if (!j?.ok) {
          setFout(j?.error || "Kon de heatmap niet laden.");
          setDetail(null);
          return;
        }
        setDetail(j as Detail);
        setPadKeuze(j.voorbeeldPaden?.[0]?.pad || vervangbaarPad(pagina));
      })
      .catch((e) => !afgebroken && setFout(String(e)))
      .finally(() => !afgebroken && setBezig(false));
    return () => {
      afgebroken = true;
    };
  }, [pagina, apparaat, dagen]);

  /**
   * Zet het frame op de volle hoogte van het geladen document, verberg wat niet
   * bij de pagina hoort en houd de hoogte bij terwijl beelden binnendruppelen —
   * anders staat de kleurlaag op een pagina die achteraf 400 px langer bleek.
   */
  const waarnemerRef = useRef<ResizeObserver | null>(null);
  const tikkenRef = useRef<number[]>([]);

  const stopMeten = useCallback(() => {
    waarnemerRef.current?.disconnect();
    waarnemerRef.current = null;
    tikkenRef.current.forEach(clearTimeout);
    tikkenRef.current = [];
  }, []);

  const opFrameGeladen = useCallback(() => {
    const doc = frameRef.current?.contentDocument;
    if (!doc) return;
    // Vorige waarnemer eerst weg: onLoad vuurt opnieuw bij elke andere
    // voorbeeld-URL, en anders stapelen ze op tot het scherm gaat haperen.
    stopMeten();

    const stijl = doc.createElement("style");
    stijl.textContent = `
      [data-heat-uit] { display: none !important; }
      html, body { overflow: hidden !important; height: auto !important; }
      *, *::before, *::after { animation: none !important; transition: none !important; }
    `;
    doc.head.appendChild(stijl);

    const meet = () => {
      const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight || 0);
      if (h > 0) setFrameHoogte(h);
    };
    meet();
    const waarnemer = new ResizeObserver(meet);
    waarnemer.observe(doc.documentElement);
    waarnemerRef.current = waarnemer;
    // Beelden laden na 'load' door; een paar late metingen kosten niets en
    // voorkomen een overlay die 200 px misstaat.
    tikkenRef.current = [400, 1200, 2500].map((ms) => window.setTimeout(meet, ms));
  }, [stopMeten]);

  useEffect(() => stopMeten, [stopMeten]);

  // Andere pagina of ander apparaat = andere hoogte. De oude hoogte laten staan
  // geeft een frame dat een tel lang te lang of te kort is, met de kleurlaag op
  // de verkeerde plek.
  useEffect(() => setFrameHoogte(0), [pagina, apparaat]);

  const hoogte = frameHoogte || detail?.docHoogte || 2000;

  useEffect(() => {
    if (!canvasRef.current || !detail) return;
    if (laag === "scroll") return; // scroll tekenen we met banden, niet met vlekken
    tekenHeat(canvasRef.current, detail.cellen, breedte, hoogte, laag);
  }, [detail, laag, breedte, hoogte]);

  const scrollBanden = useMemo(() => {
    if (!detail || laag !== "scroll") return [];
    const vh = detail.vensterHoogte || Math.round(hoogte * 0.35);
    const scrollbaar = Math.max(0, hoogte - vh);
    const punten = detail.scroll;
    return punten.map((p, i) => {
      const volgende = punten[i + 1];
      const top = (p.bucket / 100) * scrollbaar + (i === 0 ? 0 : vh);
      const onder = volgende ? (volgende.bucket / 100) * scrollbaar + vh : hoogte;
      return { top, hoogte: Math.max(0, onder - top), aandeel: p.aandeel, bucket: p.bucket };
    });
  }, [detail, laag, hoogte]);

  const totaalKliks = detail?.cellen.reduce((n, c) => n + c.n, 0) || 0;
  const totaalDood = detail?.cellen.reduce((n, c) => n + c.doden, 0) || 0;
  const totaalWoede = detail?.cellen.reduce((n, c) => n + c.woede, 0) || 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <header className="border-b border-neutral-800 px-5 py-4">
        <h1 className="text-lg font-semibold">Heatmap</h1>
        <p className="mt-1 text-sm text-neutral-400">
          Waar bezoekers klikken, waar ze mis klikken en hoe ver ze komen. De pagina hiernaast is de echte site — niet
          aanklikbaar, zodat je niet per ongeluk in de winkelwagen belandt.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-800 px-5 py-3 text-sm">
        <select
          value={pagina}
          onChange={(e) => setPagina(e.target.value)}
          className="rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5"
        >
          {paginas.map((p) => (
            <option key={p.key} value={p.key}>
              {p.titel}
            </option>
          ))}
        </select>

        <div className="flex overflow-hidden rounded border border-neutral-700">
          {APPARATEN.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => setApparaat(a)}
              className={`px-3 py-1.5 capitalize ${a === apparaat ? "bg-neutral-100 text-neutral-900" : "bg-neutral-900"}`}
            >
              {a}
            </button>
          ))}
        </div>

        <div className="flex overflow-hidden rounded border border-neutral-700">
          {DAGKEUZES.map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDagen(d)}
              className={`px-3 py-1.5 ${d === dagen ? "bg-neutral-100 text-neutral-900" : "bg-neutral-900"}`}
            >
              {d}d
            </button>
          ))}
        </div>

        <div className="flex overflow-hidden rounded border border-neutral-700">
          {LAGEN.map((l) => (
            <button
              key={l.key}
              type="button"
              title={l.uitleg}
              onClick={() => setLaag(l.key)}
              className={`px-3 py-1.5 ${l.key === laag ? "bg-neutral-100 text-neutral-900" : "bg-neutral-900"}`}
            >
              {l.titel}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-2 text-neutral-400">
          Dekking
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={dekking}
            onChange={(e) => setDekking(Number(e.target.value))}
          />
        </label>

        {detail && detail.voorbeeldPaden.length > 1 && (
          <select
            value={padKeuze}
            onChange={(e) => setPadKeuze(e.target.value)}
            className="max-w-xs rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5"
            title="Welke concrete pagina in het frame staat"
          >
            {detail.voorbeeldPaden.map((v) => (
              <option key={v.pad} value={v.pad}>
                {v.pad} ({v.n})
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[auto_minmax(0,1fr)]">
        {/* ── De pagina met de kleurlaag ── */}
        <div className="justify-self-center">
          <p className="mb-2 text-center text-xs text-neutral-500">
            {breedte} px breed · {LAGEN.find((l) => l.key === laag)?.uitleg}
          </p>
          <div
            className="relative overflow-hidden rounded border border-neutral-800 bg-white"
            style={{ width: breedte, height: hoogte }}
          >
            {padKeuze && (
              <iframe
                ref={frameRef}
                src={padKeuze}
                title="Voorbeeldweergave"
                onLoad={opFrameGeladen}
                width={breedte}
                height={hoogte}
                className="block border-0"
                // Formulieren en navigatie uit: dit is een plaatje, geen winkel.
                sandbox="allow-same-origin allow-scripts"
                scrolling="no"
              />
            )}

            {/* Klikvanger: houdt élke muisactie tegen voordat die de site raakt. */}
            <div className="absolute inset-0 z-10 cursor-default" aria-hidden />

            {laag !== "scroll" && (
              <canvas
                ref={canvasRef}
                className="pointer-events-none absolute inset-0 z-20"
                style={{ opacity: dekking, mixBlendMode: "multiply" }}
              />
            )}

            {laag === "scroll" &&
              scrollBanden.map((b) => (
                <div
                  key={b.bucket}
                  className="pointer-events-none absolute left-0 right-0 z-20"
                  style={{
                    top: b.top,
                    height: b.hoogte,
                    // Hoe minder mensen hier kwamen, hoe donkerder. Zo zie je in
                    // één blik waar de pagina ophoudt te bestaan voor de klant.
                    background: `rgba(6,10,24,${((100 - b.aandeel) / 100) * dekking * 0.85})`,
                  }}
                >
                  <div className="flex items-start justify-end px-2 pt-0.5 text-[10px] font-medium text-white/80">
                    {b.aandeel}%
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* ── Cijfers ernaast ── */}
        <div className="space-y-6">
          {fout && <p className="rounded border border-red-800 bg-red-950 p-3 text-sm text-red-200">{fout}</p>}
          {bezig && <p className="text-sm text-neutral-400">Laden…</p>}

          {detail && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Tegel label="Weergaven" waarde={detail.weergaven} />
                <Tegel label="Kliks" waarde={totaalKliks} />
                <Tegel
                  label="Dode kliks"
                  waarde={totaalDood}
                  bij={totaalKliks ? `${Math.round((totaalDood / totaalKliks) * 100)}%` : ""}
                  waarschuw={totaalKliks > 50 && totaalDood / totaalKliks > 0.15}
                />
                <Tegel label="Mediaan scroll" waarde={`${detail.medianeScroll}%`} />
              </div>

              {detail.weergaven === 0 && totaalKliks === 0 && (
                <p className="rounded border border-neutral-800 bg-neutral-900 p-3 text-sm text-neutral-400">
                  Nog geen metingen voor deze pagina en dit apparaat. De heatmap meet alleen bezoekers die
                  analytics-cookies hebben geaccepteerd, dus na livegang duurt het even voor hier iets staat.
                </p>
              )}

              <section>
                <h2 className="mb-2 text-sm font-semibold">Meest geklikt</h2>
                <div className="overflow-hidden rounded border border-neutral-800">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2">Element</th>
                        <th className="px-3 py-2 text-right">Kliks</th>
                        <th className="px-3 py-2 text-right">Dood</th>
                        <th className="px-3 py-2 text-right">Woede</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.elementen.map((e) => (
                        <tr key={e.selector} className="border-t border-neutral-800">
                          <td className="px-3 py-2">
                            <span className="block truncate">{e.label || <em className="text-neutral-500">zonder opschrift</em>}</span>
                            <code className="block truncate text-[11px] text-neutral-500">{e.selector}</code>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{e.n}</td>
                          <td className={`px-3 py-2 text-right tabular-nums ${e.doden > 0 ? "text-fuchsia-400" : "text-neutral-600"}`}>
                            {e.doden || "—"}
                          </td>
                          <td className={`px-3 py-2 text-right tabular-nums ${e.woede > 0 ? "text-red-400" : "text-neutral-600"}`}>
                            {e.woede || "—"}
                          </td>
                        </tr>
                      ))}
                      {!detail.elementen.length && (
                        <tr>
                          <td colSpan={4} className="px-3 py-4 text-neutral-500">
                            Nog niets gemeten.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                {totaalWoede > 0 && (
                  <p className="mt-2 text-xs text-neutral-500">
                    Woede-kliks = drie of meer kliks binnen een seconde op dezelfde plek. Vrijwel altijd iets dat traag
                    is of niet reageert.
                  </p>
                )}
              </section>

              <section>
                <h2 className="mb-2 text-sm font-semibold">Hoe ver komt men</h2>
                <div className="space-y-1">
                  {detail.scroll
                    .filter((s) => s.bucket % 10 === 0)
                    .map((s) => (
                      <div key={s.bucket} className="flex items-center gap-2 text-xs">
                        <span className="w-10 tabular-nums text-neutral-500">{s.bucket}%</span>
                        <div className="h-3 flex-1 overflow-hidden rounded bg-neutral-900">
                          <div className="h-full bg-sky-500" style={{ width: `${s.aandeel}%` }} />
                        </div>
                        <span className="w-10 text-right tabular-nums text-neutral-400">{s.aandeel}%</span>
                      </div>
                    ))}
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-sm font-semibold">Alle gemeten pagina&apos;s ({dagen} dagen)</h2>
                <div className="overflow-hidden rounded border border-neutral-800">
                  <table className="w-full text-sm">
                    <thead className="bg-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
                      <tr>
                        <th className="px-3 py-2">Pagina</th>
                        <th className="px-3 py-2 text-right">Weergaven</th>
                        <th className="px-3 py-2 text-right">Kliks</th>
                        <th className="px-3 py-2 text-right">Dood</th>
                        <th className="px-3 py-2 text-right">Scroll</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overzicht.map((r) => (
                        <tr
                          key={r.paginaKey}
                          className={`cursor-pointer border-t border-neutral-800 hover:bg-neutral-900 ${
                            r.paginaKey === pagina ? "bg-neutral-900" : ""
                          }`}
                          onClick={() => setPagina(r.paginaKey)}
                        >
                          <td className="px-3 py-2">{r.titel}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.weergaven}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.kliks}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.kliks ? `${Math.round((r.doden / r.kliks) * 100)}%` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{r.medianeScroll}%</td>
                        </tr>
                      ))}
                      {!overzicht.length && (
                        <tr>
                          <td colSpan={5} className="px-3 py-4 text-neutral-500">
                            Nog geen metingen.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Tegel({
  label,
  waarde,
  bij,
  waarschuw,
}: {
  label: string;
  waarde: number | string;
  bij?: string;
  waarschuw?: boolean;
}) {
  return (
    <div className={`rounded border p-3 ${waarschuw ? "border-fuchsia-700 bg-fuchsia-950/40" : "border-neutral-800 bg-neutral-900"}`}>
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {typeof waarde === "number" ? waarde.toLocaleString("nl-NL") : waarde}
        {bij && <span className="ml-2 text-sm font-normal text-neutral-400">{bij}</span>}
      </p>
    </div>
  );
}

/**
 * Sjabloon zonder gemeten voorbeeld-URL. Een sjabloon met een [parameter] erin
 * is geen echte pagina — dan valt er niets te tonen tot er iets gemeten is.
 */
function vervangbaarPad(key: string): string {
  return key.includes("[") ? "" : key;
}
