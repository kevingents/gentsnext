/**
 * De rekenkant van "Smoking compleet" — bewust LOS van lib/smoking-pakket.ts.
 *
 * Dat bestand praat met de database en de portal; dit bestand raakt alleen
 * getallen. De scheiding is niet cosmetisch: dit is de code die geld van de
 * bon haalt, en die wil je kunnen testen zonder Neon, zonder fetch en zonder
 * de path-aliassen van Next. Zelfde afweging als lib/student-korting.ts.
 */

export const SMOKING_ROLES = ["jas", "broek", "overhemd", "strik"] as const;
export type SmokingRole = (typeof SMOKING_ROLES)[number];

export const SMOKING_ROLE_LABEL: Record<SmokingRole, string> = {
  jas: "Smokingjas",
  broek: "Pantalon",
  overhemd: "Overhemd",
  strik: "Strik",
};

/** Alle regels van één samengestelde smoking delen dit voorvoegsel in hun groupId. */
export const SMOKING_GROUP_PREFIX = "smoking:";

/** groupId opbouwen: het niveau moet erin, want dat bepaalt de pakketprijs. */
export function smokingGroupId(niveauId: string, uniek: string): string {
  return `${SMOKING_GROUP_PREFIX}${niveauId}:${uniek}`;
}

/** Niveau terugleiden uit een groupId. Lege string = geen smoking-groep. */
export function niveauUitGroupId(groupId: string | null | undefined): string {
  const g = String(groupId ?? "");
  if (!g.startsWith(SMOKING_GROUP_PREFIX)) return "";
  return g.slice(SMOKING_GROUP_PREFIX.length).split(":")[0] ?? "";
}

export type SmokingKortingRegel = {
  groupId?: string | null;
  roleLabel?: string | null;
  priceCents: number;
  quantity: number;
};

/**
 * Vaste pakketprijs verrekenen op een winkelmand.
 *
 * Server-side aangeroepen bij het afrekenen (lib/orders.ts), nooit alleen in de
 * weergave — anders ziet de klant een prijs die de order niet kent.
 *
 * De korting geldt alleen als de vier kernonderdelen met dezelfde groupId
 * compleet in de mand liggen. Haalt de klant er één weg, dan valt de korting
 * vanzelf weg en betaalt hij de losse prijzen. Extra's (sjaal, schoenen) tellen
 * niet mee: die gaan tegen hun eigen prijs, zodat de pakketprijs een harde
 * belofte blijft en de extra's niet feitelijk gratis worden.
 *
 * @param regels           winkelmandregels
 * @param pakketPrijsCents (niveauId) => vaste prijs in centen, of null als het
 *                         niveau niet (meer) bestaat
 */
export function smokingPakketKorting(
  regels: SmokingKortingRegel[],
  pakketPrijsCents: (niveauId: string) => number | null
): number {
  const groepen = new Map<string, { rollen: Map<string, number>; niveau: string }>();

  for (const regel of regels) {
    const niveau = niveauUitGroupId(regel.groupId);
    if (!niveau) continue;
    const rol = String(regel.roleLabel ?? "").toLowerCase();
    if (!(SMOKING_ROLES as readonly string[]).includes(rol)) continue; // extra's tellen niet mee

    const gid = String(regel.groupId);
    const groep = groepen.get(gid) ?? { rollen: new Map<string, number>(), niveau };
    /* Twee dezelfde rollen in één groep kan niet legitiem ontstaan; we nemen de
       goedkoopste, zodat een gemanipuleerde mand nooit méér korting oplevert. */
    const bestaand = groep.rollen.get(rol);
    groep.rollen.set(rol, bestaand == null ? regel.priceCents : Math.min(bestaand, regel.priceCents));
    groepen.set(gid, groep);
  }

  let korting = 0;
  for (const groep of groepen.values()) {
    if (groep.rollen.size !== SMOKING_ROLES.length) continue; // onvolledig → geen korting
    const pakket = pakketPrijsCents(groep.niveau);
    if (pakket == null || pakket <= 0) continue;
    const som = [...groep.rollen.values()].reduce((a, b) => a + b, 0);
    /* Ligt de losse som al onder de pakketprijs (afgeprijsd onderdeel), dan
       betaalt de klant gewoon die lagere som — nooit een negatieve korting. */
    korting += Math.max(0, som - pakket);
  }
  return korting;
}
