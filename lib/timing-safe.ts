import { timingSafeEqual } from "node:crypto";

/**
 * Constante-tijd string-vergelijking voor tokens/handtekeningen. Eén plek, want
 * dezelfde wrapper stond eerder near-identiek in orders/receipt-token/apple-wallet-
 * config/worldline/ticket-follow/newsletter/studio-token — en een security-vergelijker
 * hoort op één plek te wonen, zodat een wijziging (of fix) niet zeven kopieën moet raken.
 *
 * Fail-closed: false bij een leeg token/geheim of bij lengteverschil. De lengtecheck
 * gaat VÓÓR timingSafeEqual (die gooit bij ongelijke lengte), dus geen try/catch nodig.
 * De lengte lekt sowieso al via de string-lengte; de inhoud niet.
 */
export function tokenEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
