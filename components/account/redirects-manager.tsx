"use client";

import { useMemo, useState } from "react";
import { redirectSourceKey, redirectWarnings, type RedirectWarning } from "@/lib/redirect-warnings";

/**
 * Beheer van de URL-redirects in de Site-studio. Praat met
 * /api/account/redirects; die route doet de admin-check en schrijft via
 * lib/redirects-admin naar dezelfde bron die de middleware leest.
 */

export type RedirectRow = { source: string; target: string; status: 301 | 302; active: boolean };

type Draft = { source: string; target: string; status: 301 | 302; active: boolean; originalSource: string | null };

const FIELD =
  "w-full rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 font-sans text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-pnavy px-3.5 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:opacity-50";
const BTN_SEC =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-pnavy-100 bg-white px-3.5 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:opacity-50";

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
const P_WARN = "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z";
const P_EXT = "M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3";

const emptyDraft = (): Draft => ({ source: "", target: "", status: 301, active: true, originalSource: null });

export function RedirectsManager({ initial }: { initial: RedirectRow[] }) {
  const [list, setList] = useState<RedirectRow[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "fout"; text: string } | null>(null);

  const sorted = useMemo(() => [...list].sort((a, b) => a.source.localeCompare(b.source, "nl")), [list]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sorted;
    return sorted.filter((r) => r.source.toLowerCase().includes(needle) || r.target.toLowerCase().includes(needle));
  }, [sorted, q]);
  const activeCount = list.filter((r) => r.active).length;

  /** Waarschuwingen per regel, in één keer berekend (de keten-check kijkt naar de hele lijst). */
  const warnings = useMemo(() => {
    const map = new Map<string, RedirectWarning[]>();
    for (const r of list) map.set(r.source, redirectWarnings(r, list));
    return map;
  }, [list]);
  const draftWarnings = useMemo(
    () => (draft && draft.source.trim() ? redirectWarnings(draft, list) : []),
    [draft, list],
  );
  const blocking = list.filter((r) => (warnings.get(r.source) || []).some((w) => w.level === "blok")).length;

  /**
   * Een nieuwe regel op een bron die al bezet is zou de bestaande stil
   * overschrijven — en in een gesorteerde, gefilterde tabel zie je die niet staan.
   * De server weigert het ook (mode "create"); hier zie je het al tijdens het typen.
   */
  const duplicate = useMemo(() => {
    if (!draft || draft.originalSource) return null;
    const key = redirectSourceKey(draft.source);
    if (!draft.source.trim() || key === "/") return null;
    return list.find((r) => redirectSourceKey(r.source) === key) ?? null;
  }, [draft, list]);
  /** Beide velden moeten gevuld zijn: een leeg doel werd anders een 301 naar de homepage. */
  const incomplete = !draft || !draft.source.trim() || !draft.target.trim();

  async function send(payload: Record<string, unknown>, okText: string) {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/account/redirects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; redirects?: RedirectRow[] };
      if (res.ok && data.ok && Array.isArray(data.redirects)) {
        setList(data.redirects);
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
    if (!draft || incomplete || duplicate) return;
    const ok = await send(
      {
        source: draft.source,
        target: draft.target,
        status: draft.status,
        active: draft.active,
        originalSource: draft.originalSource ?? undefined,
      },
      draft.originalSource ? "Redirect bijgewerkt — binnen 30 seconden actief." : "Redirect toegevoegd — binnen 30 seconden actief.",
    );
    if (ok) setDraft(null);
  }

  async function remove(row: RedirectRow) {
    if (!window.confirm(`Redirect ${row.source} verwijderen?`)) return;
    await send({ action: "delete", source: row.source }, "Redirect verwijderd.");
  }

  async function toggle(row: RedirectRow) {
    await send(
      { action: "toggle", source: row.source, active: !row.active },
      row.active ? "Redirect uitgezet." : "Redirect aangezet.",
    );
  }

  return (
    <div className="space-y-4">
      {/* Balk: zoeken + toevoegen */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-pnavy-100 bg-white p-4 shadow-portal">
        <label className="min-w-[12rem] flex-1">
          <span className="sr-only">Zoeken in redirects</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Zoek op bron of doel…"
            className={FIELD}
          />
        </label>
        <p className="font-sans text-sm text-pslate">
          {list.length} regel{list.length === 1 ? "" : "s"} · {activeCount} actief
          {blocking ? <span className="text-amber-700"> · {blocking} met een blokkade</span> : null}
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
          Nieuwe redirect
        </button>
      </div>

      {msg ? (
        <p className={`font-sans text-sm ${msg.tone === "fout" ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p>
      ) : null}

      {/* Formulier: nieuw of bewerken */}
      {draft ? (
        <form onSubmit={saveDraft} className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-pslate">
            {draft.originalSource ? `Redirect bewerken · ${draft.originalSource}` : "Nieuwe redirect"}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="font-sans text-sm text-pnavy">Van (oud pad)</span>
              <input
                value={draft.source}
                onChange={(e) => setDraft({ ...draft, source: e.target.value })}
                placeholder="/oude-pagina of /oude-map/*"
                className={`mt-1 ${FIELD}`}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="font-sans text-sm text-pnavy">Naar (nieuw pad of volledige URL)</span>
              <input
                value={draft.target}
                onChange={(e) => setDraft({ ...draft, target: e.target.value })}
                placeholder="/nieuwe-pagina of https://…"
                className={`mt-1 ${FIELD}`}
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-5">
            <label className="block">
              <span className="font-sans text-sm text-pnavy">Soort</span>
              <select
                value={draft.status}
                onChange={(e) => setDraft({ ...draft, status: Number(e.target.value) === 302 ? 302 : 301 })}
                className={`mt-1 ${FIELD}`}
              >
                <option value={301}>301 — definitief (Google neemt het over)</option>
                <option value={302}>302 — tijdelijk</option>
              </select>
            </label>
            <label className="mt-5 flex items-center gap-2">
              <input
                type="checkbox"
                checked={draft.active}
                onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                className="h-4 w-4 accent-pnavy"
              />
              <span className="font-sans text-sm text-pnavy">Actief</span>
            </label>
          </div>

          {draftWarnings.length || duplicate ? (
            <ul className="mt-4 space-y-1.5">
              {duplicate ? (
                <WarningLine
                  warning={{
                    level: "blok",
                    text: `Er bestaat al een regel voor ${duplicate.source} (naar ${duplicate.target}). Sluit dit formulier en bewerk die regel, anders overschrijf je hem.`,
                  }}
                />
              ) : null}
              {draftWarnings.map((w, i) => (
                <WarningLine key={i} warning={w} />
              ))}
            </ul>
          ) : null}

          <p className="mt-4 font-sans text-xs text-pslate">
            Een <strong>/*</strong> achter de bron stuurt alles onder dat pad door. Zet ook <strong>/*</strong> achter het doel om het restpad mee te nemen
            (/oud/schoenen → /nieuw/schoenen).
          </p>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button type="submit" disabled={busy || incomplete || !!duplicate} className={BTN}>
              {busy ? "Opslaan…" : "Opslaan"}
            </button>
            <button type="button" onClick={() => setDraft(null)} disabled={busy} className={BTN_SEC}>
              Annuleren
            </button>
            {incomplete && !duplicate ? (
              <span className="font-sans text-xs text-pslate">Vul zowel het oude pad als het doel in.</span>
            ) : null}
          </div>
        </form>
      ) : null}

      {/* Tabel */}
      <div className="overflow-x-auto rounded-xl border border-pnavy-100 bg-white shadow-portal">
        <table className="w-full min-w-[46rem] border-collapse text-left">
          <thead>
            <tr className="border-b border-pnavy-100 text-xs uppercase tracking-wider text-pslate">
              <th className="px-4 py-3 font-semibold">Van</th>
              <th className="px-4 py-3 font-semibold">Naar</th>
              <th className="px-4 py-3 font-semibold">Soort</th>
              <th className="px-4 py-3 font-semibold">Actief</th>
              <th className="px-4 py-3 font-semibold text-right">Acties</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const ws = warnings.get(r.source) || [];
              const external = /^https?:\/\//i.test(r.target);
              return (
                <tr key={r.source} className="border-b border-pnavy-50 align-top last:border-0">
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-pnavy">{r.source}</span>
                    {ws.length ? (
                      <ul className="mt-1.5 space-y-1">
                        {ws.map((w, i) => (
                          <WarningLine key={i} warning={w} />
                        ))}
                      </ul>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-mono text-sm text-pnavy">{r.target}</span>
                    {external ? (
                      <span className="ml-1.5 inline-flex items-center text-pslate" title="Externe URL">
                        <Icon path={P_EXT} className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${r.status === 302 ? "bg-sky-50 text-sky-700" : "bg-pnavy-50 text-pslate"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={r.active}
                      aria-label={`${r.source} ${r.active ? "uitzetten" : "aanzetten"}`}
                      onClick={() => toggle(r)}
                      disabled={busy}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${r.active ? "bg-pnavy" : "bg-pnavy-100"}`}
                    >
                      <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${r.active ? "translate-x-4" : "translate-x-0.5"}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setDraft({ source: r.source, target: r.target, status: r.status, active: r.active, originalSource: r.source });
                          setMsg(null);
                        }}
                        className="rounded-lg p-1.5 text-pslate transition-colors hover:bg-pnavy-50 hover:text-pnavy"
                        title="Bewerken"
                        aria-label={`${r.source} bewerken`}
                      >
                        <Icon path={P_PEN} />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r)}
                        disabled={busy}
                        className="rounded-lg p-1.5 text-pslate transition-colors hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                        title="Verwijderen"
                        aria-label={`${r.source} verwijderen`}
                      >
                        <Icon path={P_TRASH} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {!filtered.length ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center font-sans text-sm text-pslate">
                  {list.length ? "Geen regel gevonden met deze zoekterm." : "Nog geen redirects. Voeg er een toe zodra een pagina van adres verandert."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WarningLine({ warning }: { warning: RedirectWarning }) {
  const blok = warning.level === "blok";
  return (
    <li className={`flex items-start gap-1.5 font-sans text-xs ${blok ? "text-red-700" : "text-amber-700"}`}>
      <span className="mt-0.5 shrink-0">
        <Icon path={P_WARN} className="h-3.5 w-3.5" />
      </span>
      <span>{warning.text}</span>
    </li>
  );
}
