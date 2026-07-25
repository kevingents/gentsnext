"use client";

import Link from "next/link";
import type { ComponentProps, MouseEvent } from "react";
import { track } from "@/lib/track-client";

type Props = ComponentProps<typeof Link> & {
  /** Event-type; standaard nav_click (menu/footer/tegels). */
  event?: string;
  /** Extra eigenschappen bij het event — nooit persoonsgegevens. */
  trackProps?: Record<string, unknown>;
};

/**
 * <Link> die bij een klik één event vuurt. Bestaat omdat de plekken die we
 * willen meten (footer, home-tegels) server components zijn: die kunnen zelf
 * geen onClick dragen. Fire-and-forget — track() zet het event alleen in de
 * queue en doet nooit await, dus de navigatie wacht nergens op.
 */
export function TrackLink({ event = "nav_click", trackProps, onClick, ...rest }: Props) {
  function handle(e: MouseEvent<HTMLAnchorElement>) {
    // href meesturen als stabiele sleutel: labels zijn vertaald (ns "nav"), dus
    // hetzelfde menu-item heet op /en anders dan op /.
    track(event, { props: { href: typeof rest.href === "string" ? rest.href : "", ...trackProps } });
    onClick?.(e);
  }
  return <Link {...rest} onClick={handle} />;
}
