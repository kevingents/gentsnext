/**
 * Losse stijlklassen voor het beheer (knoppen, invoervelden).
 *
 * Waarom een eigen bestandje: deze strings worden ook gebruikt door client
 * components (vertalingen-beheer, cadeaubon verzilveren). Sinds report-ui de
 * ingelogde medewerker opvraagt, trekt een import uit report-ui ook
 * `lib/account` (en dus `next/headers`) de clientbundel in — dat is geen
 * server component en Next weigert de build. Door alleen de klassen hierheen
 * te halen blijft de clientkant vrij van serverspul, terwijl report-ui ze
 * gewoon doorexporteert zodat bestaande imports blijven werken.
 */

export const fieldClass =
  "border border-pnavy-100 bg-white px-2.5 py-1.5 text-sm text-pnavy focus:border-pnavy-600 focus:outline-none";

export const btnPrimary =
  "inline-flex items-center justify-center rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream transition-colors hover:bg-pnavy-700";

export const btnSecondary =
  "inline-flex items-center justify-center rounded-lg border border-pnavy-100 bg-white px-4 py-2 text-sm font-medium text-pnavy transition-colors hover:bg-pnavy-50";
