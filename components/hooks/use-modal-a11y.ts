"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * Gedeelde modal-toegankelijkheid: focus het eerste element in het paneel, houd
 * Tab-focus binnen het paneel (trap), sluit op Escape, lock de body-scroll en geef
 * de focus terug aan het openende element bij sluiten. Optioneel wordt de
 * hoofd-inhoud (#main) `inert` + aria-hidden gemaakt zodat een screenreader-
 * cursor niet door de achtergrond loopt — ALLEEN voor modals die BUITEN #main
 * renderen (portal naar body of een sibling van #main); een modal die zelf in
 * #main zit mag inertMain niet gebruiken (dan wordt hij zelf inert).
 */
export function useModalA11y(
  ref: RefObject<HTMLElement | null>,
  { onClose, active, inertMain = false }: { onClose: () => void; active: boolean; inertMain?: boolean },
) {
  // onClose via ref → het effect blijft stabiel op [active], herfocust dus niet
  // bij elke re-render van de ouder.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    (focusables()[0] ?? node)?.focus?.();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const main = inertMain ? document.getElementById("main") : null;
    if (main) {
      main.setAttribute("inert", "");
      main.setAttribute("aria-hidden", "true");
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
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
      if (main) {
        main.removeAttribute("inert");
        main.removeAttribute("aria-hidden");
      }
      prevFocus?.focus?.();
    };
  }, [active, inertMain, ref]);
}
