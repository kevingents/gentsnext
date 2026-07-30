import { getSessionCustomer } from "@/lib/account";

/**
 * Rechtenmodel voor de Site-studio.
 *
 * Tot nu toe kende de webshop maar één schakelaar: `isAdmin` ja of nee. Wie 'm
 * had, kon álles — omzetcijfers, klantgegevens, instellingen, de hele
 * catalogus. Dat is te grof zodra meer mensen meewerken: een stylist die looks
 * bijwerkt hoeft geen klantadressen te zien, en een marketeer die de SEO doet
 * hoeft niet bij de betaalinstellingen te kunnen.
 *
 * Opzet: rechten per WERKGEBIED, rollen als bundel van rechten. Een medewerker
 * krijgt één of meer rollen; `isAdmin` blijft bestaan als hoogste niveau
 * (alles + rollen uitdelen) en is bewust alleen in de database te zetten —
 * zo kan de laatste beheerder zichzelf nooit buitensluiten.
 *
 * Opslag in `customers.preferences.roles` (jsonb dat er al was) — geen
 * migratie nodig, dus dit kan direct live zonder databasewerk op productie.
 */

/** Werkgebieden waarop toegang wordt verleend. */
export const PERMISSIONS = [
  "meten", // statistieken, gedrag, rapportages
  "content", // pagina's, looks, stijlgids, gelegenheden, menu
  "vindbaarheid", // SEO, vertalingen, redirects
  "presentatie", // uitgelicht, productmedia, reviews
  "operatie", // bestellingen, retouren, cadeaubonnen, fulfilment
  "klanten", // klantgegevens (privacygevoelig)
  "instellingen", // tarieven, cutoffs, drempels, integraties
  "team", // rollen uitdelen — alleen beheerders
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/**
 * Rollen: een begrijpelijke bundel rechten, niet los aan te vinken.
 *
 * De omschrijving is bindend voor de gebruiker: hij staat op /account/team en is
 * waar een beheerder zijn keuze op baseert. Voeg dus nooit een recht aan een
 * bundel toe zonder de omschrijving mee te veranderen — een rol die stiekem méér
 * mag dan zijn tekst belooft is erger dan geen rollen hebben.
 *
 * Rollen stapelen: wie content maakt én cijfers nodig heeft krijgt Redacteur +
 * Analist. Daarom houden we de bundels smal in plaats van "voor de zekerheid"
 * ruim.
 */
export const ROLES = {
  beheerder: {
    label: "Beheerder",
    omschrijving: "Volledige toegang, inclusief rollen uitdelen en instellingen.",
    permissions: [...PERMISSIONS],
  },
  redacteur: {
    label: "Redacteur",
    omschrijving:
      "Content, vindbaarheid en presentatie van de site: pagina's, looks, stijlgids, menu, SEO, vertalingen, uitgelicht, productmedia en reviews. Geen cijfers, klantgegevens of instellingen.",
    permissions: ["content", "vindbaarheid", "presentatie"],
  },
  analist: {
    label: "Analist",
    omschrijving: "Alleen meekijken: statistieken, gedrag en rapportages — inclusief omzetcijfers.",
    permissions: ["meten"],
  },
  operatie: {
    label: "Operatie",
    omschrijving:
      "Bestellingen, fulfilment en cadeaubonnen afhandelen. Geeft daarnaast toegang tot het volledige klantenoverzicht, inclusief CSV-export.",
    permissions: ["operatie", "klanten"],
  },
} as const satisfies Record<string, { label: string; omschrijving: string; permissions: readonly Permission[] }>;

export type RoleKey = keyof typeof ROLES;

export function isRoleKey(v: string): v is RoleKey {
  return Object.prototype.hasOwnProperty.call(ROLES, v);
}

/**
 * Rollen die via het scherm toe te kennen zijn. "beheerder" hoort daar bewust
 * NIET bij: die bundel bevat alle rechten inclusief het uitdelen van rollen, en
 * zou dus iedereen met "team" de macht geven om onbeperkt beheerders te maken.
 * Beheerderstoegang blijft de databasevlag `isAdmin` — één plek, bewust
 * onbereikbaar vanaf het web.
 */
export const ASSIGNABLE_ROLES = (Object.keys(ROLES) as RoleKey[]).filter((k) => k !== "beheerder");

export function isAssignableRoleKey(v: string): v is RoleKey {
  return (ASSIGNABLE_ROLES as string[]).includes(v);
}

/** Vorm van wat getSessionCustomer teruggeeft — bewust smal gehouden. */
type StaffLike = {
  isAdmin?: boolean | null;
  preferences?: unknown;
} | null;

/**
 * De rollen van deze medewerker (leeg = geen enkele rol toegekend).
 *
 * Twee bewuste strengheden, omdat dit jsonb is en dus letterlijk alles kan
 * bevatten:
 * 1. Alleen échte strings tellen. Géén String(x): een object met een eigen
 *    toString ({toString:()=>"beheerder"}) zou daarmee een geldige rol worden.
 * 2. Alleen toekenbare rollen tellen. "beheerder" uit de voorkeuren wordt
 *    genegeerd — beheerderstoegang komt uitsluitend uit de kolom `is_admin`,
 *    zodat er precies één plek is waar dat niveau vandaan kan komen.
 */
export function rolesOf(customer: StaffLike): RoleKey[] {
  const prefs = (customer?.preferences ?? {}) as { roles?: unknown };
  const raw = Array.isArray(prefs.roles) ? prefs.roles : [];
  return raw.filter((r): r is string => typeof r === "string").filter(isAssignableRoleKey);
}

/** Alle rechten die iemand heeft (beheerdersvlag geeft alles). */
export function permissionsOf(customer: StaffLike): Permission[] {
  if (customer?.isAdmin) return [...PERMISSIONS];
  const set = new Set<Permission>();
  for (const role of rolesOf(customer)) {
    for (const p of ROLES[role].permissions) set.add(p);
  }
  return [...set];
}

/** Mag deze medewerker dit werkgebied in? */
export function can(customer: StaffLike, permission: Permission): boolean {
  if (customer?.isAdmin) return true;
  return permissionsOf(customer).includes(permission);
}

/** Heeft deze persoon überhaupt toegang tot het beheer? */
export function isStaff(customer: StaffLike): boolean {
  return Boolean(customer?.isAdmin) || rolesOf(customer).length > 0;
}

/**
 * Toegangscontrole voor een beheerpagina of -route. Geeft de medewerker terug
 * als die het recht heeft, anders null — de aanroeper beslist wat er dan
 * gebeurt (pagina toont "geen toegang", route geeft 403).
 *
 * Bewust GEEN try/catch: getSessionCustomer geeft netjes null terug als er geen
 * geldige sessie is, dus het enige dat hier nog kan opgooien is een echte
 * storing (database plat). Die hoort een 500 te worden, geen "geen toegang" —
 * anders zoekt iemand een uur naar een rechtenprobleem dat er niet is. Nog steeds
 * fail-closed: een fout geeft nooit toegang.
 */
export async function requirePermission(permission: Permission) {
  const customer = await getSessionCustomer();
  if (!customer) return null;
  return can(customer, permission) ? customer : null;
}

/** Menu-onderdeel → benodigd recht. Eén plek, zodat sidebar en pagina niet uiteen kunnen lopen. */
export const ROUTE_PERMISSION: Record<string, Permission> = {
  "/account/statistieken": "meten",
  "/account/analytics": "meten",
  "/account/rapportages": "meten",
  "/account/paginas": "content",
  "/account/looks": "content",
  "/account/blog": "content",
  "/account/gelegenheden": "content",
  "/account/menu": "content",
  "/account/seo": "vindbaarheid",
  "/account/vertalingen": "vindbaarheid",
  "/account/redirects": "vindbaarheid",
  "/account/merchandising": "presentatie",
  "/account/productmedia": "presentatie",
  "/account/beeldstatus": "presentatie",
  "/account/reviews": "presentatie",
  "/account/orders": "operatie",
  "/account/fulfilment": "operatie",
  "/account/cadeaubonnen": "operatie",
  "/account/klanten": "klanten",
  "/account/instellingen": "instellingen",
  "/account/team": "team",
};

/** Het recht dat bij een beheerpad hoort (onbekend pad → hoogste drempel). */
export function permissionForRoute(path: string): Permission {
  return ROUTE_PERMISSION[path] ?? "team";
}

/**
 * De eerste studiopagina waar deze medewerker in mag — het startpunt van de
 * snelkoppeling op /account. Zonder dit zou iemand met alleen de rol Redacteur
 * wél toegang hebben maar geen enkele ingang zien staan.
 */
export function firstAllowedRoute(customer: StaffLike): string | null {
  for (const [path, permission] of Object.entries(ROUTE_PERMISSION)) {
    if (can(customer, permission)) return path;
  }
  return null;
}
