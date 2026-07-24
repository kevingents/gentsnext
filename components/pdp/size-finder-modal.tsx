"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useModalA11y } from "@/components/hooks/use-modal-a11y";
import { SizeAdvisor } from "@/components/maatadvies/size-advisor";
import { useT } from "@/components/i18n/locale-provider";

/**
 * "Vind mijn maat" als overlay op de PDP — wegnavigeren naar /maatadvies
 * midden in het koopproces was onlogisch (Kevin, 24 juli): de klant verloor
 * z'n productpagina. Zelfde drawer-patroon als de maattabel; de volledige
 * pagina blijft bestaan voor SEO en directe links.
 */
export function SizeFinderButton() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  useModalA11y(panelRef, { onClose: () => setOpen(false), active: open, inertMain: true });

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-ink underline underline-offset-4">
        {t("pdp.size.finder")}
      </button>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[60]" role="dialog" aria-label={t("pdp.size.finder")} aria-modal="true">
              <div className="absolute inset-0 bg-ink/40" onClick={() => setOpen(false)} />
              <div ref={panelRef} tabIndex={-1} className="absolute inset-y-0 right-0 flex w-full max-w-lg flex-col bg-canvas shadow-drawer focus:outline-none">
                <div className="flex items-center justify-between border-b border-line px-5 py-4">
                  <p className="font-display text-lg">{t("pdp.size.finder")}</p>
                  <button type="button" onClick={() => setOpen(false)} aria-label={t("common.close")} className="font-sans text-sm underline">{t("common.close")}</button>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-4">
                  <SizeAdvisor />
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
