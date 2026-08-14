"use client";

import { useEffect, useRef, useState } from "react";

/**
 * "Zie jezelf in smoking" — de klant uploadt een foto en krijgt zichzelf terug
 * in de smoking die hij net heeft samengesteld, deelbaar via WhatsApp.
 *
 * De generator draait in het portaal (storegents), niet hier: daar zitten de
 * sleutel, de dagcap en de bewaartermijn al, en die wil je niet op twee plekken
 * onderhouden. Dit is de schil eromheen.
 *
 * Drie dingen zitten hier bewust in:
 *
 *   VERKLEINEN VOOR VERZENDEN. Een telefoonfoto is zo 6 MB; base64 maakt het
 *   nog een derde groter en de serverless-limiet ligt rond 4,5 MB. We schalen
 *   naar 1200px — ook gewoon sneller op 4G.
 *
 *   EEN ECHT TOESTEMMINGSVINKJE. Er gaat een gezichtsfoto naar een externe
 *   dienst. Zonder aangevinkt akkoord versturen we niets, en het vakje staat
 *   niet voorgevinkt.
 *
 *   NIETS TONEN ALS HET NIET KAN. Staat de generator uit of ontbreekt de
 *   sleutel, dan verdwijnt het hele blok. Een dode knop is erger dan geen knop.
 */

const API = process.env.NEXT_PUBLIC_LOOKLAB_URL || "https://storegents.vercel.app/api/storefront/looklab";

type Look = { id: string; label: string; omschrijving: string };
type Config = {
  enabled: boolean;
  heading: string;
  intro: string;
  knoptekst: string;
  bewaarDagen: number;
  perBezoekerPerDag: number;
  looks: Look[];
};
type Resultaat = {
  beeldUrl: string;
  lookLabel: string;
  deelUrl: string;
  deelTekst: string;
  resterendVandaag: number;
};

