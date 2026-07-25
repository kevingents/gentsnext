import Link from "next/link";
import { ROLES, ASSIGNABLE_ROLES, type Permission } from "@/lib/permissions";

/**
 * "Geen toegang" voor een beheerpagina.
 *
 * Vroeger stond op elke pagina "Deze pagina is alleen voor beheerders." Dat
 * klopt niet meer zodra er rollen zijn: iemand kán medewerker zijn en tóch
 * hier stranden. Daarom benoemen we welk werkgebied nodig is en welke rol dat
 * geeft — dan weet de collega precies wat hij moet vragen, en de beheerder
 * weet precies wat hij moet toekennen.
 */

/** Werkgebied zoals een collega het noemt (zelfde taal als het menu). */
const WERKGEBIED: Record<Permission, string> = {
  meten: "Meten & cijfers",
  content: "Content",
  vindbaarheid: "Vindbaarheid",
  presentatie: "Presentatie",
  operatie: "Operatie",
  klanten: "Klantgegevens",
  instellingen: "Instellingen",
  team: "Team & rechten",
};

/**
 * Welke toekenbare rollen dit recht geven. Beheerder valt hier bewust buiten:
 * die vlag staat alleen in de database, dus "vraag om de rol Beheerder" zou
 * een dood advies zijn.
 */
function rollenMetRecht(permission: Permission): string[] {
  return ASSIGNABLE_ROLES.filter((key) => (ROLES[key].permissions as readonly Permission[]).includes(permission)).map(
    (key) => ROLES[key].label,
  );
}

/** "Redacteur", "Redacteur of Analist", "Redacteur, Analist of Operatie". */
function opsomming(namen: string[]): string {
  if (namen.length <= 1) return namen[0] ?? "";
  return `${namen.slice(0, -1).join(", ")} of ${namen[namen.length - 1]}`;
}

export function GeenToegang({ permission }: { permission: Permission }) {
  const rollen = rollenMetRecht(permission);
  const advies = rollen.length
    ? `Vraag een beheerder om de rol ${opsomming(rollen)}.`
    : "Alleen een beheerder kan hierbij.";

  return (
    <div className="mx-auto max-w-page px-gutter py-16">
      <h1 className="text-display-md">Geen toegang</h1>
      <p className="mt-3 font-sans text-ink-soft">
        Je hebt geen toegang tot {WERKGEBIED[permission]}. {advies}
      </p>
      <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug naar mijn account</Link>
    </div>
  );
}
