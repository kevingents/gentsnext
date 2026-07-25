"use client";

import { useEffect, useState } from "react";
import type { MenuColumn, MenuItem, MenuLink } from "@/lib/main-menu";
import { IconChevron, IconDown, IconPlus, IconTrash, IconUp } from "@/components/account/studio-icons";

const FIELD =
  "w-full rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:opacity-50";
const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-pnavy-100 bg-white px-3 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:opacity-50";
const BTN_ICON =
  "rounded-lg border border-pnavy-100 p-1.5 text-pslate transition-colors hover:bg-pnavy-50 hover:text-pnavy disabled:opacity-30";

/** Verplaatst één element in een lijst; buiten bereik = lijst ongewijzigd. */
function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

/** Alleen schemes die de server ook accepteert — anders wordt het stil "#". */
const hrefOk = (h: string) => /^(\/|https:\/\/|mailto:|tel:|#)/i.test(h.trim());

export function MenuEditor({ initial }: { initial: MenuItem[] }) {
  const [items, setItems] = useState<MenuItem[]>(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");
  /**
   * Versiestempel van het menu zoals het geladen is. Het portal-venster schrijft
   * hetzelfde document; zonder deze stempel zou opslaan de wijziging van een
   * collega (of van een tweede tabblad) stilzwijgend wissen.
   */
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/menu")
      .then((r) => r.json())
      .then((d: { version?: string }) => {
        if (!cancelled && typeof d?.version === "string") setVersion(d.version);
      })
      .catch(() => {
        // Geen versie = geen botsingscontrole; opslaan blijft gewoon werken.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(next: MenuItem[]) {
    setItems(next);
    setState("idle");
  }
  function patchItem(i: number, p: Partial<MenuItem>) {
    update(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
  }
  function columnsOf(i: number): MenuColumn[] {
    return items[i].columns || [];
  }
  function setColumns(i: number, cols: MenuColumn[]) {
    patchItem(i, { columns: cols });
  }
  function setLinks(i: number, c: number, links: MenuLink[]) {
    setColumns(i, columnsOf(i).map((col, idx) => (idx === c ? { ...col, links } : col)));
  }

  function addItem() {
    update([...items, { label: "Nieuw menu-item", href: "#" }]);
    setOpen(items.length);
  }
  function removeItem(i: number) {
    if (!confirm(`Menu-item "${items[i].label}" verwijderen? Inclusief de kolommen eronder.`)) return;
    update(items.filter((_, idx) => idx !== i));
    setOpen(null);
  }
  function moveItem(i: number, dir: -1 | 1) {
    update(move(items, i, i + dir));
    setOpen(i + dir);
  }

  /** Client-check: leeg label of een link die de server zou platslaan naar "#". */
  function problems(): string[] {
    const out: string[] = [];
    if (!items.length) out.push("Het menu mag niet leeg zijn.");
    items.forEach((it, i) => {
      const nr = it.label.trim() || `Menu-item ${i + 1}`;
      if (!it.label.trim()) out.push(`Menu-item ${i + 1}: naam is verplicht.`);
      if (!hrefOk(it.href)) out.push(`${nr}: link moet met /, https://, mailto:, tel: of # beginnen.`);
      (it.columns || []).forEach((col, c) => {
        col.links.forEach((l, j) => {
          if (!l.label.trim()) out.push(`${nr} · kolom ${c + 1} · link ${j + 1}: naam is verplicht.`);
          if (!hrefOk(l.href)) out.push(`${nr} · kolom ${c + 1} · "${l.label || `link ${j + 1}`}": ongeldige link.`);
        });
      });
    });
    return out;
  }

  async function save() {
    const errs = problems();
    if (errs.length) {
      setState("fail");
      setMsg(errs.slice(0, 6).join(" "));
      return;
    }
    setState("busy");
    setMsg("");
    try {
      const r = await fetch("/api/account/menu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, ...(version ? { version } : {}) }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; items?: MenuItem[]; version?: string };
      if (r.ok && d.ok) {
        setItems(d.items || items);
        if (typeof d.version === "string") setVersion(d.version);
        setState("done");
        setMsg("Opgeslagen — binnen een halve minuut zichtbaar in het menu.");
      } else {
        setState("fail");
        setMsg(d.error || "Opslaan mislukte.");
      }
    } catch {
      setState("fail");
      setMsg("Opslaan mislukte.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={addItem} className={BTN_SECONDARY}>
          <IconPlus />
          Menu-item toevoegen
        </button>
        <button type="button" onClick={save} disabled={state === "busy"} className={BTN_PRIMARY}>
          {state === "busy" ? "Opslaan…" : "Menu opslaan"}
        </button>
        {msg ? <span className={`text-sm ${state === "fail" ? "text-red-700" : "text-emerald-700"}`}>{msg}</span> : null}
      </div>

      <ul className="space-y-3">
        {items.map((it, i) => {
          const isOpen = open === i;
          const cols = it.columns || [];
          const linkCount = cols.reduce((n, c) => n + c.links.length, 0);
          return (
            <li key={i} className="rounded-xl border border-pnavy-100 bg-white shadow-portal">
              <div className="flex items-center gap-2 p-4">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : i)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={isOpen}
                >
                  <span className={`shrink-0 text-pslate transition-transform ${isOpen ? "rotate-180" : ""}`}>
                    <IconChevron />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-pnavy">{it.label || "Zonder naam"}</span>
                    <span className="block truncate text-xs text-pslate">
                      {it.href === "#" ? "alleen kop (opent het uitklapmenu)" : it.href}
                      {cols.length ? ` · ${cols.length} kolom(men), ${linkCount} link(s)` : " · geen uitklapmenu"}
                      {it.features?.length ? ` · ${it.features.length} sfeer-tegel(s)` : ""}
                    </span>
                  </span>
                </button>
                <button type="button" onClick={() => moveItem(i, -1)} disabled={i === 0} title="Naar links/omhoog" className={BTN_ICON}>
                  <IconUp />
                </button>
                <button type="button" onClick={() => moveItem(i, 1)} disabled={i === items.length - 1} title="Naar rechts/omlaag" className={BTN_ICON}>
                  <IconDown />
                </button>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  title="Menu-item verwijderen"
                  className="rounded-lg border border-pnavy-100 p-1.5 text-pslate transition-colors hover:bg-red-50 hover:text-red-700"
                >
                  <IconTrash />
                </button>
              </div>

              {isOpen ? (
                <div className="space-y-5 border-t border-pnavy-100 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm text-pnavy">Naam in de balk</span>
                      <input className={`mt-1 ${FIELD}`} value={it.label} maxLength={60} onChange={(e) => patchItem(i, { label: e.target.value })} />
                    </label>
                    <label className="block">
                      <span className="text-sm text-pnavy">Link</span>
                      <input
                        className={`mt-1 ${FIELD}`}
                        value={it.href}
                        maxLength={200}
                        onChange={(e) => patchItem(i, { href: e.target.value })}
                        placeholder="/collections/pakken"
                      />
                      <span className="mt-1 block text-xs text-pslate">
                        Gebruik <code>#</code> als het item alleen een kop boven het uitklapmenu is.
                      </span>
                    </label>
                  </div>

                  {/* Kolommen */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-pslate">Uitklapmenu</p>
                      <button
                        type="button"
                        onClick={() => setColumns(i, [...cols, { title: "", links: [{ label: "", href: "/" }] }])}
                        className={BTN_SECONDARY}
                      >
                        <IconPlus />
                        Kolom toevoegen
                      </button>
                    </div>

                    {!cols.length ? (
                      <p className="text-sm text-pslate">Geen kolommen — dit item is één directe link.</p>
                    ) : null}

                    {cols.map((col, c) => (
                      <div key={c} className="rounded-lg border border-pnavy-100 bg-pcream/40 p-3">
                        <div className="flex items-end gap-2">
                          <label className="block min-w-0 flex-1">
                            <span className="text-xs text-pslate">Kop van de kolom</span>
                            <input
                              className={`mt-1 ${FIELD}`}
                              value={col.title || ""}
                              maxLength={60}
                              onChange={(e) => setColumns(i, cols.map((x, idx) => (idx === c ? { ...x, title: e.target.value } : x)))}
                              placeholder="Bijvoorbeeld: Pakken & colberts"
                            />
                          </label>
                          <button type="button" onClick={() => setColumns(i, move(cols, c, c - 1))} disabled={c === 0} title="Kolom omhoog" className={BTN_ICON}>
                            <IconUp />
                          </button>
                          <button type="button" onClick={() => setColumns(i, move(cols, c, c + 1))} disabled={c === cols.length - 1} title="Kolom omlaag" className={BTN_ICON}>
                            <IconDown />
                          </button>
                          <button
                            type="button"
                            onClick={() => setColumns(i, cols.filter((_, idx) => idx !== c))}
                            title="Kolom verwijderen"
                            className="rounded-lg border border-pnavy-100 p-1.5 text-pslate transition-colors hover:bg-red-50 hover:text-red-700"
                          >
                            <IconTrash />
                          </button>
                        </div>

                        <ul className="mt-3 space-y-2">
                          {col.links.map((l, j) => (
                            <li key={j} className="flex items-center gap-2">
                              <input
                                className={FIELD}
                                value={l.label}
                                maxLength={60}
                                onChange={(e) => setLinks(i, c, col.links.map((x, idx) => (idx === j ? { ...x, label: e.target.value } : x)))}
                                placeholder="Naam"
                              />
                              <input
                                className={FIELD}
                                value={l.href}
                                maxLength={200}
                                onChange={(e) => setLinks(i, c, col.links.map((x, idx) => (idx === j ? { ...x, href: e.target.value } : x)))}
                                placeholder="/collections/pakken"
                              />
                              <button type="button" onClick={() => setLinks(i, c, move(col.links, j, j - 1))} disabled={j === 0} title="Link omhoog" className={BTN_ICON}>
                                <IconUp />
                              </button>
                              <button type="button" onClick={() => setLinks(i, c, move(col.links, j, j + 1))} disabled={j === col.links.length - 1} title="Link omlaag" className={BTN_ICON}>
                                <IconDown />
                              </button>
                              <button
                                type="button"
                                onClick={() => setLinks(i, c, col.links.filter((_, idx) => idx !== j))}
                                title="Link verwijderen"
                                className="rounded-lg border border-pnavy-100 p-1.5 text-pslate transition-colors hover:bg-red-50 hover:text-red-700"
                              >
                                <IconTrash />
                              </button>
                            </li>
                          ))}
                        </ul>

                        <button
                          type="button"
                          onClick={() => setLinks(i, c, [...col.links, { label: "", href: "/" }])}
                          className={`mt-2 ${BTN_SECONDARY}`}
                        >
                          <IconPlus />
                          Link toevoegen
                        </button>
                        {!col.links.length ? (
                          <p className="mt-2 text-xs text-pslate">Een kolom zonder links wordt bij het opslaan weggelaten.</p>
                        ) : null}
                      </div>
                    ))}
                  </div>

                  {it.features?.length ? (
                    <p className="text-xs text-pslate">
                      Dit item heeft {it.features.length} sfeer-tegel(s) met beeld ({it.features.map((f) => f.label).join(", ")}).
                      Die blijven ongewijzigd staan.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
