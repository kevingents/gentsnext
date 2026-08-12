import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { newsletterSubscribers } from "@/db/schema";
import { verifyNewsletterToken, pushEmailToResendAudience } from "@/lib/newsletter";
import { recordEvents } from "@/lib/analytics";
import { klantVoorIdentiteit } from "@/lib/identity";
import { ververProfiel } from "@/lib/customer-360";
import { getSiteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/** Double-opt-in-bevestiging: maakt de inschrijving definitief en gaat naar Resend. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  const token = url.searchParams.get("token") || "";
  const site = getSiteUrl();

  if (!email || !verifyNewsletterToken(email, token)) {
    return Response.redirect(`${site}/nieuwsbrief/bevestigd?status=ongeldig`, 302);
  }

  const db = getDb();
  const rows = await db
    .select({ id: newsletterSubscribers.id })
    .from(newsletterSubscribers)
    .where(and(eq(newsletterSubscribers.channel, "email"), eq(newsletterSubscribers.email, email)))
    .limit(1);

  if (rows.length) {
    await db.update(newsletterSubscribers).set({ status: "subscribed", updatedAt: sql`now()` }).where(eq(newsletterSubscribers.id, rows[0].id));
  } else {
    // Token klopt maar geen rij (bv. opgeruimd) → alsnog inschrijven.
    await db.insert(newsletterSubscribers).values({ channel: "email", email, source: "site", status: "subscribed" });
  }
  await pushEmailToResendAudience(email);

  // Pas de BEVESTIGING telt als inschrijving, niet het invullen van het
  // formulier — anders meet je een lijst die je niet mag mailen. Server-side
  // gelogd: dit is eigen administratie van een gegeven toestemming, en het
  // gebeurt op een redirect-pagina waar geen tracker draait.
  recordEvents([
    { sessionId: "server", type: "nieuwsbrief", path: "/api/newsletter/confirm", bron: "server", props: { kanaal: "email" } },
  ]).catch(() => {});
  // De toestemming verandert in welke doelgroepen deze klant valt — meteen
  // doorrekenen in plaats van tot vannacht wachten.
  klantVoorIdentiteit("email", email)
    .then((id) => (id ? ververProfiel(id) : undefined))
    .catch(() => {});

  return Response.redirect(`${site}/nieuwsbrief/bevestigd`, 302);
}
