import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { getSessionCustomer } from "@/lib/account";
import { BackofficeShell } from "@/components/account/report-ui";
import { TeamManager } from "@/components/account/team-manager";
import { ROLES, ASSIGNABLE_ROLES, can, rolesOf, permissionsOf, type RoleKey } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Team & rechten", robots: { index: false, follow: false } };

export default async function TeamPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "team")) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <p className="mt-3 font-sans text-ink-soft">Alleen een beheerder kan rollen toekennen.</p>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug</Link>
      </div>
    );
  }

  // Medewerkers = beheerders (databasevlag) + iedereen met een toegekende rol.
  const db = getDb();
  const rows = await db
    .select({
      id: customers.id,
      email: customers.email,
      firstName: customers.firstName,
      lastName: customers.lastName,
      isAdmin: customers.isAdmin,
      preferences: customers.preferences,
    })
    .from(customers)
    .where(sql`${customers.isAdmin} = true or (${customers.preferences} -> 'roles') is not null`)
    .orderBy(customers.email);

  const team = rows
    .map((r) => ({
      email: r.email,
      naam: [r.firstName, r.lastName].filter(Boolean).join(" "),
      isAdmin: r.isAdmin,
      roles: rolesOf(r) as RoleKey[],
      permissions: permissionsOf(r),
      isJij: r.id === customer.id,
    }))
    .filter((m) => m.isAdmin || m.roles.length);

  // Alleen de toekenbare rollen — "beheerder" hoort hier niet tussen te staan
  // (die zet je in de database). De server weigert 'm ook.
  const rolLijst = ASSIGNABLE_ROLES.map((key) => ({
    key: key as string,
    label: ROLES[key].label,
    omschrijving: ROLES[key].omschrijving,
    permissions: [...ROLES[key].permissions] as string[],
  }));

  return (
    <BackofficeShell active="/account/team" title="Team & rechten">
      <p className="font-sans text-sm text-pslate">
        Wie mag wat in deze studio. Een medewerker logt eerst zelf één keer in met een inloglink;
        daarna ken je hier een rol toe.
      </p>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-portal">
        <p className="text-xs uppercase tracking-wider text-pslate">De rollen</p>
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {rolLijst.map((r) => (
            <div key={r.key} className="rounded-lg border border-pnavy/10 p-3">
              <dt className="font-medium text-pnavy">{r.label}</dt>
              <dd className="mt-1 text-sm text-pslate">{r.omschrijving}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs text-pslate">
          Beheerders staan boven deze rollen: die toegang zetten we bewust alleen in de database,
          zodat de laatste beheerder zichzelf hier nooit kan buitensluiten.
        </p>
      </section>

      <TeamManager team={team} roles={rolLijst} />
    </BackofficeShell>
  );
}
