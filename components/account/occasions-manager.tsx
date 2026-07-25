"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Gelegenheden-beheer in de Site-studio: de tegels op /gelegenheden. Alles wordt
 * als één lijst opgeslagen (content:occasions), inclusief de volgorde.
 */

export type AdminLink = { label: string; href: string };
export type AdminOccasion = {
  slug: string;
  title: string;
  eyebrow: string;
  intro: string;
  image: string;
  ctaLabel: string;
  ctaHref: string;
  links: AdminLink[];
};

const CARD = "rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal";
const FIELD =
  "w-full rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN = "inline-flex items-center justify-center rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:opacity-50";
const BTN2 = "inline-flex items-center justify-center rounded-lg border border-pnavy-100 bg-white px-3 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:opacity-50";

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}
const P_PLUS = "M12 5v14M5 12h14";
const P_TRASH = "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14";
const P_UP = "M12 19V5M5 12l7-7 7 7";
const P_DOWN = "M12 5v14M19 12l-7 7-7-7";

/** Alleen links die op de site ook echt werken — dezelfde regel als de server. */
function hrefLooksSafe(href: string): boolean {
  return /^(\/|https:\/\/|mailto:|tel:|#)/i.test(href.trim());
}

function emptyOccasion(): AdminOccasion {
  return { slug: "", title: "", eyebrow: "", intro: "", image: "", ctaLabel: "Bekijk", ctaHref: "/", links: [] };
}

export function OccasionsManager({ initial }: { initial: AdminOccasion[] }) {
  const router = useRouter();
  const [items, setItems] = useState<AdminOccasion[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "fail"; text: string } | null>(null);

  const dirty = JSON.stringify(items) !== JSON.stringify(initial);

  function patch(i: number, p: Partial<AdminOccasion>) {
    setItems((list) => list.map((o, idx) => (idx === i ? { ...o, ...p } : o)));
  }
  function patchLink(i: number, li: number, p: Partial<AdminLink>) {
    setItems((list) =>
      list.map((o, idx) => (idx === i ? { ...o, links: o.links.map((l, lx) => (lx === li ? { ...l, ...p } : l)) } : o)),
    );
  }
  function addLink(i: number) {
    setItems((list) => list.map((o, idx) => (idx === i ? { ...o, links: [...o.links, { label: "", href: "/" }] } : o)));
  }
  function removeLink(i: number, li: number) {
    setItems((list) => list.map((o, idx) => (idx === i ? { ...o, links: o.links.filter((_, lx) => lx !== li) } : o)));
  }
  function move(i: number, dir: -1 | 1) {
    setItems((list) => {
      const j = i + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }
  function removeItem(i: number) {
    const o = items[i];
    if (!window.confirm(`"${o.title || o.slug}" verwijderen van /gelegenheden?`)) return;
    setItems((list) => list.filter((_, idx) => idx !== i));
  }
  function addItem() {
    setItems((list) => [...list, emptyOccasion()]);
    setMsg(null);
  }

  async function save() {
    const incomplete = items.find((o) => !o.title.trim() || !(o.slug.trim() || o.title.trim()));
    if (incomplete) {
      setMsg({ tone: "fail", text: "Elke gelegenheid heeft minimaal een titel nodig." });
      return;
    }
    if (!items.length) {
      setMsg({ tone: "fail", text: "Er moet minstens één gelegenheid overblijven." });
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/account/gelegenheden", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; items?: AdminOccasion[] };
      if (!r.ok || !d.ok) {
        setMsg({ tone: "fail", text: d.error || "Opslaan mislukt." });
        return;
      }
      // De server saneert (slug, veilige links); overnemen zodat het formulier
      // toont wat er écht is opgeslagen en niet onterecht "niet opgeslagen" meldt.
      if (Array.isArray(d.items)) setItems(d.items);
      setMsg({ tone: "ok", text: "Opgeslagen — direct zichtbaar op /gelegenheden." });
      router.refresh();
    } catch {
      setMsg({ tone: "fail", text: "Opslaan mislukt — geen verbinding." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-pslate">{items.length} gelegenheid(heden) · de volgorde hier is de volgorde op de site</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={addItem} className={BTN2}>
            <span className="mr-1.5"><Icon path={P_PLUS} /></span>
            Gelegenheid toevoegen
          </button>
          <button type="button" onClick={save} disabled={busy || !dirty} className={BTN}>
            {busy ? "Bezig…" : "Alles opslaan"}
          </button>
        </div>
      </div>

      {msg ? <p className={`text-sm ${msg.tone === "fail" ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p> : null}
      {dirty && !busy ? <p className="text-sm text-amber-700">Je hebt onopgeslagen wijzigingen.</p> : null}

      <ul className="space-y-4">
        {items.map((o, i) => (
          <li key={i} className={CARD}>
            <div className="flex flex-wrap items-start gap-4">
              <div className="h-24 w-20 shrink-0 overflow-hidden rounded-lg bg-pnavy-50">
                {o.image.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={o.image.trim()} alt="" className="h-full w-full object-cover" />
                ) : null}
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="text-xs text-pslate">Titel</span>
                    <input value={o.title} onChange={(e) => patch(i, { title: e.target.value })} className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">Bovenkop</span>
                    <input value={o.eyebrow} onChange={(e) => patch(i, { eyebrow: e.target.value })} placeholder="Voor de grote dag" className={`mt-0.5 ${FIELD}`} />
                  </label>
                </div>
                <label className="block">
                  <span className="text-xs text-pslate">Tekst</span>
                  <textarea value={o.intro} onChange={(e) => patch(i, { intro: e.target.value })} rows={3} className={`mt-0.5 ${FIELD}`} />
                </label>
                <label className="block">
                  <span className="text-xs text-pslate">Beeld (URL of pad in /public)</span>
                  <input value={o.image} onChange={(e) => patch(i, { image: e.target.value })} placeholder="/brand/brand-impression-wedding.jpg" className={`mt-0.5 ${FIELD}`} />
                </label>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block">
                    <span className="text-xs text-pslate">Slug (URL-deel)</span>
                    <input value={o.slug} onChange={(e) => patch(i, { slug: e.target.value })} placeholder="bruiloft" className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">Knoptekst</span>
                    <input value={o.ctaLabel} onChange={(e) => patch(i, { ctaLabel: e.target.value })} className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">Knoplink</span>
                    <input value={o.ctaHref} onChange={(e) => patch(i, { ctaHref: e.target.value })} placeholder="/collections/trouwen" className={`mt-0.5 ${FIELD}`} />
                    {o.ctaHref.trim() && !hrefLooksSafe(o.ctaHref) ? (
                      <span className="mt-1 block text-xs text-red-700">Begin met / of https:// — anders valt de link terug op #.</span>
                    ) : null}
                  </label>
                </div>

                <div>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wider text-pslate">Extra links</span>
                    <button type="button" onClick={() => addLink(i)} className={BTN2}>
                      <span className="mr-1.5"><Icon path={P_PLUS} /></span>
                      Link toevoegen
                    </button>
                  </div>
                  <div className="space-y-2">
                    {o.links.map((l, li) => (
                      <div key={li} className="grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
                        <input value={l.label} onChange={(e) => patchLink(i, li, { label: e.target.value })} placeholder="Trouwaccessoires" className={FIELD} />
                        <input value={l.href} onChange={(e) => patchLink(i, li, { href: e.target.value })} placeholder="/collections/trouw-accessoires" className={FIELD} />
                        <button type="button" onClick={() => removeLink(i, li)} className={`${BTN2} !text-red-700`} aria-label="Link verwijderen">
                          <Icon path={P_TRASH} />
                        </button>
                      </div>
                    ))}
                    {!o.links.length ? <p className="text-sm text-pslate">Geen extra links.</p> : null}
                  </div>
                </div>
              </div>

              <div className="flex shrink-0 flex-col gap-2">
                <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={BTN2} aria-label="Naar boven">
                  <Icon path={P_UP} />
                </button>
                <button type="button" onClick={() => move(i, 1)} disabled={i === items.length - 1} className={BTN2} aria-label="Naar beneden">
                  <Icon path={P_DOWN} />
                </button>
                <button type="button" onClick={() => removeItem(i)} className={`${BTN2} !text-red-700`} aria-label="Gelegenheid verwijderen">
                  <Icon path={P_TRASH} />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {!items.length ? <p className="text-sm text-pslate">Geen gelegenheden. Voeg er minimaal één toe.</p> : null}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={busy || !dirty} className={BTN}>
          {busy ? "Bezig…" : "Alles opslaan"}
        </button>
      </div>
    </div>
  );
}
