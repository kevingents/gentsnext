"use client";

import { useEffect, useState } from "react";
import { IconChevron, IconPlus, IconTrash } from "@/components/account/studio-icons";
import { IMAGE_HINT, isSafeImageSrc } from "@/lib/safe-image";

export type StudioPage = {
  slug: string;
  title: string;
  body: string;
  seoDescription?: string;
  image?: string;
  updatedAt?: string;
};

const FIELD =
  "w-full rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:opacity-50";
const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-pnavy-100 bg-white px-3 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:opacity-50";

const slugify = (v: string) =>
  v.toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" });

export function PagesEditor({ initial, reserved }: { initial: StudioPage[]; reserved: string[] }) {
  const [items, setItems] = useState<StudioPage[]>(initial);
  const [open, setOpen] = useState<number | null>(initial.length ? null : 0);
  const [state, setState] = useState<"idle" | "busy" | "done" | "fail">("idle");
  const [msg, setMsg] = useState("");
  /**
   * Versiestempel van de lijst zoals die geladen is. De portal schrijft
   * hetzelfde document; zonder deze stempel zou opslaan de wijziging van een
   * collega (of van een tweede tabblad) stilzwijgend wissen.
   */
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/account/paginas")
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

  const reservedSet = new Set(reserved);

  function patch(i: number, p: Partial<StudioPage>) {
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)));
    setState("idle");
  }

  function addPage() {
    setItems((prev) => [{ slug: "", title: "", body: "", seoDescription: "", image: "" }, ...prev]);
    setOpen(0);
    setState("idle");
  }

  function removePage(i: number) {
    const p = items[i];
    if (!confirm(`Pagina "${p.title || p.slug || "zonder titel"}" verwijderen? Dit gaat pas echt weg als je daarna opslaat.`)) return;
    setItems((prev) => prev.filter((_, idx) => idx !== i));
    setOpen(null);
    setState("idle");
  }

  /** Client-check zodat de beheerder de fout ziet vóór het opslaan. */
  function problems(): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    items.forEach((p, i) => {
      const nr = `Pagina ${i + 1}`;
      const slug = slugify(p.slug || p.title);
      if (!p.title.trim()) out.push(`${nr}: titel is verplicht.`);
      if (!slug) out.push(`${nr}: webadres is verplicht.`);
      else if (seen.has(slug)) out.push(`${nr}: webadres "${slug}" bestaat al twee keer.`);
      else if (reservedSet.has(slug)) out.push(`${nr}: webadres "${slug}" is bezet door een vaste pagina.`);
      // Een beeld dat next/image niet aankan laat de publieke pagina crashen.
      if (!isSafeImageSrc(p.image || "")) out.push(`${nr}: ${IMAGE_HINT}`);
      seen.add(slug);
    });
    return out;
  }

  async function save() {
    const errs = problems();
    if (errs.length) {
      setState("fail");
      setMsg(errs.join(" "));
      return;
    }
    setState("busy");
    setMsg("");
    try {
      const payload = items.map((p) => ({ ...p, slug: slugify(p.slug || p.title) }));
      const r = await fetch("/api/account/paginas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: payload, ...(version ? { version } : {}) }),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string; items?: StudioPage[]; version?: string };
      if (r.ok && d.ok) {
        setItems(d.items || payload);
        if (typeof d.version === "string") setVersion(d.version);
        setState("done");
        setMsg("Opgeslagen — binnen een halve minuut live op de site.");
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
        <button type="button" onClick={addPage} className={BTN_SECONDARY}>
          <IconPlus />
          Nieuwe pagina
        </button>
        <button type="button" onClick={save} disabled={state === "busy"} className={BTN_PRIMARY}>
          {state === "busy" ? "Opslaan…" : "Alles opslaan"}
        </button>
        {msg ? (
          <span className={`text-sm ${state === "fail" ? "text-red-700" : "text-emerald-700"}`}>{msg}</span>
        ) : null}
      </div>

      {!items.length ? (
        <p className="rounded-xl border border-pnavy-100 bg-white p-5 text-sm text-pslate shadow-portal">
          Er zijn nog geen eigen pagina&apos;s. Maak er een met &quot;Nieuwe pagina&quot;.
        </p>
      ) : null}

      <ul className="space-y-3">
        {items.map((p, i) => {
          const slug = slugify(p.slug || p.title);
          const isOpen = open === i;
          return (
            // Index als key: de slug verandert tijdens het typen, dan zou het
            // invoerveld remounten en focus verliezen.
            <li key={i} className="rounded-xl border border-pnavy-100 bg-white shadow-portal">
              <div className="flex items-center gap-3 p-4">
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
                    <span className="block truncate text-sm font-medium text-pnavy">{p.title || "Nieuwe pagina"}</span>
                    <span className="block truncate text-xs text-pslate">
                      /pages/{slug || "…"}
                      {p.updatedAt ? ` · bijgewerkt ${dateFmt.format(new Date(p.updatedAt))}` : ""}
                    </span>
                  </span>
                </button>
                {slug ? (
                  <a
                    href={`/pages/${slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden shrink-0 text-xs text-pslate underline hover:text-pnavy sm:inline"
                  >
                    Bekijk
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => removePage(i)}
                  title="Pagina verwijderen"
                  className="shrink-0 rounded-lg border border-pnavy-100 p-2 text-pslate transition-colors hover:bg-red-50 hover:text-red-700"
                >
                  <IconTrash />
                </button>
              </div>

              {isOpen ? (
                <div className="space-y-4 border-t border-pnavy-100 p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm text-pnavy">Titel</span>
                      <input
                        className={`mt-1 ${FIELD}`}
                        value={p.title}
                        onChange={(e) => patch(i, { title: e.target.value })}
                        placeholder="Bijvoorbeeld: Over GENTS"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm text-pnavy">Webadres</span>
                      <div className="mt-1 flex items-center gap-1">
                        <span className="shrink-0 text-sm text-pslate">/pages/</span>
                        <input
                          className={FIELD}
                          value={p.slug}
                          onChange={(e) => patch(i, { slug: e.target.value })}
                          onBlur={(e) => patch(i, { slug: slugify(e.target.value) })}
                          placeholder="over-gents"
                        />
                      </div>
                      <span className="mt-1 block text-xs text-pslate">
                        Kleine letters en streepjes. Laat leeg om hem uit de titel te maken.
                      </span>
                    </label>
                  </div>

                  <label className="block">
                    <span className="text-sm text-pnavy">Tekst</span>
                    <textarea
                      className={`mt-1 min-h-[16rem] font-mono text-[13px] leading-relaxed ${FIELD}`}
                      value={p.body}
                      onChange={(e) => patch(i, { body: e.target.value })}
                      placeholder={"# Kop\n\nEen alinea tekst.\n\n- Punt een\n- Punt twee"}
                    />
                    <span className="mt-1 block text-xs text-pslate">
                      Lege regel = nieuwe alinea. <code>#</code> / <code>##</code> maakt een kop,
                      <code> - </code> een opsomming, <code>**vet**</code> vet en
                      <code> [tekst](/pages/…) </code> een link. Andere HTML wordt niet uitgevoerd.
                    </span>
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-sm text-pnavy">Google-omschrijving</span>
                      <input
                        className={`mt-1 ${FIELD}`}
                        value={p.seoDescription || ""}
                        maxLength={200}
                        onChange={(e) => patch(i, { seoDescription: e.target.value })}
                        placeholder="Korte samenvatting voor in Google"
                      />
                    </label>
                    <label className="block">
                      <span className="text-sm text-pnavy">Afbeelding bovenaan</span>
                      <input
                        className={`mt-1 ${FIELD}`}
                        value={p.image || ""}
                        onChange={(e) => patch(i, { image: e.target.value })}
                        placeholder="/brand/brand-model-navy.jpg"
                      />
                      <span className="mt-1 block text-xs text-pslate">
                        Leeg = de site kiest zelf een passend beeld.
                      </span>
                    </label>
                  </div>

                  {p.image ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.image} alt="" className="h-28 w-auto rounded-lg border border-pnavy-100 object-cover" />
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
