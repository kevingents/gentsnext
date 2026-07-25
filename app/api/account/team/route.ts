import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customers } from "@/db/schema";
import { requirePermission, isRoleKey, isAssignableRoleKey, rolesOf, type RoleKey } from "@/lib/permissions";

export const dynamic = "force-dynamic";

/**
 * Rollen toekennen aan medewerkers. Alleen met het recht "team" (in de praktijk:
 * beheerders). De beheerdersvlag `isAdmin` zelf is hier bewust NIET te zetten —
 * die staat alleen in de database, zodat niemand zichzelf of de laatste
 * beheerder via het scherm kan buitensluiten of promoveren.
 *
 * POST { email, roles: string[] }  → rollen vervangen (lege lijst = toegang intrekken)
 */
export async function POST(req: Request) {
  const actor = await requirePermission("team");
  if (!actor) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let body: { email?: unknown; roles?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!email || !/.+@.+\..+/.test(email)) {
    return NextResponse.json({ ok: false, error: "Vul een geldig e-mailadres in." }, { status: 400 });
  }

  const raw = Array.isArray(body?.roles) ? body.roles.map(String) : [];
  const onbekend = raw.filter((r) => !isRoleKey(r));
  if (onbekend.length) {
    return NextResponse.json({ ok: false, error: `Onbekende rol: ${onbekend.join(", ")}` }, { status: 400 });
  }
  // De bundel "beheerder" bevat álle rechten, inclusief het uitdelen van rollen.
  // Die via dit scherm kunnen toekennen zou betekenen dat iedereen met "team"
  // onbeperkt beheerders kan maken — precies wat de databasevlag moet voorkomen.
  // De controle staat hier op de server: het scherm toont de knop niet, maar dit
  // verzoek is ook rechtstreeks te versturen.
  const nietToekenbaar = raw.filter((r) => isRoleKey(r) && !isAssignableRoleKey(r));
  if (nietToekenbaar.length) {
    return NextResponse.json(
      { ok: false, error: "Beheerderstoegang ken je niet via dit scherm toe; die zet je in de database." },
      { status: 403 },
    );
  }
  const roles = [...new Set(raw.filter(isAssignableRoleKey))] as RoleKey[];

  const db = getDb();
  const [target] = await db
    .select({ id: customers.id, email: customers.email, isAdmin: customers.isAdmin, preferences: customers.preferences })
    .from(customers)
    .where(sql`lower(${customers.email}) = ${email}`)
    .limit(1);

  if (!target) {
    // Bewust geen account aanmaken: een medewerker logt zelf één keer in met een
    // inloglink, daarna kun je hier rollen toekennen. Zo bestaat er nooit een
    // account met rechten waar niemand de mailbox van beheert.
    return NextResponse.json(
      { ok: false, error: "Geen account met dit e-mailadres. Laat de medewerker eerst één keer inloggen op de site." },
      { status: 404 },
    );
  }

  // Jezelf wijzig je hier niet. Iemand met de rol-variant van "team" zou anders
  // met één klik zijn eigen toegang kunnen intrekken en er niet meer in komen —
  // en er is geen scherm om dat terug te draaien. Beheerders (databasevlag)
  // kunnen 'm altijd weer helpen.
  if (target.id === actor.id) {
    return NextResponse.json(
      { ok: false, error: "Je eigen rollen wijzig je hier niet — vraag een andere beheerder." },
      { status: 400 },
    );
  }

  // Beheerders (databasevlag) staan boven dit scherm: hun toegang is niet via
  // rollen te beperken, dus die wijziging zou een valse belofte zijn.
  if (target.isAdmin) {
    return NextResponse.json(
      { ok: false, error: "Deze medewerker is beheerder; dat niveau wijzig je in de database." },
      { status: 400 },
    );
  }

  const prefs = (target.preferences ?? {}) as Record<string, unknown>;
  await db
    .update(customers)
    .set({ preferences: { ...prefs, roles }, updatedAt: sql`now()` })
    .where(eq(customers.id, target.id));

  return NextResponse.json({ ok: true, email: target.email, roles, vorige: rolesOf(target) });
}
