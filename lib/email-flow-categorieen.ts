/**
 * Categorieën voor flows — op DOEL, niet op onderwerp.
 *
 * "Winkelwagen", "Retour", "Verjaardag" zijn onderwerpen. Die groeien mee met
 * elk nieuw idee en leveren over een jaar vijftien categorieën met één flow —
 * dan heb je een tweede lijst in plaats van een indeling.
 *
 * Op doel blijven het er vijf, en het dwingt de vraag die telt: wát moet deze
 * flow bereiken? Een flow zonder antwoord op die vraag hoort er niet te zijn.
 */
export const FLOW_CATEGORIEEN = [
  {
    key: "conversie",
    label: "Conversie",
    uitleg: "Iemand is al bijna klant. Winkelwagen, bekeken product, afgebroken checkout.",
  },
  {
    key: "binding",
    label: "Binding",
    uitleg: "Van eerste naar tweede aankoop, en van tweede naar gewoonte. Het scharnierpunt van elke klantrelatie.",
  },
  {
    key: "terugwinnen",
    label: "Terugwinnen",
    uitleg: "Was klant, is weg. Hoe langer geleden, hoe lager de kans — en op een gegeven moment stop je.",
  },
  {
    key: "data",
    label: "Gegevens ophalen",
    uitleg: "Maten, voorkeuren, verjaardag. Levert geen directe omzet maar maakt al het andere beter — en drukt de retouren.",
  },
  {
    key: "service",
    label: "Service",
    uitleg: "Geen verkoop: een felicitatie, een herinnering aan tegoed, een bericht dat iets klaarligt.",
  },
  { key: "overig", label: "Overig", uitleg: "Nog niet ingedeeld." },
] as const;

export type FlowCategorie = (typeof FLOW_CATEGORIEEN)[number]["key"];
