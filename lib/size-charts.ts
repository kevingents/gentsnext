import { getMigratedPage } from "@/lib/migrated-pages";

/** Per hoofdgroep een handle van de maattabel-pagina (gemigreerd of generieke fallback). */
const PREFERRED: Record<string, string> = {
  Pakken: "maattabel-pakken",
  Colberts: "maattabel-pakken",
  Broeken: "maattabel-pantalon",
  Overhemden: "maattabel-overhemden",
  Truien: "maattabel-truien",
  Gilets: "maattabel-gilets",
  Jassen: "maattabel-jassen",
  "Polo-shirts": "maattabel-poloshirts",
  Riemen: "maattabel-riemen",
  Schoenen: "maattabel-schoenen",
};

/**
 * Geeft een bestaande maattabel-handle terug voor deze hoofdgroep, of valt terug
 * op een algemene maattabel die in elk geval bestaat. Null als er niets is en
 * /maatadvies een betere CTA zou zijn.
 */
export function sizeChartFor(hoofdgroep: string): string | null {
  const preferred = PREFERRED[hoofdgroep];
  if (preferred && getMigratedPage(preferred)) return preferred;
  // Algemene maattabel (overhemden is het breedst gemigreerd) als fallback.
  if (getMigratedPage("maattabel-pakken")) return "maattabel-pakken";
  return null;
}
