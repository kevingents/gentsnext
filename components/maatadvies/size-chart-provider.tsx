"use client";

import { createContext, useContext } from "react";
import { builtInChart, type SizeChart } from "@/lib/size-chart";

/**
 * Geeft de ACTIEVE maattabel (de geüploade versie) aan de client components die
 * ermee rekenen: het maatadvies en de maattabel-overlay op de PDP.
 *
 * Waarom een provider en geen prop: de adviseur zit drie lagen diep achter een
 * knop in de buy-box en in de pak-samensteller. Die tussenlagen hebben niets met
 * maatvoering te maken en horen er ook niets van te weten.
 *
 * De shop-layout vult hem één keer per request. Die layout is toch al dynamisch
 * (getLocale leest headers/cookies), dus er is geen statisch gerenderde pagina
 * die met een ingevroren maattabel blijft rondlopen.
 */
const FALLBACK = builtInChart();

const Ctx = createContext<SizeChart | null>(null);

export function SizeChartProvider({ chart, children }: { chart?: SizeChart | null; children: React.ReactNode }) {
  return <Ctx.Provider value={chart ?? null}>{children}</Ctx.Provider>;
}

/**
 * De actieve maattabel, of de ingebakken tabel als er geen provider is (of nog
 * niets geüpload). Nooit null: een maatadvies dat "geen maat" zegt is voor een
 * klant onbruikbaar, en één vaste fallback-referentie houdt hem stabiel voor
 * memo-dependencies.
 */
export function useSizeChart(): SizeChart {
  return useContext(Ctx) ?? FALLBACK;
}
