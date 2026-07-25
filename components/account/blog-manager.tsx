"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Stijlgids-beheer in de Site-studio: artikelen bekijken, titel/intro/secties
 * redigeren en een nieuw artikel laten genereren (Claude, via lib/blog).
 */

export type AdminSection = { heading: string; body: string; productHandles: string[] };
export type AdminPost = {
  slug: string;
  topicKey: string;
  title: string;
  excerpt: string;
  intro: string;
  seoTitle: string;
  seoDescription: string;
  occasion: string;
  heroImage: string;
  author: string;
  publishedAt: string;
  sections: AdminSection[];
};

const CARD = "rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal";
const FIELD =
  "w-full rounded-lg border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";
const BTN = "inline-flex items-center justify-center rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700 disabled:opacity-50";
const BTN2 = "inline-flex items-center justify-center rounded-lg border border-pnavy-100 bg-white px-3 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50 disabled:opacity-50";

const dateFmt = new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" });
function niceDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

function Icon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}
const P_PLUS = "M12 5v14M5 12h14";
const P_TRASH = "M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14";
const P_EYE = "M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7zM12 15a3 3 0 100-6 3 3 0 000 6z";
const P_INFO = "M12 16v-4M12 8h.01M12 21a9 9 0 100-18 9 9 0 000 18z";

