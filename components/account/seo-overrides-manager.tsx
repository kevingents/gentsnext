"use client";

import { useMemo, useState } from "react";

/**
 * Beheer van de SEO-overrides in de Site-studio: per pad een eigen meta-titel,
 * meta-omschrijving en noindex. Praat met /api/account/seo; die route doet de
 * admin-check en schrijft via lib/seo-overrides (dezelfde bron die de winkel in
 * generateMetadata leest).
 */

export type SeoRow = { path: string; title?: string; description?: string; noindex?: boolean };

type Draft = { path: string; title: string; description: string; noindex: boolean; originalPath: string | null };

const FIELD =
  "w-full rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 font-sans text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-pnavy px-3.5 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:opacity-50";
const BTN_SEC =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-pnavy-100 bg-white px-3.5 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:opacity-50";

/** Google toont ongeveer zoveel tekens; daarboven kapt hij af. */
const TITLE_ADVICE = 60;
const DESC_ADVICE = 155;
const TITLE_MAX = 200;
const DESC_MAX = 320;

function Icon({ path, className = "h-4 w-4" }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}
const P_PLUS = "M12 5v14M5 12h14";
const P_PEN = "M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z";
const P_TRASH = "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6";
const P_EXT = "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3";

const emptyDraft = (): Draft => ({ path: "", title: "", description: "", noindex: false, originalPath: null });

function Counter({ value, advice, max }: { value: number; advice: number; max: number }) {
  const tone = value > max ? "text-red-700" : value > advice ? "text-amber-700" : "text-pslate";
  return (
    <span className={`font-sans text-xs tabular-nums ${tone}`}>
      {value}/{advice} tekens{value > advice && value <= max ? " — Google kapt dit waarschijnlijk af" : ""}
      {value > max ? ` — wordt ingekort tot ${max}` : ""}
    </span>
  );
}