export function SmokingLook({ smokingNaam, kledingUrl }: { smokingNaam?: string; kledingUrl?: string }) {
  const [config, setConfig] = useState<Config | null>(null);
  const [look, setLook] = useState<string>("");
  const [foto, setFoto] = useState<string | null>(null);
  const [akkoord, setAkkoord] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string>("");
  const [resultaat, setResultaat] = useState<Resultaat | null>(null);
  const bestandRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let levend = true;
    fetch(API)
      .then((r) => r.json())
      .then((d) => {
        if (!levend || !d?.success || !d.enabled || !d.looks?.length) return;
        setConfig(d as Config);
        setLook(d.looks[0].id);
      })
      .catch(() => {});
    return () => {
      levend = false;
    };
  }, []);

  if (!config) return null;

  async function kiesBestand(bestand: File) {
    setFout("");
    if (bestand.size > 25 * 1024 * 1024) {
      setFout("Die foto is wel erg groot. Kies er een tot 25 MB.");
      return;
    }
    try {
      setFoto(await verklein(bestand, 1200));
    } catch (e) {
      setFout(e instanceof Error ? e.message : "De foto kon niet worden gelezen.");
    }
  }

  async function maakLook() {
    if (!foto || !akkoord || bezig) return;
    setBezig(true);
    setFout("");
    try {
      const res = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* De foto van de gekozen jas gaat mee: FASHN trekt DAT kledingstuk aan,
           zodat de klant zichzelf in ons artikel ziet en niet in een verzinsel. */
        body: JSON.stringify({ look, foto, akkoord: true, kledingUrl }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.message || "Het maken van de look lukte niet.");
      setResultaat(d as Resultaat);
    } catch (e) {
      setFout(e instanceof Error ? e.message : "Er ging iets mis.");
    } finally {
      setBezig(false);
    }
  }

  return (
    <section className="mt-16 overflow-hidden rounded-lg border border-line bg-ink text-canvas">
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="font-sans text-xs font-semibold uppercase tracking-[0.2em] text-canvas/50">
            Voor je bestelt
          </p>
          <h2 className="mt-3 text-2xl font-semibold sm:text-3xl">{config.heading}</h2>
          <p className="mt-3 max-w-md font-sans text-sm leading-relaxed text-canvas/70">
            {config.intro}
            {smokingNaam ? ` Je ziet jezelf in de ${smokingNaam} die je hierboven koos — het echte artikel.` : ""}
          </p>

          {!resultaat && (
            <>
              <button
                type="button"
                onClick={() => bestandRef.current?.click()}
                className="mt-8 flex w-full max-w-md items-center gap-4 rounded-lg border border-dashed border-canvas/30 p-4 text-left transition hover:border-canvas/60"
              >
                {foto ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={foto} alt="Jouw foto" className="h-16 w-16 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-canvas/10 text-2xl">
                    +
                  </span>
                )}
                <span>
                  <span className="block font-sans text-sm font-medium">
                    {foto ? "Andere foto kiezen" : "Kies of maak een foto"}
                  </span>
                  <span className="block font-sans text-xs text-canvas/60">
                    Recht van voren, hoofd en schouders in beeld.
                  </span>
                </span>
              </button>
              <input
                ref={bestandRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void kiesBestand(f);
                }}
              />

              <label className="mt-4 flex max-w-md cursor-pointer items-start gap-3 font-sans text-xs text-canvas/60">
                <input
                  type="checkbox"
                  checked={akkoord}
                  onChange={(e) => setAkkoord(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  Dit is een foto van mezelf en ik ga ermee akkoord dat die eenmalig wordt verwerkt om mijn
                  look te maken. De foto wordt daarna direct verwijderd; het resultaat bewaren we{" "}
                  {config.bewaarDagen} dagen.
                </span>
              </label>

              <button
                type="button"
                onClick={() => void maakLook()}
                disabled={!foto || !akkoord || bezig}
                className="mt-5 h-12 w-full max-w-md rounded-lg bg-canvas font-sans text-sm font-semibold text-ink transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                {bezig ? "Je smoking wordt aangemeten…" : config.knoptekst}
              </button>
              <p className="mt-3 max-w-md font-sans text-xs text-canvas/50" role={fout ? "alert" : undefined}>
                {fout || `Duurt ongeveer een halve minuut. Je mag er ${config.perBezoekerPerDag} per dag maken.`}
              </p>
            </>
          )}
        </div>

        <div className="relative">
          {resultaat ? (
            <div className="flex flex-col gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={resultaat.beeldUrl}
                alt={`Jouw smoking-look: ${resultaat.lookLabel}`}
                className="w-full rounded-lg"
              />
              <div className="flex flex-wrap gap-2">
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(`${resultaat.deelTekst} ${resultaat.deelUrl}`)}`}
                  target="_blank"
                  rel="noopener"
                  className="flex-1 rounded-lg bg-canvas px-4 py-3 text-center font-sans text-sm font-semibold text-ink"
                >
                  Delen via WhatsApp
                </a>
                <a
                  href={resultaat.beeldUrl}
                  download="gents-smoking-look.jpg"
                  className="flex-1 rounded-lg border border-canvas/30 px-4 py-3 text-center font-sans text-sm font-semibold"
                >
                  Opslaan
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setResultaat(null);
                    setFoto(null);
                    setAkkoord(false);
                  }}
                  className="rounded-lg border border-canvas/30 px-4 py-3 font-sans text-sm"
                >
                  Andere look
                </button>
              </div>
              <p className="font-sans text-xs text-canvas/50">
                Met AI gemaakt op basis van jouw foto — het is geen echte foto. Je originele foto is verwijderd.
                {resultaat.resterendVandaag > 0
                  ? ` Je kunt er vandaag nog ${resultaat.resterendVandaag} maken.`
                  : " Dit was je laatste voor vandaag."}
              </p>
            </div>
          ) : (
            <div className="aspect-[3/4] w-full rounded-lg bg-canvas/5 ring-1 ring-inset ring-canvas/10">
              <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
                <span className="font-sans text-xs uppercase tracking-[0.2em] text-canvas/40">
                  {bezig ? "Bezig" : "Jouw look"}
                </span>
                <p className="max-w-xs font-sans text-sm text-canvas/50">
                  {bezig
                    ? "Even geduld — dit duurt ongeveer een halve minuut."
                    : "Upload een foto en zie jezelf hier terug in smoking."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/**
 * Foto verkleinen in de browser. EXIF-rotatie laten we aan de browser over.
 */
function verklein(bestand: File, maxZijde: number): Promise<string> {
  return new Promise((klaar, mislukt) => {
    const lezer = new FileReader();
    lezer.onerror = () => mislukt(new Error("De foto kon niet worden gelezen."));
    lezer.onload = () => {
      const beeld = new window.Image();
      beeld.onerror = () => mislukt(new Error("Dit lijkt geen geldige foto."));
      beeld.onload = () => {
        const schaal = Math.min(1, maxZijde / Math.max(beeld.width, beeld.height));
        const doek = document.createElement("canvas");
        doek.width = Math.round(beeld.width * schaal);
        doek.height = Math.round(beeld.height * schaal);
        doek.getContext("2d")?.drawImage(beeld, 0, 0, doek.width, doek.height);
        klaar(doek.toDataURL("image/jpeg", 0.86));
      };
      beeld.src = String(lezer.result);
    };
    lezer.readAsDataURL(bestand);
  });
}
