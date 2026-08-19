"use client";

import NextLink from "next/link";
import type { ComponentProps } from "react";
import { useLocale } from "@/components/i18n/locale-provider";
import { lokaliseerHref } from "@/lib/url-i18n-regels";

/**
 * Vervanger voor next/link die de href in de huidige taal zet.
 *
 * WAAROM DIT BESTAAT: op /en/category/suits stonden 86 interne links zónder
 * /en-prefix. Bezoekers merkten dat niet — de locale-cookie hield de taal vast —
 * maar Googlebot heeft geen cookie en volgt links. Die stapte dus bij de eerste
 * klik terug de Nederlandse boom in, waardoor de complete anderstalige site één
 * niveau diep was en de rest onvindbaar. Alleen de sitemap wees er nog naar.
 *
 * Bewust een client component: next/link is dat zelf ook, dus dit kost
 * praktisch geen extra JavaScript, en zo werkt dezelfde import in server- én
 * client-componenten. De locale komt uit LocaleProvider (shop-layout); ontbreekt
 * die, dan valt useLocale terug op nl en verandert er niets — precies het
 * gedrag van vóór deze wijziging.
 *
 * De regel zelf staat in lib/url-i18n-regels.js zodat `node --test` 'm dekt.
 */
export function Link({ href, ...rest }: ComponentProps<typeof NextLink>) {
  const locale = useLocale();
  return <NextLink href={lokaliseerHref(href, locale)} {...rest} />;
}

export default Link;