export function SeoOverridesManager({ initial }: { initial: SeoRow[] }) {
  const [list, setList] = useState<SeoRow[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "fout"; text: string } | null>(null);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...list].sort((a, b) => a.path.localeCompare(b.path, "nl"));
    if (!needle) return sorted;
    return sorted.filter(
      (r) =>
        r.path.toLowerCase().includes(needle) ||
        (r.title || "").toLowerCase().includes(needle) ||
        (r.description || "").toLowerCase().includes(needle),
    );
  }, [list, q]);
  const noindexCount = list.filter((r) => r.noindex).length;

  async function send(payload: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/seo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; overrides?: SeoRow[] };
      if (res.ok && data.ok && Array.isArray(data.overrides)) {
        setList(data.overrides);
        setMsg({ tone: "ok", text: okText });
        return true;
      }
      setMsg({ tone: "fout", text: data.error || "Opslaan mislukte." });
      return false;
    } catch {
      setMsg({ tone: "fout", text: "Opslaan mislukte — geen verbinding." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const ok = await send(
      {
        path: draft.path,
        title: draft.title,
        description: draft.description,
        noindex: draft.noindex,
        originalPath: draft.originalPath ?? undefined,
      },
      draft.originalPath ? "Bijgewerkt — binnen 30 seconden zichtbaar op de pagina." : "Toegevoegd — binnen 30 seconden zichtbaar op de pagina.",
    );
    if (ok) setDraft(null);
  }

  async function remove(row: SeoRow) {
    if (!window.confirm(`SEO-override voor ${row.path} verwijderen? De pagina gebruikt daarna weer de automatische teksten.`)) return;
    await send({ action: "delete", path: row.path }, "Verwijderd — de pagina gebruikt weer de automatische teksten.");
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-pnavy-100 bg-white p-4 shadow-portal">
        <label className="min-w-[12rem] flex-1">
          <span className="sr-only">Zoeken in SEO-overrides</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op pad, titel of omschrijving…" className={FIELD} />
        </label>
        <p className="font-sans text-sm text-pslate">
          {list.length} pagina{list.length === 1 ? "" : "'s"}
          {noindexCount ? ` · ${noindexCount} op noindex` : ""}
        </p>
        <button
          type="button"
          onClick={() => {
            setDraft(emptyDraft());
            setMsg(null);
          }}
          className={BTN}
        >
          <Icon path={P_PLUS} />
          Pagina toevoegen
        </button>
      </div>

      {msg ? <p className={`font-sans text-sm ${msg.tone === "fout" ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p> : null}

      {draft ? (
        <form onSubmit={saveDraft} className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-pslate">
            {draft.originalPath ? `Bewerken · ${draft.originalPath}` : "Nieuwe SEO-override"}
          </p>

          <label className="block">
            <span className="font-sans text-sm text-pnavy">Pad</span>
            <input
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              placeholder="/products/<handle> of /categorie/<slug>"
              className={`mt-1 ${FIELD}`}
              autoFocus
            />
            <span className="mt-1 block font-sans text-xs text-pslate">
              Zonder taal-prefix: /en/… en /de/… pakken dezelfde regel. De homepage kan hier niet.
            </span>
          </label>

          <label className="mt-3 block">
            <span className="font-sans text-sm text-pnavy">Meta-titel</span>
            <input
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="Bijvoorbeeld: Blauw pak heren — GENTS"
              className={`mt-1 ${FIELD}`}
            />
            <span className="mt-1 block">
              <Counter value={draft.title.trim().length} advice={TITLE_ADVICE} max={TITLE_MAX} />
            </span>
          </label>

          <label className="mt-3 block">
            <span className="font-sans text-sm text-pnavy">Meta-omschrijving</span>
            <textarea
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              rows={3}
              placeholder="De zin die onder de titel in Google staat."
              className={`mt-1 resize-y ${FIELD}`}
            />
            <span className="mt-1 block">
              <Counter value={draft.description.trim().length} advice={DESC_ADVICE} max={DESC_MAX} />
            </span>
          </label>

          <label className="mt-3 flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.noindex}
              onChange={(e) => setDraft({ ...draft, noindex: e.target.checked })}
              className="h-4 w-4 accent-pnavy"
            />
            <span className="font-sans text-sm text-pnavy">Noindex — deze pagina uit Google houden (links worden nog wel gevolgd)</span>
          </label>

          <p className="mt-3 font-sans text-xs text-pslate">
            Leeg laten = de winkel bepaalt de tekst zelf. Alle drie leeg? Dan valt er niets te overschrijven en slaan we niets op.
          </p>

          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={busy} className={BTN}>
              {busy ? "Opslaan…" : "Opslaan"}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} className={BTN_SEC}>
              Annuleren
            </button>
          </div>
        </form>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-pnavy-100 bg-white shadow-portal">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-pnavy-100 text-xs uppercase tracking-wider text-pslate">
              <th className="px-4 py-3 font-semibold">Pad</th>
              <th className="px-4 py-3 font-semibold">Meta-titel</th>
              <th className="px-4 py-3 font-semibold">Meta-omschrijving</th>
              <th className="px-4 py-3 font-semibold">Noindex</th>
              <th className="px-4 py-3 text-right font-semibold">Acties</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.path} className="border-b border-pnavy-50 align-top last:border-0">
                <td className="px-4 py-3">
                  <a
                    href={r.path}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-mono text-sm text-pnavy hover:underline"
                  >
                    {r.path}
                    <Icon path={P_EXT} className="h-3.5 w-3.5 text-pslate" />
                  </a>
                </td>
                <td className="max-w-[18rem] px-4 py-3">
                  <span className="font-sans text-sm text-pnavy">{r.title || <span className="text-pslate">— automatisch</span>}</span>
                </td>
                <td className="max-w-[24rem] px-4 py-3">
                  <span className="font-sans text-sm text-pslate">{r.description || "— automatisch"}</span>
                </td>
                <td className="px-4 py-3">
                  {r.noindex ? (
                    <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">uit Google</span>
                  ) : (
                    <span className="font-sans text-sm text-pslate">nee</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="flex justify-end gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft({
                          path: r.path,
                          title: r.title || "",
                          description: r.description || "",
                          noindex: Boolean(r.noindex),
                          originalPath: r.path,
                        });
                        setMsg(null);
                      }}
                      className="rounded-lg p-1.5 text-pslate transition-colors hover:bg-pnavy-50 hover:text-pnavy"
                      title="Bewerken"
                      aria-label={`${r.path} bewerken`}
                    >
                      <Icon path={P_PEN} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r)}
                      disabled={busy}
                      className="rounded-lg p-1.5 text-pslate transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                      title="Verwijderen"
                      aria-label={`${r.path} verwijderen`}
                    >
                      <Icon path={P_TRASH} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center font-sans text-sm text-pslate">
                  {list.length
                    ? "Geen pagina gevonden met deze zoekterm."
                    : "Nog geen overrides. Voeg een pad toe zodra je de tekst in Google zelf wilt bepalen."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
