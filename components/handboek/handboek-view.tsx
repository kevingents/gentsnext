"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Handboek } from "@/lib/handboek";

/**
 * Het handboek op het scherm: inhoudsopgave, zoekveld en de hoofdstukken.
 *
 * ZOEKEN FILTERT, HET SPRINGT NIET. Een handboek van tientallen hoofdstukken
 * wordt anders een lijst treffers waar je uit moet klikken; door de niet-passende
 * hoofdstukken te verbergen houd je de structuur (deel → hoofdstuk) zichtbaar en
 * zie je meteen in wélk deel het antwoord staat. De inhoudsopgave krimpt mee.
 *
 * De hoofdstukinhoud is HTML uit content/handboek.ts — eigen tekst uit deze repo,
 * geen invoer van buiten en geen portal-content, dus die zetten we rechtstreeks
 * neer. Zou dit ooit uit een beheerscherm komen, dan hoort er een parser tussen
 * (zoals components/page-body voor de contentpagina's).
 */
export function HandboekView({ handboek }: { handboek: Handboek }) {
  const { delen, stand } = handboek;
  const [term, setTerm] = useState("");
  const [actief, setActief] = useState<string>("");
  const zoekRef = useRef<HTMLInputElement>(null);

  /** Doorzoekbare tekst per hoofdstuk: kop + inhoud, zonder opmaak. */
  const doorzoekbaar = useMemo(() => {
    const kaart = new Map<string, string>();
    for (const deel of delen) {
      for (const h of deel.hoofdstukken) {
        const plat = h.html.replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ");
        kaart.set(h.anker, `${deel.titel} ${h.nr} ${h.titel} ${plat}`.toLowerCase());
      }
    }
    return kaart;
  }, [delen]);

  const zoekterm = term.trim().toLowerCase();
  const woorden = zoekterm ? zoekterm.split(/\s+/).filter(Boolean) : [];
  const past = (anker: string) => {
    if (!woorden.length) return true;
    const tekst = doorzoekbaar.get(anker) || "";
    return woorden.every((w) => tekst.includes(w));
  };

  const treffers = useMemo(
    () => delen.flatMap((d) => d.hoofdstukken).filter((h) => past(h.anker)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zoekterm, delen],
  );

  /* Sneltoets: "/" zet de cursor in het zoekveld, Escape maakt het leeg. Wie een
     handboek openslaat wil zoeken, niet eerst met de muis naar een veld. */
  useEffect(() => {
    const opToets = (e: KeyboardEvent) => {
      const doel = e.target as HTMLElement | null;
      const inVeld = doel && /^(INPUT|TEXTAREA|SELECT)$/.test(doel.tagName);
      if (e.key === "/" && !inVeld) {
        e.preventDefault();
        zoekRef.current?.focus();
      } else if (e.key === "Escape" && inVeld) {
        setTerm("");
        zoekRef.current?.blur();
      }
    };
    window.addEventListener("keydown", opToets);
    return () => window.removeEventListener("keydown", opToets);
  }, []);

  /* Meelopende markering in de inhoudsopgave. Alleen het bovenste zichtbare
     hoofdstuk telt; anders springt de markering heen en weer op een lange pagina. */
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const zichtbaar = new Set<string>();
    const waarnemer = new IntersectionObserver(
      (regels) => {
        for (const r of regels) {
          const id = r.target.id;
          if (r.isIntersecting) zichtbaar.add(id);
          else zichtbaar.delete(id);
        }
        const alle = delen.flatMap((d) => d.hoofdstukken.map((h) => h.anker));
        const eerste = alle.find((a) => zichtbaar.has(a));
        if (eerste) setActief(eerste);
      },
      { rootMargin: "-8% 0px -70% 0px", threshold: 0 },
    );
    for (const el of document.querySelectorAll(".hb-hst")) waarnemer.observe(el);
    return () => waarnemer.disconnect();
  }, [delen, zoekterm]);

  return (
    <div className="hb">
      <header className="hb-mast">
        <div className="hb-mast-in">
          <div className="hb-merk">GENTS &nbsp;·&nbsp; SUITS YOU</div>
          <p className="hb-eyebrow">Handboek van het hele platform</p>
          <h1>Platformhandboek</h1>
          <p className="hb-lead">
            Website, kassa, handscanner, voorraad en portal: hoe alles werkt, welke logica eronder ligt, welke workflows
            erop draaien en welke knoppen het team zelf beheert.
          </p>
          <div className="hb-meta-rij">
            <span className="hb-meta">{stand.delen} delen</span>
            <span className="hb-meta">{stand.hoofdstukken} hoofdstukken</span>
            <span className="hb-meta">{stand.modules} modules</span>
            <span className="hb-meta">{stand.endpoints} endpoints</span>
            <span className="hb-meta">{stand.taken} geplande taken</span>
            <span className="hb-meta">bedragen en drempels: live</span>
          </div>
        </div>
      </header>

      <div className="hb-shell">
        <div className="hb-rail">
          <div className="hb-zoek">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={zoekRef}
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Zoek in het handboek…  (/)"
              aria-label="Zoek in het handboek"
              autoComplete="off"
            />
          </div>
          <div className="hb-uitslag" role="status">
            {zoekterm ? `${treffers} van ${stand.hoofdstukken} hoofdstukken` : `${stand.hoofdstukken} hoofdstukken`}
          </div>
          <nav className="hb-toc" aria-label="Inhoud">
            {delen.map((deel) => {
              const zichtbaar = deel.hoofdstukken.filter((h) => past(h.anker));
              if (!zichtbaar.length) return null;
              return (
                <div key={deel.id}>
                  <div className="hb-deelkop">
                    {deel.rom} · {deel.titel}
                  </div>
                  {zichtbaar.map((h) => (
                    <a key={h.anker} href={`#${h.anker}`} className={h.anker === actief ? "hb-actief" : undefined}>
                      <span>{h.nr}</span>
                      {h.titel}
                    </a>
                  ))}
                </div>
              );
            })}
          </nav>
        </div>

        <main className="hb-main">
          {delen.map((deel) => {
            const zichtbaar = deel.hoofdstukken.filter((h) => past(h.anker));
            if (!zichtbaar.length) return null;
            return (
              <section className="hb-deel" id={deel.id} key={deel.id}>
                <header>
                  <div className="hb-rom">{deel.rom}</div>
                  <h2>{deel.titel}</h2>
                  <p className="hb-deel-intro">{deel.intro}</p>
                </header>
                <div className="hb-stapel">
                  {zichtbaar.map((h) => (
                    <article className="hb-hst" id={h.anker} key={h.anker}>
                      <h3>
                        <span className="hb-nr">{h.nr}</span>
                        {h.titel}
                      </h3>
                      <div className="hb-body" dangerouslySetInnerHTML={{ __html: h.html }} />
                    </article>
                  ))}
                </div>
              </section>
            );
          })}

          <footer className="hb-slot">
            <p>
              Dit handboek wordt bij elke uitrol opnieuw samengesteld. De verhaalkant staat in de repo
              (<code>content/handboek.ts</code>); bedragen, drempels en taken worden live gelezen uit de instellingen en
              de projectconfiguratie, en de lijsten met modules, endpoints en tabellen worden uit de code zelf afgeleid.
              Klopt er iets niet met de praktijk, meld het — dan klopt de code niet, of de tekst.
            </p>
          </footer>
        </main>
      </div>
    </div>
  );
}
