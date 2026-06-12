"use client";

import Link from "next/link";
import { useState } from "react";
import { MAIN_MENU, type MenuItem } from "@/lib/main-menu";

/** Desktop: horizontale menubalk met dropdowns. */
export function MegaMenuBar() {
  return (
    <nav aria-label="Hoofdmenu">
      <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
        {MAIN_MENU.map((item) => (
          <DesktopItem key={item.label} item={item} />
        ))}
      </ul>
    </nav>
  );
}

/** Mobiel: hamburger + uitklap-drawer. */
export function MegaMenuMobile() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setMobileOpen(true)} aria-label="Menu openen" className="p-1">
        <span className="block h-0.5 w-6 bg-ink" />
        <span className="mt-1.5 block h-0.5 w-6 bg-ink" />
        <span className="mt-1.5 block h-0.5 w-6 bg-ink" />
      </button>
      {mobileOpen ? <MobileDrawer onClose={() => setMobileOpen(false)} /> : null}
    </>
  );
}

function DesktopItem({ item }: { item: MenuItem }) {
  const hasChildren = Boolean(item.children?.length);
  const isLink = item.href !== "#";
  const wide = (item.children?.length ?? 0) > 6;

  return (
    <li className="group relative">
      {isLink ? (
        <Link
          href={item.href}
          className="flex items-center gap-1 py-2 font-sans text-sm text-ink-soft transition-colors hover:text-ink group-focus-within:text-ink"
        >
          {item.label}
        </Link>
      ) : (
        <button
          type="button"
          aria-haspopup="true"
          className="flex items-center gap-1 py-2 font-sans text-sm text-ink-soft transition-colors hover:text-ink group-focus-within:text-ink"
        >
          {item.label}
        </button>
      )}

      {hasChildren ? (
        <div
          className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-2 opacity-0 transition-opacity duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        >
          <div
            className={`border border-line bg-canvas p-5 shadow-pop ${wide ? "w-[26rem]" : "w-56"}`}
          >
            <ul className={wide ? "grid grid-cols-2 gap-x-6 gap-y-1" : "space-y-1"}>
              {item.children!.map((child) => (
                <li key={child.label}>
                  <Link
                    href={child.href}
                    className="block py-1.5 font-sans text-sm text-ink-soft transition-colors hover:text-ink"
                  >
                    {child.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function MobileDrawer({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div className="absolute inset-y-0 left-0 w-[88%] max-w-sm overflow-y-auto bg-canvas shadow-drawer">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="label-brand">Menu</span>
          <button type="button" onClick={onClose} aria-label="Menu sluiten" className="font-sans text-sm underline">
            Sluiten
          </button>
        </div>
        <ul className="px-2 py-2">
          {MAIN_MENU.map((item) => {
            const hasChildren = Boolean(item.children?.length);
            const isOpen = open === item.label;
            return (
              <li key={item.label} className="border-b border-line/60">
                {hasChildren ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : item.label)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center justify-between px-3 py-3 text-left font-sans text-sm font-medium"
                    >
                      {item.label}
                      <span aria-hidden className="text-muted">
                        {isOpen ? "–" : "+"}
                      </span>
                    </button>
                    {isOpen ? (
                      <ul className="pb-2">
                        {item.href !== "#" ? (
                          <li>
                            <Link
                              href={item.href}
                              onClick={onClose}
                              className="block px-6 py-2 font-sans text-sm font-medium text-ink"
                            >
                              Alles in {item.label}
                            </Link>
                          </li>
                        ) : null}
                        {item.children!.map((child) => (
                          <li key={child.label}>
                            <Link
                              href={child.href}
                              onClick={onClose}
                              className="block px-6 py-2 font-sans text-sm text-ink-soft"
                            >
                              {child.label}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </>
                ) : (
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className="block px-3 py-3 font-sans text-sm font-medium"
                  >
                    {item.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
