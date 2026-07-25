"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { btnPrimary, btnSecondary, fieldClass } from "@/components/account/report-ui";

/**
 * Vertalingen beheren (Site-studio). Per taal alle Nederlandse bronteksten met
 * hun vertaling ernaast: zoeken, handmatig overschrijven (dan blijft de
 * nachtelijke vertaal-cron eraf) en een override terugzetten op automatisch.
 */

export type TransRow = { ns: string; key: string; source: string; value: string; manual: boolean; fresh: boolean };
export type TransStats = { totaal: number; vertaald: number; handmatig: number; verouderd: number };
export type TransPayload = { rows: TransRow[]; total: number; page: number; pageSize: number; stats: TransStats };

type Props = {
  initial: TransPayload;
  initialLocale: string;
  locales: string[];
  localeLabels: Record<string, string>;
  namespaces: { ns: string; label: string }[];
  providerReady: boolean;
};

const rowId = (r: { ns: string; key: string }) => `${r.ns}:${r.key}`;

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICON_SEARCH = "M11 19a8 8 0 100-16 8 8 0 000 16zM21 21l-4.3-4.3";
const ICON_CHECK = "M20 6L9 17l-5-5";
const ICON_ALERT = "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z";

export function TranslationsManager({ initial, initialLocale, locales, localeLabels, namespaces, providerReady }: Props) {
  const [locale, setLocale] = useState(initialLocale);
  const [ns, setNs] = useState("");
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<TransPayload>(initial);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgFail, setMsgFail] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyRow, setBusyRow] = useState("");
  const [running, setRunning] = useState(false);

  // De eerste render komt van de server — die fetch slaan we over.
  const skipFirst = useRef(true);
  const reqNr = useRef(0);

  const load = useCallback(async () => {
    const nr = ++reqNr.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ locale, page: String(page) });
      if (ns) params.set("ns", ns);
      if (q.trim()) params.set("q", q.trim());
      if (onlyOpen) params.set("open", "1");
      const r = await fetch(`/api/account/vertalingen?${params.toString()}`, { cache: "no-store" });
      const d = (await r.json()) as TransPayload & { ok?: boolean; error?: string };
      if (nr !== reqNr.current) return; // een nieuwere zoekopdracht is al onderweg
      if (r.ok && d.ok) {
        setData({ rows: d.rows, total: d.total, page: d.page, pageSize: d.pageSize, stats: d.stats });
        setDrafts({});
      } else {
        setMsgFail(true);
        setMsg(d.error || "Ophalen mislukte.");
      }
    } catch {
      if (nr === reqNr.current) {
        setMsgFail(true);
        setMsg("Ophalen mislukte.");
      }
    } finally {
      if (nr === reqNr.current) setLoading(false);
    }
  }, [locale, ns, q, onlyOpen, page]);

  useEffect(() => {
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    const t = setTimeout(load, 300); // even wachten bij typen in het zoekveld
    return () => clearTimeout(t);
  }, [load]);

  /** Filter wijzigen zet altijd terug naar pagina 1. */
  function changeFilter(fn: () => void) {
    fn();
    setPage(1);
  }

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; warnings?: string[] }> {
    const r = await fetch("/api/account/vertalingen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = (await r.json()) as { ok?: boolean; error?: string; warnings?: string[] };
    return { ok: Boolean(r.ok && d.ok), error: d.error, warnings: d.warnings };
  }

  async function save(row: TransRow) {
    const id = rowId(row);
    const value = (drafts[id] ?? row.value).trim();
    if (!value) {
      setMsgFail(true);
      setMsg("Vul eerst een vertaling in.");
      return;
    }
    setBusyRow(id);
    const res = await post({ locale, ns: row.ns, key: row.key, value });
    setBusyRow("");
    if (!res.ok) {
      setMsgFail(true);
      setMsg(res.error || "Opslaan mislukte.");
      return;
    }
    setData((p) => ({
      ...p,
      rows: p.rows.map((r) => (rowId(r) === id ? { ...r, value, manual: true, fresh: true } : r)),
      stats: {
        ...p.stats,
        vertaald: p.stats.vertaald + (row.value ? 0 : 1),
        handmatig: p.stats.handmatig + (row.manual ? 0 : 1),
        verouderd: Math.max(0, p.stats.verouderd - (row.value && !row.fresh && !row.manual ? 1 : 0)),
      },
    }));
    setDrafts((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    setMsgFail(false);
    setMsg("Opgeslagen — deze tekst wordt niet meer automatisch overschreven.");
  }

  async function reset(row: TransRow) {
    const id = rowId(row);
    setBusyRow(id);
    const res = await post({ action: "reset", locale, ns: row.ns, key: row.key });
    setBusyRow("");
    if (!res.ok) {
      setMsgFail(true);
      setMsg(res.error || "Terugzetten mislukte.");
      return;
    }
    setData((p) => ({
      ...p,
      rows: p.rows.map((r) => (rowId(r) === id ? { ...r, value: "", manual: false, fresh: false } : r)),
      stats: {
        ...p.stats,
        vertaald: Math.max(0, p.stats.vertaald - (row.value ? 1 : 0)),
        handmatig: Math.max(0, p.stats.handmatig - (row.manual ? 1 : 0)),
      },
    }));
    setDrafts((p) => {
      const next = { ...p };
      delete next[id];
      return next;
    });
    setMsgFail(false);
    setMsg("Terug op automatisch — de eerstvolgende vertaalronde pakt deze tekst opnieuw op.");
  }

  async function runNow() {
    setRunning(true);
    setMsgFail(false);
    setMsg("Bezig met vertalen — dit kan enkele minuten duren. Laat dit scherm open.");
    const res = await post({ action: "run", locale });
    setRunning(false);
    if (!res.ok) {
      setMsgFail(true);
      setMsg(res.error || "De vertaalronde is niet gelukt.");
      return;
    }
    // Deels gelukt is géén succes: de beheerder moet zien welk onderdeel klapte.
    const warnings = res.warnings || [];
    setMsgFail(warnings.length > 0);
    setMsg(
      warnings.length
        ? `Vertaalronde klaar, maar niet alles is gelukt — ${warnings.join(" ")}`
        : "Vertaalronde klaar — de lijst is bijgewerkt.",
    );
    await load();
  }

  const maxPage = Math.max(1, Math.ceil(data.total / (data.pageSize || 50)));
  const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
  const to = Math.min(data.page * data.pageSize, data.total);

  return (
    <div className="space-y-4">
      {/* Overzicht in cijfers */}
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Teksten", value: data.stats.totaal },
          { label: "Vertaald", value: data.stats.vertaald },
          { label: "Handmatig", value: data.stats.handmatig },
          { label: "Verouderd", value: data.stats.verouderd },
        ].map((k) => (
          <div key={k.label} className="rounded-xl border border-pnavy-100 bg-white p-4 shadow-portal">
            <p className="text-xs font-semibold uppercase tracking-wider text-pslate">{k.label}</p>
            <p className="mt-1.5 text-2xl font-semibold tabular-nums text-pnavy">{k.value.toLocaleString("nl-NL")}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-xl border border-pnavy-100 bg-white p-4 shadow-portal">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="block text-xs text-pslate">Taal</span>
            <select
              value={locale}
              onChange={(e) => changeFilter(() => setLocale(e.target.value))}
              className={`mt-0.5 rounded-lg ${fieldClass}`}
            >
              {locales.map((l) => (
                <option key={l} value={l}>
                  {localeLabels[l] || l}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="block text-xs text-pslate">Onderdeel</span>
            <select
              value={ns}
              onChange={(e) => changeFilter(() => setNs(e.target.value))}
              className={`mt-0.5 rounded-lg ${fieldClass}`}
            >
              <option value="">Alles</option>
              {namespaces.map((n) => (
                <option key={n.ns} value={n.ns}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block min-w-[16rem] flex-1">
            <span className="block text-xs text-pslate">Zoeken in sleutel, Nederlandse tekst of vertaling</span>
            <div className={`mt-0.5 flex items-center gap-2 rounded-lg ${fieldClass}`}>
              <Icon path={ICON_SEARCH} className="h-4 w-4 shrink-0 text-pslate" />
              <input
                value={q}
                onChange={(e) => changeFilter(() => setQ(e.target.value))}
                placeholder="bijv. winkelmand of cart.title"
                className="w-full bg-transparent text-sm text-pnavy focus:outline-none"
              />
            </div>
          </label>

          <label className="flex items-center gap-2 pb-2 text-sm text-pnavy">
            <input
              type="checkbox"
              checked={onlyOpen}
              onChange={(e) => changeFilter(() => setOnlyOpen(e.target.checked))}
              className="accent-pnavy"
            />
            Alleen ontbrekend of verouderd
          </label>

          <button type="button" onClick={runNow} disabled={running || !providerReady} className={`${btnSecondary} ml-auto disabled:opacity-50`}>
            {running ? "Bezig met vertalen…" : "Nu vertalen"}
          </button>
        </div>
        {!providerReady ? (
          <p className="mt-2 text-xs text-pslate">
            Zelf een vertaalronde starten kan niet: er staat geen AI-sleutel op de server. Handmatig aanpassen werkt wel.
          </p>
        ) : null}
        {running ? (
          <p className="mt-2 text-xs text-pslate">
            Zolang de ronde loopt staan de regels op slot: de ronde schrijft dezelfde lijst weg en zou een wijziging van
            jou meteen weer overschrijven. Zodra de ronde klaar is kun je weer bewerken.
          </p>
        ) : null}
      </div>

      {msg ? (
        <p className={`rounded-lg border px-3 py-2 text-sm ${msgFail ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
          {msg}
        </p>
      ) : null}

      {/* Lijst */}
      <div className="rounded-xl border border-pnavy-100 bg-white shadow-portal">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-pnavy-100 px-4 py-3">
          <p className="text-sm text-pslate">
            {data.total.toLocaleString("nl-NL")} tekst(en){data.total ? ` — ${from}–${to} getoond` : ""}
            {loading ? " · laden…" : ""}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={data.page <= 1 || loading} className={`${btnSecondary} disabled:opacity-40`}>
              Vorige
            </button>
            <span className="text-sm tabular-nums text-pslate">
              {data.page} / {maxPage}
            </span>
            <button type="button" onClick={() => setPage((p) => Math.min(maxPage, p + 1))} disabled={data.page >= maxPage || loading} className={`${btnSecondary} disabled:opacity-40`}>
              Volgende
            </button>
          </div>
        </div>

        {!data.rows.length ? (
          <p className="px-4 py-8 text-sm text-pslate">Geen teksten gevonden met deze filters.</p>
        ) : (
          <ul className="divide-y divide-pnavy-100">
            {data.rows.map((row) => {
              const id = rowId(row);
              const draft = drafts[id] ?? row.value;
              const dirty = draft !== row.value;
              const busy = busyRow === id;
              const stale = Boolean(row.value) && !row.fresh && !row.manual;
              return (
                <li key={id} className="px-4 py-3">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-pnavy-50 px-2 py-0.5 text-[0.65rem] font-medium uppercase tracking-wider text-pslate">{row.ns}</span>
                    <code className="min-w-0 break-all font-mono text-xs text-pslate">{row.key}</code>
                    {row.manual ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                        <Icon path={ICON_CHECK} className="h-3 w-3" />
                        Handmatig
                      </span>
                    ) : null}
                    {stale ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <Icon path={ICON_ALERT} className="h-3 w-3" />
                        Verouderd
                      </span>
                    ) : null}
                    {!row.value ? (
                      <span className="rounded-full bg-pnavy-50 px-2 py-0.5 text-xs font-medium text-pslate">Nog niet vertaald</span>
                    ) : null}
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg bg-pcream px-3 py-2">
                      <p className="text-[0.65rem] uppercase tracking-wider text-pslate">Nederlands</p>
                      <p className="mt-0.5 whitespace-pre-wrap text-sm text-pnavy">{row.source}</p>
                    </div>
                    <div>
                      <p className="text-[0.65rem] uppercase tracking-wider text-pslate">{localeLabels[locale] || locale}</p>
                      {/* Tijdens een vertaalronde op slot: die ronde schrijft het hele
                          document `translations:<locale>` weg en zou een handmatige
                          bewerking die er tussendoor landt stil overschrijven. */}
                      <textarea
                        value={draft}
                        onChange={(e) => setDrafts((p) => ({ ...p, [id]: e.target.value }))}
                        disabled={running}
                        rows={Math.min(6, Math.max(2, Math.ceil((row.source.length || 1) / 70)))}
                        placeholder="Nog geen vertaling"
                        className={`mt-0.5 w-full resize-y rounded-lg ${fieldClass} disabled:opacity-60`}
                      />
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <button type="button" onClick={() => save(row)} disabled={busy || running || !dirty} className={`${btnPrimary} disabled:opacity-40`}>
                          {busy ? "Bezig…" : "Opslaan"}
                        </button>
                        {dirty ? (
                          <button
                            type="button"
                            onClick={() =>
                              setDrafts((p) => {
                                const next = { ...p };
                                delete next[id];
                                return next;
                              })
                            }
                            className="text-sm text-pslate underline"
                          >
                            Wijziging annuleren
                          </button>
                        ) : null}
                        {row.value || row.manual ? (
                          <button type="button" onClick={() => reset(row)} disabled={busy || running} className="text-sm text-pslate underline disabled:opacity-40">
                            Terug op automatisch
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
