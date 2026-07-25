"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Looks-beheer in de Site-studio. Bewerkt titel/verhaal/status en de gekoppelde
 * producten (hotspots: handle + positie in procenten op de foto). De gezondheid
 * van elk gekoppeld product komt van de server (actief + netto voorraad).
 */

export type Hotspot = { handle: string; label: string; x: number; y: number };
export type AdminLook = {
  slug: string;
  title: string;
  subtitle: string;
  occasion: string;
  theme: string;
  image: string;
  images: string[];
  story: string;
  status: "published" | "draft";
  updatedAt: string;
  hotspots: Hotspot[];
};
export type ProductHealth = { state: "ok" | "sold-out" | "no-sizes" | "missing"; title: string };

const CARD = "rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal";
const FIELD =
  "w-full rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN = "inline-flex items-center justify-center rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:opacity-50";
const BTN2 = "inline-flex items-center justify-center rounded-lg border border-pnavy-100 bg-white px-3 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:opacity-50";

const HEALTH_LABEL: Record<ProductHealth["state"], { text: string; tone: string }> = {
  ok: { text: "Op voorraad", tone: "bg-emerald-50 text-emerald-700" },
  "sold-out": { text: "Uitverkocht", tone: "bg-red-50 text-red-700" },
  "no-sizes": { text: "Geen maten bekend", tone: "bg-amber-50 text-amber-700" },
  missing: { text: "Niet actief", tone: "bg-red-50 text-red-700" },
};

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}
const P_WARN = "M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z";
const P_PLUS = "M12 5v14M5 12h14";
const P_TRASH = "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14";
const P_EYE = "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7zM12 15a3 3 0 100-6 3 3 0 000 6z";

function emptyLook(): AdminLook {
  return {
    slug: "",
    title: "",
    subtitle: "",
    occasion: "",
    theme: "",
    image: "",
    images: [],
    story: "",
    status: "draft",
    updatedAt: "",
    hotspots: [],
  };
}

