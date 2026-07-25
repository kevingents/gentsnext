"use client";

import { useEffect, useMemo, useState } from "react";
import { formatEuro } from "@/lib/format";
import type { PinContext, PinItem, PinSinceMap } from "@/lib/merchandising-admin";

/**
 * "Uitgelicht" — merchandising-pins beheren vanuit de Site-studio.
 *
 * Bewuste keuzes in deze UI:
 *  - Per pin staat zichtbaar SINDS WANNEER die er staat, met een waarschuwing
 *    zodra een pin lang blijft staan. Een pin overrulet namelijk alle
 *    gedragssignalen in de "Aanbevolen"-sort; zonder datum blijft dat
 *    onopgemerkt.
 *  - Wijzigingen gelden per context en worden pas actief na "Opslaan", zodat
 *    een half afgemaakte volgorde nooit live staat.
 */

const CARD = "rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal";
const FIELD =
  "rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:cursor-not-allowed disabled:opacity-40";
const BTN_SMALL =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:cursor-not-allowed disabled:opacity-30";

const MAX_PINS = 24;
/** Vanaf hier vindt de UI een pin "oud" en vraagt om een bewuste herbevestiging. */
const STALE_DAYS = 60;

const MONTHS = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/**
 * Vaste NL-notatie, gelezen uit het ISO-datumdeel zelf (geen Intl, geen
 * new Date()) — de server draait in UTC en de browser in NL-tijd; via een
 * Date-object zou dezelfde pin rond middernacht een andere dag tonen en dat
 * geeft een hydration-mismatch.
 */
