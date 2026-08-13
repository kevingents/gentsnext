"use client";

import { useMemo, useState } from "react";
import type { CameraStyle, MediaCronConfig, MediaTheme, MediaThemesStore } from "@/lib/media-themes";

type Props = {
  initial: MediaThemesStore;
  /** Hoofdgroepen waarvoor een merk-kledingregel bestaat (BRAND_RULES-sleutels). */
  categories: string[];
  /** Server-gebouwd voorbeeld, zodat de preview exact de echte prompt-opbouw volgt. */
  previewParts: { brandRule: string; realism: string };
};

const VELD = "w-full min-w-0 border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none";

let nieuweTeller = 0;

export function MediaThemesManager({ initial, categories, previewParts }: Props) {
  const [themes, setThemes] = useState<MediaTheme[]>(initial.themes);
  const [styles, setStyles] = useState<CameraStyle[]>(initial.cameraStyles);
  const [cron, setCron] = useState<MediaCronConfig>(initial.cron);
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");

  // Preview: eerste actieve thema × eerste actieve camerastijl. Zelfde vololgorde
  // als buildPrompt op de server — kledingstuk, camera, plek, kwaliteitseis.
  const preview = useMemo(() => {
    const t = themes.find((x) => x.enabled);
    const c = styles.find((x) => x.enabled);
    if (!t || !c) return "";
    return `${previewParts.brandRule} ${c.prompt} He is ${t.scene}. ${t.light}. ${previewParts.realism}`;
  }, [themes, styles, previewParts]);

  function setTheme(i: number, patch: Partial<MediaTheme>) {
    setThemes((p) => p.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function setStyle(i: number, patch: Partial<CameraStyle>) {
    setStyles((p) => p.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function toggleCategory(i: number, cat: string) {
    setThemes((p) =>
      p.map((t, idx) =>
        idx === i
          ? { ...t, categories: t.categories.includes(cat) ? t.categories.filter((c) => c !== cat) : [...t.categories, cat] }
          : t
      )
    );
  }

  // Elke hoofdgroep hoort bij hooguit één actief thema — de generator pakt de
  // eerste match, dus een dubbele koppeling betekent stilzwijgend dat het tweede
  // thema nooit draait. Dat laten we hier zien in plaats van het te verbergen.
  const dubbel = useMemo(() => {
    const gezien = new Map<string, string>();
    const out: string[] = [];
    for (const t of themes) {
      if (!t.enabled) continue;
      for (const c of t.categories) {
        const eerder = gezien.get(c);
        if (eerder) out.push(`${c} staat bij "${eerder}" én "${t.label}" — alleen "${eerder}" wordt gebruikt.`);
        else gezien.set(c, t.label);
      }
    }
    return out;
  }, [themes]);

  const zonderThema = useMemo(
    () => categories.filter((c) => !themes.some((t) => t.enabled && t.categories.includes(c))),
    [categories, themes]
  );

  async function opslaan() {
    setState("busy");
    setMsg("");
    try {
      const res = await fetch("/api/account/beeldthemas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ themes, cameraStyles: styles, cron }),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setState("fail");
        setMsg(j.error || "Opslaan mislukt.");
        return;
      }
      setThemes(j.themes);
      setStyles(j.cameraStyles);
      setCron(j.cron);
      setState("done");
      setMsg("Opgeslagen. De volgende generatie-run gebruikt deze thema's.");
    } catch {
      setState("fail");
      setMsg("Opslaan mislukt — netwerkfout.");
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="font-sans text-sm font-semibold text-ink">Thema&apos;s — het wáár</h2>
        <p className="mt-1 font-sans text-xs text-muted">
          De omgeving waarin het model staat. Schrijf de scène in het Engels; die gaat letterlijk de prompt in.
        </p>

        <ul className="mt-4 space-y-4">
          {themes.map((t, i) => (
            <li key={t.id || i} className="border border-line p-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={t.label}
                  onChange={(e) => setTheme(i, { label: e.target.value })}
                  placeholder="Naam van het thema"
                  aria-label="Naam van het thema"
                  className={`${VELD} sm:w-64`}
                />
                <label className="flex items-center gap-2 font-sans text-sm text-ink">
                  <input type="checkbox" checked={t.enabled} onChange={(e) => setTheme(i, { enabled: e.target.checked })} />
                  Actief
                </label>
                <button
                  type="button"
                  onClick={() => setThemes((p) => p.filter((_, idx) => idx !== i))}
                  className="ml-auto font-sans text-sm text-danger underline"
                >
                  Verwijder
                </button>
              </div>

              <label className="mt-3 block font-sans text-xs text-muted" htmlFor={`scene-${i}`}>
                Scène (Engels)
              </label>
              <textarea
                id={`scene-${i}`}
                value={t.scene}
                onChange={(e) => setTheme(i, { scene: e.target.value })}
                rows={3}
                className={VELD}
              />

              <label className="mt-3 block font-sans text-xs text-muted" htmlFor={`light-${i}`}>
                Licht en kleurtoon (Engels)
              </label>
              <input id={`light-${i}`} value={t.light} onChange={(e) => setTheme(i, { light: e.target.value })} className={VELD} />

              <p className="mt-3 font-sans text-xs text-muted">Geldt voor</p>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {categories.map((c) => (
                  <label key={c} className="flex items-center gap-1.5 font-sans text-sm text-ink">
                    <input type="checkbox" checked={t.categories.includes(c)} onChange={() => toggleCategory(i, c)} />
                    {c}
                  </label>
                ))}
              </div>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            nieuweTeller += 1;
            setThemes((p) => [
              ...p,
              { id: `nieuw-${nieuweTeller}`, label: "", scene: "", light: "", categories: [], enabled: true },
            ]);
          }}
          className="btn-ghost mt-3 !px-4 !py-2"
        >
          Thema toevoegen
        </button>
      </section>

      <section>
        <h2 className="font-sans text-sm font-semibold text-ink">Camerastijlen — het hóé</h2>
        <p className="mt-1 font-sans text-xs text-muted">
          Licht, hoek en uitsnede. Dit is de GENTS-signatuur en verandert zelden. Elk thema wordt over alle actieve
          camerastijlen geroteerd, dus {themes.filter((t) => t.enabled).length} thema&apos;s ×{" "}
          {styles.filter((s) => s.enabled).length} stijlen ={" "}
          {themes.filter((t) => t.enabled).length * styles.filter((s) => s.enabled).length} verschillende looks.
        </p>

        <ul className="mt-4 space-y-4">
          {styles.map((s, i) => (
            <li key={s.id || i} className="border border-line p-4">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  value={s.label}
                  onChange={(e) => setStyle(i, { label: e.target.value })}
                  placeholder="Naam van de stijl"
                  aria-label="Naam van de camerastijl"
                  className={`${VELD} sm:w-64`}
                />
                <label className="flex items-center gap-2 font-sans text-sm text-ink">
                  <input type="checkbox" checked={s.enabled} onChange={(e) => setStyle(i, { enabled: e.target.checked })} />
                  Actief
                </label>
                <button
                  type="button"
                  onClick={() => setStyles((p) => p.filter((_, idx) => idx !== i))}
                  className="ml-auto font-sans text-sm text-danger underline"
                >
                  Verwijder
                </button>
              </div>
              <label className="mt-3 block font-sans text-xs text-muted" htmlFor={`camera-${i}`}>
                Camera-instructie (Engels)
              </label>
              <textarea
                id={`camera-${i}`}
                value={s.prompt}
                onChange={(e) => setStyle(i, { prompt: e.target.value })}
                rows={3}
                className={VELD}
              />
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => {
            nieuweTeller += 1;
            setStyles((p) => [...p, { id: `stijl-${nieuweTeller}`, label: "", prompt: "", enabled: true }]);
          }}
          className="btn-ghost mt-3 !px-4 !py-2"
        >
          Camerastijl toevoegen
        </button>
      </section>

      {dubbel.length ? (
        <div className="border border-line bg-surface p-4">
          <p className="font-sans text-sm font-semibold text-ink">Let op</p>
          <ul className="mt-1 list-disc pl-5 font-sans text-sm text-ink-soft">
            {dubbel.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {zonderThema.length ? (
        <p className="font-sans text-sm text-muted">
          Zonder thema (deze categorieën krijgen geen sfeerbeelden): {zonderThema.join(", ")}.
        </p>
      ) : null}

      <section>
        <h2 className="font-sans text-sm font-semibold text-ink">Automatisch aanvullen (nachtelijk)</h2>
        <p className="mt-1 font-sans text-xs text-muted">
          Elke nacht om 03:30 vult de generator een batch producten aan die nog geen sfeerbeeld hebben. Bestaande
          beelden worden nooit overschreven. Dit kost FASHN-credits, vandaar de twee remmen hieronder.
        </p>

        <label className="mt-3 flex items-center gap-2 font-sans text-sm text-ink">
          <input type="checkbox" checked={cron.enabled} onChange={(e) => setCron({ ...cron, enabled: e.target.checked })} />
          Automatisch aanvullen staat aan
        </label>

        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="block font-sans text-xs text-muted" htmlFor="cron-perrun">
              Beelden per nacht
            </label>
            <input
              id="cron-perrun"
              type="number"
              min={1}
              max={8}
              value={cron.perRun}
              onChange={(e) => setCron({ ...cron, perRun: Number(e.target.value) })}
              className={VELD}
            />
            <p className="mt-1 font-sans text-xs text-muted">Max 8 — hoger past niet in de 5 minuten die Vercel geeft.</p>
          </div>
          <div>
            <label className="block font-sans text-xs text-muted" htmlFor="cron-max">
              Max credits per nacht
            </label>
            <input
              id="cron-max"
              type="number"
              min={7}
              value={cron.maxCreditsPerRun}
              onChange={(e) => setCron({ ...cron, maxCreditsPerRun: Number(e.target.value) })}
              className={VELD}
            />
            <p className="mt-1 font-sans text-xs text-muted">Ongeveer 7 credits per beeld.</p>
          </div>
          <div>
            <label className="block font-sans text-xs text-muted" htmlFor="cron-min">
              Stop onder saldo
            </label>
            <input
              id="cron-min"
              type="number"
              min={0}
              value={cron.minCreditsLeft}
              onChange={(e) => setCron({ ...cron, minCreditsLeft: Number(e.target.value) })}
              className={VELD}
            />
            <p className="mt-1 font-sans text-xs text-muted">Noodrem: hieronder doet de cron niets meer.</p>
          </div>
        </div>
      </section>

      <section>
        <h2 className="font-sans text-sm font-semibold text-ink">Zo ziet de prompt eruit</h2>
        <p className="mt-1 font-sans text-xs text-muted">
          Eerste actieve thema × eerste actieve camerastijl. De kledingregel en de kwaliteitseis staan vast in de code —
          die kunnen hier niet per ongeluk verdwijnen.
        </p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap border border-line bg-surface p-3 font-sans text-xs text-ink-soft">
          {preview || "Zet minstens één thema en één camerastijl aan."}
        </pre>
      </section>

      <div className="flex items-center gap-4">
        <button type="button" onClick={opslaan} disabled={state === "busy"} className="btn-primary">
          {state === "busy" ? "Opslaan…" : "Opslaan"}
        </button>
        {msg ? (
          <p className={`font-sans text-sm ${state === "fail" ? "text-danger" : "text-ink-soft"}`}>{msg}</p>
        ) : null}
      </div>
    </div>
  );
}