export function LooksManager({ looks, health }: { looks: AdminLook[]; health: Record<string, ProductHealth> }) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminLook | null>(null);
  const [imagesText, setImagesText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "fail"; text: string } | null>(null);
  const [isNew, setIsNew] = useState(false);

  /** Fouten per look: producten die niet meer actief of uitverkocht zijn. */
  const problems = useMemo(() => {
    const out: Record<string, { broken: number; warn: number }> = {};
    for (const l of looks) {
      let broken = 0;
      let warn = 0;
      for (const h of l.hotspots) {
        const st = health[h.handle]?.state;
        if (st === "missing" || st === "sold-out") broken++;
        else if (st === "no-sizes") warn++;
      }
      out[l.slug] = { broken, warn };
    }
    return out;
  }, [looks, health]);

  const brokenLooks = looks.filter((l) => (problems[l.slug]?.broken || 0) > 0);
  const published = looks.filter((l) => l.status === "published").length;

  function startEdit(look: AdminLook) {
    setIsNew(false);
    setEditing(look.slug);
    setDraft({ ...look, hotspots: look.hotspots.map((h) => ({ ...h })) });
    setImagesText(look.images.join("\n"));
    setMsg(null);
  }

  function startNew() {
    setIsNew(true);
    setEditing("__nieuw__");
    setDraft(emptyLook());
    setImagesText("");
    setMsg(null);
  }

  function cancel() {
    setEditing(null);
    setDraft(null);
    setIsNew(false);
  }

  function patch(p: Partial<AdminLook>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }

  function patchHotspot(i: number, p: Partial<Hotspot>) {
    setDraft((d) => (d ? { ...d, hotspots: d.hotspots.map((h, idx) => (idx === i ? { ...h, ...p } : h)) } : d));
  }

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/account/looks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) {
        setMsg({ tone: "fail", text: d.error || "Opslaan mislukt." });
        return false;
      }
      return true;
    } catch {
      setMsg({ tone: "fail", text: "Opslaan mislukt — geen verbinding." });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const images = imagesText.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const look = {
      ...draft,
      images,
      image: images[0] || draft.image,
      hotspots: draft.hotspots.filter((h) => h.handle.trim()),
    };
    if (!look.slug.trim()) {
      setMsg({ tone: "fail", text: "Een look heeft een slug nodig (het laatste deel van de URL)." });
      return;
    }
    if (await post({ action: "save", look })) {
      setMsg({ tone: "ok", text: look.status === "published" ? "Opgeslagen en live op /looks." : "Opgeslagen als concept — nog niet op de site." });
      setEditing(null);
      setDraft(null);
      setIsNew(false);
      router.refresh();
    }
  }

  async function remove(slug: string) {
    if (!window.confirm(`"${slug}" verwijderen? Een standaard-look valt daarna terug op de ingebouwde versie.`)) return;
    if (await post({ action: "delete", slug })) {
      setMsg({ tone: "ok", text: "Look verwijderd uit het beheer." });
      cancel();
      router.refresh();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-pslate">
          {looks.length} look(s) · {published} gepubliceerd · {looks.length - published} concept
        </p>
        <button type="button" onClick={startNew} className={BTN}>
          <span className="mr-1.5"><Icon path={P_PLUS} /></span>
          Nieuwe look
        </button>
      </div>

      {msg ? (
        <p className={`text-sm ${msg.tone === "fail" ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p>
      ) : null}

      {brokenLooks.length ? (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
          <Icon path={P_WARN} />
          <div className="text-sm">
            <p className="font-medium">{brokenLooks.length} look(s) verwijzen naar een product dat niet meer koopbaar is.</p>
            <p className="mt-1 text-red-700">
              {brokenLooks.map((l) => l.title || l.slug).join(", ")} — klanten klikken daar op een hotspot en lopen vast.
            </p>
          </div>
        </div>
      ) : null}

      {isNew && draft ? (
        <div className={CARD}>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-pslate">Nieuwe look</p>
          <LookForm
            draft={draft}
            imagesText={imagesText}
            setImagesText={setImagesText}
            patch={patch}
            patchHotspot={patchHotspot}
            setDraft={setDraft}
            health={health}
            slugEditable
          />
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy} className={BTN}>{busy ? "Bezig…" : "Opslaan"}</button>
            <button type="button" onClick={cancel} disabled={busy} className={BTN2}>Annuleren</button>
          </div>
        </div>
      ) : null}

      <ul className="space-y-3">
        {looks.map((look) => {
          const open = editing === look.slug;
          const pr = problems[look.slug] || { broken: 0, warn: 0 };
          return (
            <li key={look.slug} className={CARD}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-pnavy-50">
                  {look.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={look.image} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-pnavy">{look.title || look.slug}</p>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${look.status === "published" ? "bg-emerald-50 text-emerald-700" : "bg-pnavy-50 text-pslate"}`}>
                      {look.status === "published" ? "Gepubliceerd" : "Concept"}
                    </span>
                    {pr.broken ? (
                      <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{pr.broken} niet koopbaar</span>
                    ) : null}
                    {pr.warn ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{pr.warn} zonder maten</span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-pslate">{[look.occasion, look.theme].filter(Boolean).join(" · ") || "Geen gelegenheid"}</p>
                  <p className="mt-0.5 text-xs text-pslate">/looks/{look.slug} · {look.hotspots.length} product(en)</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <a href={`/looks/${look.slug}`} target="_blank" rel="noreferrer" className={BTN2}>
                    <span className="mr-1.5"><Icon path={P_EYE} /></span>
                    Bekijk
                  </a>
                  <button type="button" onClick={() => (open ? cancel() : startEdit(look))} className={BTN2}>
                    {open ? "Sluiten" : "Bewerken"}
                  </button>
                </div>
              </div>

              {/* Productstatus altijd zichtbaar — dit is de stille fout die we willen vangen. */}
              {look.hotspots.length ? (
                <ul className="mt-3 flex flex-wrap gap-1.5">
                  {look.hotspots.map((h, i) => {
                    const st = health[h.handle];
                    const badge = st ? HEALTH_LABEL[st.state] : { text: "Onbekend", tone: "bg-pnavy-50 text-pslate" };
                    return (
                      <li key={`${h.handle}-${i}`} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${badge.tone}`}>
                        <span className="font-medium">{h.label || h.handle}</span>
                        <span className="opacity-80">{badge.text}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-amber-700">Deze look heeft nog geen gekoppelde producten.</p>
              )}

              {open && draft ? (
                <div className="mt-5 border-t border-pnavy-100 pt-5">
                  <LookForm
                    draft={draft}
                    imagesText={imagesText}
                    setImagesText={setImagesText}
                    patch={patch}
                    patchHotspot={patchHotspot}
                    setDraft={setDraft}
                    health={health}
                  />
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button type="button" onClick={save} disabled={busy} className={BTN}>{busy ? "Bezig…" : "Opslaan"}</button>
                    <button type="button" onClick={cancel} disabled={busy} className={BTN2}>Annuleren</button>
                    <button type="button" onClick={() => remove(look.slug)} disabled={busy} className={`${BTN2} !text-red-700`}>
                      <span className="mr-1.5"><Icon path={P_TRASH} /></span>
                      Verwijderen
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      {!looks.length ? <p className="text-sm text-pslate">Er zijn nog geen looks.</p> : null}
    </div>
  );
}

function LookForm({
  draft,
  imagesText,
  setImagesText,
  patch,
  patchHotspot,
  setDraft,
  health,
  slugEditable,
}: {
  draft: AdminLook;
  imagesText: string;
  setImagesText: (v: string) => void;
  patch: (p: Partial<AdminLook>) => void;
  patchHotspot: (i: number, p: Partial<Hotspot>) => void;
  setDraft: React.Dispatch<React.SetStateAction<AdminLook | null>>;
  health: Record<string, ProductHealth>;
  slugEditable?: boolean;
}) {
  function addHotspot() {
    setDraft((d) => (d ? { ...d, hotspots: [...d.hotspots, { handle: "", label: "", x: 50, y: 50 }] } : d));
  }
  function removeHotspot(i: number) {
    setDraft((d) => (d ? { ...d, hotspots: d.hotspots.filter((_, idx) => idx !== i) } : d));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {slugEditable ? (
          <label className="block">
            <span className="text-xs text-pslate">Slug (URL-deel)</span>
            <input value={draft.slug} onChange={(e) => patch({ slug: e.target.value })} placeholder="bijv. zomerse-bruiloftsgast" className={`mt-0.5 ${FIELD}`} />
          </label>
        ) : null}
        <label className="block">
          <span className="text-xs text-pslate">Titel</span>
          <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} className={`mt-0.5 ${FIELD}`} />
        </label>
        <label className="block">
          <span className="text-xs text-pslate">Status</span>
          <select value={draft.status} onChange={(e) => patch({ status: e.target.value === "published" ? "published" : "draft" })} className={`mt-0.5 ${FIELD}`}>
            <option value="published">Gepubliceerd (zichtbaar op de site)</option>
            <option value="draft">Concept (verborgen)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs text-pslate">Gelegenheid</span>
          <input value={draft.occasion} onChange={(e) => patch({ occasion: e.target.value })} placeholder="Bruiloft, Zakelijk, Gala…" className={`mt-0.5 ${FIELD}`} />
        </label>
        <label className="block">
          <span className="text-xs text-pslate">Thema (optioneel)</span>
          <input value={draft.theme} onChange={(e) => patch({ theme: e.target.value })} placeholder="Italiaanse zomer, Black tie…" className={`mt-0.5 ${FIELD}`} />
        </label>
      </div>

      <label className="block">
        <span className="text-xs text-pslate">Ondertitel</span>
        <input value={draft.subtitle} onChange={(e) => patch({ subtitle: e.target.value })} className={`mt-0.5 ${FIELD}`} />
      </label>

      <label className="block">
        <span className="text-xs text-pslate">Verhaal</span>
        <textarea
          value={draft.story}
          onChange={(e) => patch({ story: e.target.value })}
          rows={6}
          placeholder="Waarom werkt deze combinatie? Alinea's scheiden met een lege regel."
          className={`mt-0.5 ${FIELD}`}
        />
        <span className="mt-1 block text-xs text-pslate">Lege regel = nieuwe alinea op de look-pagina.</span>
      </label>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className="block">
          <span className="text-xs text-pslate">Foto&apos;s (één URL per regel)</span>
          <textarea value={imagesText} onChange={(e) => setImagesText(e.target.value)} rows={4} placeholder="https://…" className={`mt-0.5 ${FIELD}`} />
          <span className="mt-1 block text-xs text-pslate">De eerste is de hoofdfoto. Leeg laten = de site kiest zelf een sfeerbeeld.</span>
        </label>
        <div className="h-32 w-24 overflow-hidden rounded-lg bg-pnavy-50">
          {(imagesText.split(/\n+/)[0] || draft.image).trim() ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={(imagesText.split(/\n+/)[0] || draft.image).trim()} alt="" className="h-full w-full object-cover" />
          ) : null}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-wider text-pslate">Gekoppelde producten</span>
          <button type="button" onClick={addHotspot} className={BTN2}>
            <span className="mr-1.5"><Icon path={P_PLUS} /></span>
            Product toevoegen
          </button>
        </div>
        <div className="space-y-2">
          {draft.hotspots.map((h, i) => {
            const st = health[h.handle];
            const badge = st ? HEALTH_LABEL[st.state] : null;
            return (
              <div key={i} className="rounded-lg border border-pnavy-100 p-3">
                <div className="grid gap-2 sm:grid-cols-[2fr_1.5fr_5rem_5rem_auto]">
                  <label className="block">
                    <span className="text-xs text-pslate">Product-handle</span>
                    <input value={h.handle} onChange={(e) => patchHotspot(i, { handle: e.target.value.trim() })} placeholder="colbert-sjas-blauw" className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">Label</span>
                    <input value={h.label} onChange={(e) => patchHotspot(i, { label: e.target.value })} placeholder="Colbert" className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">X %</span>
                    <input type="number" min={0} max={100} value={h.x} onChange={(e) => patchHotspot(i, { x: Number(e.target.value) })} className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">Y %</span>
                    <input type="number" min={0} max={100} value={h.y} onChange={(e) => patchHotspot(i, { y: Number(e.target.value) })} className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <div className="flex items-end">
                    <button type="button" onClick={() => removeHotspot(i)} className={`${BTN2} !text-red-700`} aria-label="Product losmaken">
                      <Icon path={P_TRASH} />
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-xs text-pslate">
                  {badge ? (
                    <span className={`mr-2 inline-flex items-center rounded-full px-2 py-0.5 font-medium ${badge.tone}`}>{badge.text}</span>
                  ) : (
                    <span className="mr-2 inline-flex items-center rounded-full bg-pnavy-50 px-2 py-0.5 font-medium text-pslate">Nog niet gecontroleerd</span>
                  )}
                  {st?.title || "Wordt gecontroleerd na opslaan."}
                </p>
              </div>
            );
          })}
          {!draft.hotspots.length ? <p className="text-sm text-pslate">Nog geen producten gekoppeld.</p> : null}
        </div>
        <p className="mt-2 text-xs text-pslate">
          X en Y zijn percentages op de foto: X = van links, Y = van boven. Overhemd ligt meestal rond 22, pantalon rond 72, schoenen rond 93.
        </p>
      </div>
    </div>
  );
}