export function BlogManager({
  posts,
  topics,
  aiReady,
}: {
  posts: AdminPost[];
  topics: { key: string; title: string; used: boolean }[];
  aiReady: boolean;
}) {
  const router = useRouter();
  const [openSlug, setOpenSlug] = useState<string | null>(null);
  const [draft, setDraft] = useState<AdminPost | null>(null);
  const [topicKey, setTopicKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "ok" | "fail"; text: string } | null>(null);

  function startEdit(post: AdminPost) {
    setOpenSlug(post.slug);
    setDraft({ ...post, sections: post.sections.map((s) => ({ ...s, productHandles: [...s.productHandles] })) });
    setMsg(null);
  }
  function cancel() {
    setOpenSlug(null);
    setDraft(null);
  }
  function patch(p: Partial<AdminPost>) {
    setDraft((d) => (d ? { ...d, ...p } : d));
  }
  function patchSection(i: number, p: Partial<AdminSection>) {
    setDraft((d) => (d ? { ...d, sections: d.sections.map((s, idx) => (idx === i ? { ...s, ...p } : s)) } : d));
  }
  function addSection() {
    setDraft((d) => (d ? { ...d, sections: [...d.sections, { heading: "", body: "", productHandles: [] }] } : d));
  }
  function removeSection(i: number) {
    setDraft((d) => (d ? { ...d, sections: d.sections.filter((_, idx) => idx !== i) } : d));
  }

  async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch("/api/account/blog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !d.ok) return { ok: false, error: d.error || "Actie mislukt." };
      return { ok: true };
    } catch {
      return { ok: false, error: "Actie mislukt — geen verbinding." };
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft) return;
    const res = await post({
      action: "update",
      slug: draft.slug,
      title: draft.title,
      excerpt: draft.excerpt,
      intro: draft.intro,
      seoTitle: draft.seoTitle,
      seoDescription: draft.seoDescription,
      sections: draft.sections.filter((s) => s.heading.trim() && s.body.trim()),
    });
    if (res.ok) {
      setMsg({ tone: "ok", text: "Artikel bijgewerkt." });
      cancel();
      router.refresh();
    } else {
      setMsg({ tone: "fail", text: res.error || "Opslaan mislukt." });
    }
  }

  async function remove(slug: string, title: string) {
    if (!window.confirm(`"${title}" verwijderen? Het artikel verdwijnt van /blog en van de productpagina's.`)) return;
    const res = await post({ action: "delete", slug });
    if (res.ok) {
      setMsg({ tone: "ok", text: "Artikel verwijderd." });
      cancel();
      router.refresh();
    } else {
      setMsg({ tone: "fail", text: res.error || "Verwijderen mislukt." });
    }
  }

  async function generate() {
    const res = await post({ action: "generate", topicKey: topicKey || undefined });
    if (res.ok) {
      setMsg({ tone: "ok", text: "Nieuw artikel geschreven — controleer de tekst voor je 'm laat staan." });
      router.refresh();
    } else {
      setMsg({ tone: "fail", text: res.error || "Genereren mislukt." });
    }
  }

  return (
    <div className="space-y-5">
      <div className={CARD}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-pslate">Nieuw artikel laten schrijven</p>
        {aiReady ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block min-w-[16rem] flex-1">
              <span className="text-xs text-pslate">Onderwerp</span>
              <select value={topicKey} onChange={(e) => setTopicKey(e.target.value)} className={`mt-0.5 ${FIELD}`}>
                <option value="">Volgend onderwerp (automatisch gekozen)</option>
                {topics.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.title}
                    {t.used ? " — bestaat al" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" onClick={generate} disabled={busy} className={BTN}>
              <span className="mr-1.5"><Icon path={P_PLUS} /></span>
              {busy ? "Bezig…" : "Artikel genereren"}
            </button>
          </div>
        ) : (
          <div className="flex gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-amber-800">
            <Icon path={P_INFO} />
            <div className="text-sm">
              <p className="font-medium">Genereren staat uit: er is geen AI-sleutel ingesteld.</p>
              <p className="mt-1">
                Zet <code className="rounded bg-white/70 px-1">ANTHROPIC_API_KEY</code> in de omgeving van de webshop.
                Bestaande artikelen kun je gewoon redigeren.
              </p>
            </div>
          </div>
        )}
        <p className="mt-3 text-xs text-pslate">
          Het artikel wordt geschreven met échte producten die op dit moment op voorraad zijn. Lees het na voor je het laat staan.
        </p>
      </div>

      {msg ? <p className={`text-sm ${msg.tone === "fail" ? "text-red-700" : "text-emerald-700"}`}>{msg.text}</p> : null}

      <p className="text-sm text-pslate">{posts.length} artikel(en)</p>

      <ul className="space-y-3">
        {posts.map((p) => {
          const open = openSlug === p.slug;
          return (
            <li key={p.slug} className={CARD}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-pnavy-50">
                  {p.heroImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.heroImage} alt="" className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-pnavy">{p.title}</p>
                  <p className="mt-0.5 text-sm text-pslate">{p.excerpt || "Geen samenvatting"}</p>
                  <p className="mt-0.5 text-xs text-pslate">
                    {niceDate(p.publishedAt)} · {p.sections.length} sectie(s) ·{" "}
                    {[...new Set(p.sections.flatMap((s) => s.productHandles))].length} product(en)
                    {p.occasion ? ` · ${p.occasion}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <a href={`/blog/${p.slug}`} target="_blank" rel="noreferrer" className={BTN2}>
                    <span className="mr-1.5"><Icon path={P_EYE} /></span>
                    Bekijk
                  </a>
                  <button type="button" onClick={() => (open ? cancel() : startEdit(p))} className={BTN2}>
                    {open ? "Sluiten" : "Bewerken"}
                  </button>
                </div>
              </div>

              {open && draft ? (
                <div className="mt-5 space-y-4 border-t border-pnavy-100 pt-5">
                  <label className="block">
                    <span className="text-xs text-pslate">Titel</span>
                    <input value={draft.title} onChange={(e) => patch({ title: e.target.value })} className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">Samenvatting (één zin, op de overzichtspagina)</span>
                    <input value={draft.excerpt} onChange={(e) => patch({ excerpt: e.target.value })} className={`mt-0.5 ${FIELD}`} />
                  </label>
                  <label className="block">
                    <span className="text-xs text-pslate">Intro</span>
                    <textarea value={draft.intro} onChange={(e) => patch({ intro: e.target.value })} rows={5} className={`mt-0.5 ${FIELD}`} />
                  </label>

                  <div>
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="text-xs font-semibold uppercase tracking-wider text-pslate">Secties</span>
                      <button type="button" onClick={addSection} className={BTN2}>
                        <span className="mr-1.5"><Icon path={P_PLUS} /></span>
                        Sectie toevoegen
                      </button>
                    </div>
                    <div className="space-y-3">
                      {draft.sections.map((s, i) => (
                        <div key={i} className="rounded-lg border border-pnavy-100 p-3">
                          <div className="flex items-start gap-2">
                            <label className="block flex-1">
                              <span className="text-xs text-pslate">Kop</span>
                              <input value={s.heading} onChange={(e) => patchSection(i, { heading: e.target.value })} className={`mt-0.5 ${FIELD}`} />
                            </label>
                            <button type="button" onClick={() => removeSection(i)} className={`${BTN2} mt-5 !text-red-700`} aria-label="Sectie verwijderen">
                              <Icon path={P_TRASH} />
                            </button>
                          </div>
                          <label className="mt-2 block">
                            <span className="text-xs text-pslate">Tekst</span>
                            <textarea value={s.body} onChange={(e) => patchSection(i, { body: e.target.value })} rows={5} className={`mt-0.5 ${FIELD}`} />
                          </label>
                          <label className="mt-2 block">
                            <span className="text-xs text-pslate">Gekoppelde producten (handles, komma-gescheiden)</span>
                            <input
                              value={s.productHandles.join(", ")}
                              onChange={(e) =>
                                patchSection(i, {
                                  productHandles: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                                })
                              }
                              placeholder="colbert-sjas-blauw, overhemd-nos-wit"
                              className={`mt-0.5 ${FIELD}`}
                            />
                          </label>
                        </div>
                      ))}
                      {!draft.sections.length ? <p className="text-sm text-pslate">Nog geen secties.</p> : null}
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block">
                      <span className="text-xs text-pslate">SEO-titel</span>
                      <input value={draft.seoTitle} onChange={(e) => patch({ seoTitle: e.target.value })} className={`mt-0.5 ${FIELD}`} />
                    </label>
                    <label className="block">
                      <span className="text-xs text-pslate">SEO-omschrijving</span>
                      <input value={draft.seoDescription} onChange={(e) => patch({ seoDescription: e.target.value })} className={`mt-0.5 ${FIELD}`} />
                    </label>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={save} disabled={busy} className={BTN}>{busy ? "Bezig…" : "Opslaan"}</button>
                    <button type="button" onClick={cancel} disabled={busy} className={BTN2}>Annuleren</button>
                    <button type="button" onClick={() => remove(p.slug, p.title)} disabled={busy} className={`${BTN2} !text-red-700`}>
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

      {!posts.length ? <p className="text-sm text-pslate">Er zijn nog geen artikelen.</p> : null}
    </div>
  );
}
