/**
 * Controle van het rechtenmodel — `npm run check:rechten`.
 *
 * Pure logica, geen database: draait overal en in een seconde. Dit is
 * autorisatiecode, dus een stille regressie (een rol die ineens meer mag, of
 * rommel in de voorkeuren die tóch een rol oplevert) is duur. Draai dit na elke
 * wijziging aan lib/permissions.ts.
 */
import {
  PERMISSIONS,
  ROLES,
  ASSIGNABLE_ROLES,
  isRoleKey,
  isAssignableRoleKey,
  rolesOf,
  permissionsOf,
  can,
  isStaff,
  permissionForRoute,
  firstAllowedRoute,
  ROUTE_PERMISSION,
  type Permission,
} from "../lib/permissions";

let fouten = 0;
function check(naam: string, waar: boolean) {
  if (!waar) {
    fouten++;
    console.log("  FOUT:", naam);
  }
}

const klant = { isAdmin: false, preferences: {} };
const beheerder = { isAdmin: true, preferences: {} };
const redacteur = { isAdmin: false, preferences: { roles: ["redacteur"] } };
const analist = { isAdmin: false, preferences: { roles: ["analist"] } };
const operatie = { isAdmin: false, preferences: { roles: ["operatie"] } };
const gestapeld = { isAdmin: false, preferences: { roles: ["redacteur", "analist"] } };

console.log("— fail-closed —");
check("null krijgt niets", PERMISSIONS.every((p) => !can(null, p)));
check("gewone klant krijgt niets", PERMISSIONS.every((p) => !can(klant, p)));
check("gewone klant is geen medewerker", !isStaff(klant));
check("beheerder krijgt alles", PERMISSIONS.every((p) => can(beheerder, p)));

console.log("— rommel in preferences geeft geen rechten —");
for (const rommel of [
  { roles: "beheerder" },
  { roles: { beheerder: true } },
  { roles: [{ toString: () => "beheerder" }] },
  { roles: ["constructor"] },
  { roles: ["__proto__"] },
  { roles: ["toString"] },
  { roles: ["hasOwnProperty"] },
  { roles: null },
  { roles: [] },
  {},
  // Zelfs een letterlijke "beheerder" in de voorkeuren mag niets geven:
  // dat niveau komt alleen uit de kolom is_admin.
  { roles: ["beheerder"] },
]) {
  const c = { isAdmin: false, preferences: rommel };
  check(`rommel ${JSON.stringify(rommel)} geeft geen rechten`, permissionsOf(c).length === 0 && !isStaff(c));
}
check("roles als string 'beheerder' telt niet", rolesOf({ isAdmin: false, preferences: { roles: "beheerder" } }).length === 0);
{
  // Een lijst met beheerder erin: die rol wordt genegeerd, de rest telt gewoon.
  const gemengd = { isAdmin: false, preferences: { roles: ["beheerder", "analist"] } };
  check("beheerder uit voorkeuren genegeerd, analist blijft", permissionsOf(gemengd).join() === "meten");
  check("beheerder uit voorkeuren geeft geen team-recht", !can(gemengd, "team") && !can(gemengd, "instellingen"));
}

console.log("— rollen doen wat hun omschrijving zegt —");
check("redacteur: geen cijfers", !can(redacteur, "meten"));
check("redacteur: geen klantgegevens", !can(redacteur, "klanten"));
check("redacteur: geen instellingen", !can(redacteur, "instellingen"));
check("redacteur: wel content/vindbaarheid/presentatie", can(redacteur, "content") && can(redacteur, "vindbaarheid") && can(redacteur, "presentatie"));
check("analist: alleen meten", permissionsOf(analist).join() === "meten");
check("operatie: operatie + klanten, geen instellingen", can(operatie, "operatie") && can(operatie, "klanten") && !can(operatie, "instellingen"));
check("niemand behalve beheerder krijgt 'team'", [redacteur, analist, operatie, gestapeld].every((c) => !can(c, "team")));
check("rollen stapelen", can(gestapeld, "content") && can(gestapeld, "meten"));

console.log("— beheerder niet uitdeelbaar —");
check("beheerder niet in toekenbare rollen", !ASSIGNABLE_ROLES.includes("beheerder" as never));
check("isRoleKey('beheerder') is waar", isRoleKey("beheerder"));
check("isAssignableRoleKey('beheerder') is onwaar", !isAssignableRoleKey("beheerder"));
check("isAssignableRoleKey kent de rest wel", ["redacteur", "analist", "operatie"].every(isAssignableRoleKey));
check("prototype-sleutels zijn geen rol", !isRoleKey("constructor") && !isRoleKey("toString") && !isAssignableRoleKey("__proto__"));

console.log("— elke rol heeft een eerlijke omschrijving —");
for (const key of ASSIGNABLE_ROLES) {
  const o = ROLES[key].omschrijving.toLowerCase();
  const p = ROLES[key].permissions as readonly Permission[];
  if (p.includes("meten")) check(`${key} noemt cijfers`, /cijfer|statistiek|rapportage|omzet/.test(o));
  if (p.includes("klanten")) check(`${key} noemt klantgegevens`, /klant/.test(o));
  if (p.includes("instellingen")) check(`${key} noemt instellingen`, /instelling/.test(o));
  if (!p.includes("meten")) check(`${key} belooft geen cijfers`, !/wel cijfers/.test(o));
}

console.log("— routes —");
check("onbekend pad valt terug op team", permissionForRoute("/account/onbekend") === "team");
check("onbekend pad met querystring ook", permissionForRoute("/account/klanten?q=jan") === "team");
check("elke menuroute heeft een recht", Object.values(ROUTE_PERMISSION).every((p) => (PERMISSIONS as readonly string[]).includes(p)));
check("klant heeft geen startpagina", firstAllowedRoute(klant) === null);
check("redacteur landt op content", firstAllowedRoute(redacteur) === "/account/paginas");
check("analist landt op statistieken", firstAllowedRoute(analist) === "/account/statistieken");
check("operatie landt op bestellingen", firstAllowedRoute(operatie) === "/account/orders");
check("beheerder landt op statistieken", firstAllowedRoute(beheerder) === "/account/statistieken");

console.log("");
console.log(fouten ? `${fouten} FOUT(EN)` : "alle controles goed");
process.exit(fouten ? 1 : 0);
