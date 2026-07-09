"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MenuItem } from "@/lib/main-menu";
import { useT } from "@/components/i18n/locale-provider";

/** Desktop: menubalk met brede, geanimeerde mega-panelen (beeld + kolommen). */
export function MegaMenuBar({ items }: { items: MenuItem[] }) {
  const t = useT();
  return (
    <nav aria-label={t("nav.mainMenu")} className="relative">
      <ul className="flex items-center justify-center gap-x-8">
        {items.map((item) => (
          <DesktopItem key={item.label} item={item} />
        ))}
      </ul>
    </nav>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block py-3 font-sans text-sm tracking-wide text-ink-soft transition-colors group-hover:text-ink group-focus-within:text-ink">
      {children}
      <span className="absolute bottom-1.5 left-0 h-px w-full origin-left scale-x-0 bg-ink transition-transform duration-300 ease-out group-hover:scale-x-100 group-focus-within:scale-x-100" />
    </span>
  );
}

function DesktopItem({ item }: { item: MenuItem }) {
  const hasMega = Boolean(item.columns?.length);
  // Na een klik navigeert Next.js client-side zónder herladen; de geklikte link
  // houdt focus (:focus-within) en de muis hangt nog boven het paneel (:hover),
  // waardoor het mega-paneel open blijft. We forceren het dicht bij een klik en
  // herstellen zodra de muis het menu-item verlaat.
  const [closed, setClosed] = useState(false);
  // Open-staat (hover OF toetsenbordfocus) — puur voor de juiste aria-expanded-
  // aankondiging; de zichtbaarheid zelf blijft via de CSS-reveal lopen.
  const [open, setOpen] = useState(false);

  if (!hasMega) {
    return (
      <li className="group">
        <Link href={item.href}>
          <Label>{item.label}</Label>
        </Link>
      </li>
    );
  }

  const closeOnNav = () => {
    setClosed(true);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const base = "invisible absolute left-0 right-0 top-full z-50 -translate-y-2 pt-1 opacity-0 transition-all duration-200 ease-out";
  const reveal =
    "group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:visible group-focus-within:translate-y-0 group-focus-within:opacity-100";

  return (
    <li
      className="group"
      onMouseEnter={() => { setOpen(true); setClosed(false); }}
      onMouseLeave={() => { setOpen(false); setClosed(false); }}
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false); }}
      // Escape sluit het paneel voor toetsenbordgebruikers (verbergt + geeft focus vrij).
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setClosed(true);
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        }
      }}
    >
      <button type="button" aria-haspopup="true" aria-expanded={open && !closed} className="cursor-default">
        <Label>{item.label}</Label>
      </button>
      <div className={`${base} ${closed ? "" : reveal}`}>
        <div className="overflow-hidden rounded-card border border-line bg-canvas shadow-pop">
          <div className="grid grid-cols-[repeat(3,minmax(0,1fr))_1.25fr] gap-8 p-8">
            {item.columns!.map((col) => (
              <div key={col.title ?? col.links[0].label}>
                {col.title ? <p className="label-brand mb-3">{col.title}</p> : null}
                <ul className="space-y-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <Link href={l.href} onClick={closeOnNav} className="group/link inline-flex items-center gap-1.5 font-sans text-sm text-ink-soft transition-colors hover:text-ink">
                        {l.label}
                        <span aria-hidden className="translate-x-0 opacity-0 transition-all duration-200 group-hover/link:translate-x-0.5 group-hover/link:opacity-100">→</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {(item.features ?? []).map((f) => (
              <Link key={f.label} href={f.href} onClick={closeOnNav} className="group/feat relative block aspect-[4/5] overflow-hidden rounded-card bg-surface">
                <Image src={f.image} alt={f.label} fill sizes="22vw" className="object-cover transition-transform duration-500 group-hover/feat:scale-105" />
                <span className="absolute inset-0 bg-gradient-to-t from-ink/55 via-transparent to-transparent" />
                <span className="absolute inset-x-4 bottom-4 text-canvas">
                  {f.caption ? <span className="block font-sans text-[0.65rem] uppercase tracking-wide opacity-90">{f.caption}</span> : null}
                  <span className="block font-display text-lg">{f.label}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </li>
  );
}

/** Mobiel: hamburger + uitklap-drawer met kolommen. */
export function MegaMenuMobile({ items }: { items: MenuItem[] }) {
  const t = useT();
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      {/* Min. 44×44px tikvlak; -ml-2 houdt de balkjes optisch op de gutter. */}
      <button type="button" onClick={() => setMobileOpen(true)} aria-label={t("nav.openMenuAriaLabel")} className="-ml-2 flex h-11 w-11 flex-col items-center justify-center">
        <span className="block h-0.5 w-6 bg-ink" />
        <span className="mt-1.5 block h-0.5 w-6 bg-ink" />
        <span className="mt-1.5 block h-0.5 w-6 bg-ink" />
      </button>
      {mobileOpen ? <MobileDrawer items={items} onClose={() => setMobileOpen(false)} /> : null}
    </>
  );
}

function MobileDrawer({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const t = useT();
  const [open, setOpen] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Toegankelijkheid: Esc sluit, focus blijft binnen de drawer (trap), achtergrond
  // scrollt niet mee, en de focus keert terug naar het openende element.
  useEffect(() => {
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      panelRef.current
        ? Array.from(
            panelRef.current.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])'
            )
          )
        : [];
    focusables()[0]?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const list = focusables();
        if (!list.length) return;
        const first = list[0];
        const last = list[list.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prevFocus?.focus?.();
    };
  }, [onClose]);

  // Belangrijk: via een portal naar document.body renderen. De drawer is "fixed
  // inset-0", maar de header eromheen heeft backdrop-blur (= backdrop-filter), en
  // dat maakt de header het containing block voor fixed-kinderen — waardoor de
  // drawer anders ingeklemd raakt op de header-hoogte i.p.v. het hele scherm.
  const tree = (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 animate-[fadeIn_.2s_ease] bg-ink/40" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("nav.mainMenu")}
        className="absolute inset-y-0 left-0 w-[88%] max-w-sm animate-[slideInLeft_.25s_ease-out] overflow-y-auto bg-canvas shadow-drawer"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="label-brand">Menu</span>
          <button type="button" onClick={onClose} aria-label={t("nav.closeMenuAriaLabel")} className="font-sans text-sm underline">{t("common.close")}</button>
        </div>
        <ul className="px-2 py-2">
          {items.map((item) => {
            const hasMega = Boolean(item.columns?.length);
            const isOpen = open === item.label;
            return (
              <li key={item.label} className="border-b border-line/60">
                {hasMega ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : item.label)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between px-3 py-3.5 text-left font-sans text-sm font-medium"
                    >
                      {item.label}
                      <span aria-hidden className={`text-muted transition-transform duration-200 ${isOpen ? "rotate-45" : ""}`}>+</span>
                    </button>
                    {isOpen ? (
                      <div className="pb-3">
                        {item.columns!.map((col) => (
                          <div key={col.title ?? col.links[0].label} className="mb-2">
                            {col.title ? <p className="px-6 pb-1 pt-2 font-sans text-[0.65rem] uppercase tracking-wide text-muted">{col.title}</p> : null}
                            {col.links.map((l) => (
                              <Link key={l.label} href={l.href} onClick={onClose} className="block px-6 py-2 font-sans text-sm text-ink-soft">
                                {l.label}
                              </Link>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <Link href={item.href} onClick={onClose} className="block px-3 py-3.5 font-sans text-sm font-medium">
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <div className="border-t border-line px-5 py-4">
          <Link href="/pages/winkels" onClick={onClose} className="block py-1.5 font-sans text-sm text-ink-soft">{t("nav.stores")}</Link>
          <Link href="/maatadvies" onClick={onClose} className="block py-1.5 font-sans text-sm text-ink-soft">{t("nav.sizeAdvice")}</Link>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(tree, document.body);
}