function dateLabel(iso: string | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month} ${Number(m[1])}`;
}

function daysSince(iso: string | undefined): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86_400_000));
}

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={path} />
    </svg>
  );
}

const P_UP = "M12 19V5M5 12l7-7 7 7";
const P_DOWN = "M12 5v14M19 12l-7 7-7-7";
const P_TRASH = "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3";
const P_PLUS = "M12 5v14M5 12h14";
const P_SEARCH = "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3";
const P_WARN = "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z";

type Props = {
  contexts: PinContext[];
  /** Opgeslagen pins per context-sleutel, in de gepinde volgorde. */
  pins: Record<string, PinItem[]>;
  since: PinSinceMap;
};

export function MerchandisingEditor({ contexts, pins, since }: Props) {
  const firstKey = contexts.find((c) => (pins[c.key] || []).length > 0)?.key || contexts[0]?.key || "";

  const [savedByKey, setSavedByKey] = useState<Record<string, PinItem[]>>(pins);
  const [sinceByKey, setSinceByKey] = useState<PinSinceMap>(since);
  const [activeKey, setActiveKey] = useState(firstKey);
  const [draft, setDraft] = useState<PinItem[]>(pins[firstKey] || []);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "fail"; text: string } | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<PinItem[]>([]);
  const [searching, setSearching] = useState(false);
  // Ouderdom hangt af van "nu" → pas ná mount tonen, anders wijkt de
  // server-render af van de client-render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const active = contexts.find((c) => c.key === activeKey) || null;
  const activeSince = sinceByKey[activeKey] || {};
  const pinnedHandles = useMemo(() => new Set(draft.map((i) => i.handle)), [draft]);

  const dirty = useMemo(() => {
    const saved = (savedByKey[activeKey] || []).map((i) => i.handle).join("|");
    return draft.map((i) => i.handle).join("|") !== saved;
  }, [draft, savedByKey, activeKey]);

  const groups = useMemo(() => {
    const out: { title: string; items: PinContext[] }[] = [];
    for (const c of contexts) {
      const g = out.find((x) => x.title === c.group);
      if (g) g.items.push(c);
      else out.push({ title: c.group, items: [c] });
    }
    return out;
  }, [contexts]);

  const overview = useMemo(
    () =>
      contexts
        .map((c) => ({ ctx: c, items: savedByKey[c.key] || [] }))
        .filter((row) => row.items.length > 0),
    [contexts, savedByKey]
  );

  // Zoeken (debounced). Een afgebroken zoekopdracht mag de nieuwste niet overschrijven.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/account/merchandising?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const d = await r.json();
        if (!cancelled) setResults(Array.isArray(d.results) ? (d.results as PinItem[]) : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [q]);

  function switchContext(key: string) {
    if (dirty && !window.confirm("Je hebt wijzigingen die nog niet zijn opgeslagen. Weggooien?")) return;
    setActiveKey(key);
    setDraft(savedByKey[key] || []);
    setMsg(null);
    setQ("");
    setResults([]);
  }

  function addPin(item: PinItem) {
    if (pinnedHandles.has(item.handle)) return;
    if (draft.length >= MAX_PINS) {
      setMsg({ tone: "fail", text: `Maximaal ${MAX_PINS} gepinde producten per categorie of collectie.` });
      return;
    }
    setDraft((d) => [...d, { ...item, known: true }]);
    setMsg(null);
  }

  function removePin(handle: string) {
    setDraft((d) => d.filter((i) => i.handle !== handle));
    setMsg(null);
  }

  function movePin(index: number, delta: number) {
    setDraft((d) => {
      const next = [...d];
      const target = index + delta;
      if (target < 0 || target >= next.length) return d;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    setMsg(null);
  }

  async function save() {
    if (!active) return;
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/account/merchandising", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: active.kind, slug: active.slug, handles: draft.map((i) => i.handle) }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) {
        setMsg({ tone: "fail", text: String(d.error || "Opslaan mislukt.") });
      } else {
        const pinned = Array.isArray(d.pinned) ? (d.pinned as PinItem[]) : [];
        setSavedByKey((s) => ({ ...s, [active.key]: pinned }));
        setSinceByKey((s) => ({ ...s, [active.key]: (d.since as Record<string, string>) || {} }));
        setDraft(pinned);
        setMsg({
          tone: "ok",
          text: pinned.length
            ? `Opgeslagen — ${pinned.length} product${pinned.length === 1 ? "" : "en"} staat bovenaan bij ${active.label}.`
            : `Opgeslagen — er staat niets meer vastgezet bij ${active.label}; de ranking volgt weer volledig het klantgedrag.`,
        });
      }
    } catch {
      setMsg({ tone: "fail", text: "Opslaan mislukt — probeer het opnieuw." });
    } finally {
      setSaving(false);
    }
  }

  if (!contexts.length) {
    return <div className={CARD}><p className="text-sm text-pslate">Er zijn nog geen categorieën of collecties om in te pinnen.</p></div>;
  }

  return (
    <div className="space-y-5">
      {/* Waarschuwing: pins gaan vóór alles wat we van klanten meten. */}
      <div className="flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <span className="mt-0.5 shrink-0 text-amber-700">
          <Icon path={P_WARN} className="h-5 w-5" />
        </span>
        <div className="text-sm text-amber-900">
          <p className="font-semibold">Een pin krijgt permanent voorrang boven het klantgedrag.</p>
          <p className="mt-1">
            Wat je hier vastzet, staat bovenaan bij &quot;Aanbevolen&quot; — vóór populariteit, vóór de maat van de klant en
            vóór zijn eerdere keuzes. De ranking corrigeert dat niet: een gepind product blijft bovenaan staan, ook als
            klanten aantoonbaar iets anders bekijken, in het mandje leggen en kopen. Een pin blijft staan tot je hem zelf
            weghaalt. Zet er dus alleen producten in die je bewust wilt pushen, en loop de lijst regelmatig na —
            hieronder zie je bij elke pin sinds wanneer die er staat.
          </p>
          <p className="mt-1 text-amber-800">
            Pins werken alleen op de standaardsortering &quot;Aanbevolen&quot;. Kiest de klant zelf een sortering (prijs,
            nieuw), dan tellen ze niet mee.
          </p>
        </div>
      </div>

      {/* Contextkeuze */}
      <div className={CARD}>
        <label className="block">
          <span className="text-xs font-semibold uppercase tracking-wider text-pslate">Categorie of collectie</span>
          <select
            value={activeKey}
            onChange={(e) => switchContext(e.target.value)}
            className={`mt-1.5 w-full max-w-lg ${FIELD}`}
          >
            {groups.map((g) => (
              <optgroup key={g.title} label={g.title}>
                {g.items.map((c) => {
                  const n = (savedByKey[c.key] || []).length;
                  return (
                    <option key={c.key} value={c.key}>
                      {c.label}
                      {n ? ` — ${n} vastgezet` : ""}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </label>
        {active ? (
          <p className="mt-2 text-sm text-pslate">
            Deze lijst geldt voor{" "}
            <span className="font-medium text-pnavy">
              {active.kind === "categorie" ? `/categorie/${active.slug}` : `/collections/${active.slug}`}
            </span>
            {active.group === "Onbekende context" ? (
              <span className="text-red-700"> — deze pagina bestaat niet meer; ruim deze pins op.</span>
            ) : null}
          </p>
        ) : null}
      </div>

      {/* Gepinde producten */}
      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-pslate">
            Vastgezet bovenaan{active ? ` — ${active.label}` : ""} ({draft.length}/{MAX_PINS})
          </p>
          <div className="flex items-center gap-3">
            {dirty ? <span className="text-sm text-amber-700">Nog niet opgeslagen</span> : null}
            <button type="button" onClick={save} disabled={saving || !dirty} className={BTN_PRIMARY}>
              {saving ? "Bezig…" : "Opslaan"}
            </button>
          </div>
        </div>

        {msg ? (
          <p className={`mb-3 text-sm ${msg.tone === "fail" ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p>
        ) : null}

        {draft.length === 0 ? (
          <p className="text-sm text-pslate">
            Niets vastgezet. De volgorde volgt hier volledig de ranking: wat klanten bekijken, in het mandje leggen en
            kopen. Dat is meestal de beste stand — pin alleen als je een bewuste reden hebt.
          </p>
        ) : (
          <ol className="space-y-2">
            {draft.map((item, i) => {
              const iso = activeSince[item.handle];
              const label = dateLabel(iso);
              const age = daysSince(iso);
              const stale = mounted && age !== null && age >= STALE_DAYS;
              return (
                <li
                  key={item.handle}
                  className="flex items-center gap-3 rounded-lg border border-pnavy-100 bg-pcream/60 p-2.5"
                >
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-pnavy text-xs font-semibold text-cream">
                    {i + 1}
                  </span>
                  <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded bg-white">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={item.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] text-pslate">geen foto</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-pnavy">{item.title}</span>
                    <span className="block truncate text-xs text-pslate">
                      {item.handle}
                      {item.priceCents != null ? ` · ${formatEuro(item.priceCents)}` : ""}
                    </span>
                    <span className="mt-0.5 block text-xs">
                      {label ? (
                        <span className={stale ? "font-medium text-amber-700" : "text-pslate"}>
                          Gepind sinds {label}
                          {mounted && age !== null ? ` (${age} dag${age === 1 ? "" : "en"})` : ""}
                          {stale ? " — nog steeds terecht?" : ""}
                        </span>
                      ) : (
                        <span className="text-pslate">Gepind sinds: onbekend (gezet vóór deze pagina bestond)</span>
                      )}
                    </span>
                    {!item.known ? (
                      <span className="mt-0.5 block text-xs font-medium text-red-700">
                        Niet meer in de catalogus — deze pin doet niets meer; haal hem weg.
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => movePin(i, -1)}
                      disabled={i === 0}
                      aria-label="Naar boven"
                      title="Naar boven"
                      className={BTN_SMALL}
                    >
                      <Icon path={P_UP} />
                    </button>
                    <button
                      type="button"
                      onClick={() => movePin(i, 1)}
                      disabled={i === draft.length - 1}
                      aria-label="Naar beneden"
                      title="Naar beneden"
                      className={BTN_SMALL}
                    >
                      <Icon path={P_DOWN} />
                    </button>
                    <button
                      type="button"
                      onClick={() => removePin(item.handle)}
                      aria-label="Pin verwijderen"
                      title="Pin verwijderen"
                      className={BTN_SMALL}
                    >
                      <Icon path={P_TRASH} />
                    </button>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {/* Product zoeken en toevoegen */}
      <section className={CARD}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-pslate">Product zoeken</p>
        <label className="relative block max-w-lg">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-pslate">
            <Icon path={P_SEARCH} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek op titel, merk of categorie — bijv. pak blauw"
            className={`w-full pl-9 ${FIELD}`}
          />
        </label>
        <p className="mt-1.5 text-xs text-pslate">
          Alleen actieve producten met foto en voorraad kunnen gepind worden — die staan ook echt in de lijst.
        </p>

        <div className="mt-3">
          {q.trim().length < 2 ? (
            <p className="text-sm text-pslate">Typ minstens twee tekens.</p>
          ) : searching ? (
            <p className="text-sm text-pslate">Zoeken…</p>
          ) : results.length === 0 ? (
            <p className="text-sm text-pslate">Geen producten gevonden voor &quot;{q.trim()}&quot;.</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {results.map((r) => {
                const already = pinnedHandles.has(r.handle);
                return (
                  <li key={r.handle} className="flex items-center gap-3 rounded-lg border border-pnavy-100 p-2.5">
                    <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded bg-pcream">
                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.imageUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-pslate">geen foto</span>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-pnavy">{r.title}</span>
                      <span className="block truncate text-xs text-pslate">
                        {r.handle}
                        {r.priceCents != null ? ` · ${formatEuro(r.priceCents)}` : ""}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => addPin(r)}
                      disabled={already}
                      className={BTN_SMALL}
                      title={already ? "Staat al vastgezet" : "Bovenaan vastzetten"}
                    >
                      <Icon path={P_PLUS} />
                      {already ? "Vastgezet" : "Vastzetten"}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Overzicht: waar staat er nu iets vastgezet? */}
      <section className={CARD}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-pslate">Overzicht van alle pins</p>
        {overview.length === 0 ? (
          <p className="text-sm text-pslate">Nergens staat iets vastgezet — overal bepaalt het klantgedrag de volgorde.</p>
        ) : (
          <ul className="divide-y divide-pnavy-100">
            {overview.map(({ ctx, items }) => {
              const dates = items
                .map((i) => (sinceByKey[ctx.key] || {})[i.handle])
                .filter((v): v is string => Boolean(v))
                .sort();
              const oldest = dateLabel(dates[0]);
              return (
                <li key={ctx.key} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <button
                    type="button"
                    onClick={() => switchContext(ctx.key)}
                    className="text-left font-medium text-pnavy hover:underline"
                  >
                    {ctx.label}
                    <span className="ml-2 text-xs font-normal text-pslate">{ctx.group}</span>
                  </button>
                  <span className="text-pslate">
                    {items.length} vastgezet
                    {oldest ? ` · oudste pin sinds ${oldest}` : " · datum onbekend"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
