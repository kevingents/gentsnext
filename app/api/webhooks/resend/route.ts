import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { mailGebeurtenissen } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/webhooks/resend — wat er met onze eigen mails gebeurt.
 *
 * Hiermee weten we eindelijk of een flowmail geopend en aangeklikt wordt. De
 * cijfers die we hádden komen uit de Spotler-export: per e-mailadres opgeteld
 * en historisch, dus ze zeggen niets over de mail van gisteren.
 *
 * ── Waarom de handtekening geen formaliteit is ───────────────────────────
 * Dit endpoint moet publiek bereikbaar zijn, en wat erin komt gaat rechtstreeks
 * de rapportage in. Zonder controle kan iedereen die de URL kent duizend
 * "geopend"-meldingen sturen en zo een flow er goed uit laten zien. Dan is de
 * meting erger dan geen meting: je nam er besluiten op.
 *
 * Resend tekent via Svix: HMAC-SHA256 over `id.timestamp.body`, met de sleutel
 * na het `whsec_`-voorvoegsel als base64. De header kan MEERDERE handtekeningen
 * bevatten (tijdens sleutelrotatie) — één ervan moet kloppen.
 *
 * Geen sleutel ingesteld = we weigeren alles. Stilletjes accepteren zou precies
 * het gat opleveren dat we hier dichten.
 */

/** Resend-namen → onze namen. Wat er niet in staat slaan we niet op. */
const SOORTEN: Record<string, string> = {
  "email.delivered": "bezorgd",
  "email.opened": "geopend",
  "email.clicked": "geklikt",
  "email.bounced": "gebounced",
  "email.complained": "spam",
  "email.failed": "mislukt",
};

const TOLERANTIE_SECONDEN = 5 * 60;

export async function POST(req: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET || "";
  if (!secret) {
    console.warn("[resend-webhook] RESEND_WEBHOOK_SECRET ontbreekt — geweigerd.");
    return NextResponse.json({ ok: false, error: "Niet geconfigureerd." }, { status: 503 });
  }

  const id = req.headers.get("svix-id") || "";
  const timestamp = req.headers.get("svix-timestamp") || "";
  const handtekeningen = req.headers.get("svix-signature") || "";
  if (!id || !timestamp || !handtekeningen) {
    return NextResponse.json({ ok: false, error: "Geen handtekening." }, { status: 401 });
  }

  /* Een oude melding opnieuw afspelen mag niet werken, ook niet met een geldige
     handtekening: dan kan iemand die ooit één echte melding onderschepte hem
     eindeloos herhalen. */
  const leeftijd = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(leeftijd) || leeftijd > TOLERANTIE_SECONDEN) {
    return NextResponse.json({ ok: false, error: "Melding te oud." }, { status: 401 });
  }

  const body = await req.text();
  const sleutel = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const verwacht = createHmac("sha256", sleutel).update(`${id}.${timestamp}.${body}`).digest();

  // "v1,<base64> v1,<base64>" — tijdens sleutelrotatie staan er meerdere in.
  const geldig = handtekeningen.split(" ").some((deel) => {
    const [versie, waarde] = deel.split(",");
    if (versie !== "v1" || !waarde) return false;
    const gegeven = Buffer.from(waarde, "base64");
    return gegeven.length === verwacht.length && timingSafeEqual(gegeven, verwacht);
  });
  if (!geldig) return NextResponse.json({ ok: false, error: "Handtekening klopt niet." }, { status: 401 });

  let melding: { type?: string; created_at?: string; data?: Record<string, unknown> };
  try {
    melding = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  const soort = SOORTEN[String(melding.type || "")];
  // Onbekende soort: netjes 200 terug, anders blijft Svix het uren opnieuw
  // proberen voor iets wat we bewust niet bewaren.
  if (!soort) return NextResponse.json({ ok: true, genegeerd: melding.type ?? "" });

  const data = (melding.data ?? {}) as Record<string, unknown>;
  const tags = (data.tags ?? {}) as Record<string, string>;
  /* De labels die we bij het versturen meestuurden. Resend geeft ze terug als
     object; ouder formaat is een lijst {name, value}. Allebei aankunnen. */
  const label = (naam: string): string => {
    if (Array.isArray(data.tags)) {
      const t = (data.tags as { name?: string; value?: string }[]).find((x) => x?.name === naam);
      return String(t?.value ?? "");
    }
    return String(tags[naam] ?? "");
  };

  const stapTekst = label("flow_stap");
  const stap = stapTekst === "" ? null : Number(stapTekst);
  const uuidOfNull = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : null);

  const db = getDb();
  await db
    .insert(mailGebeurtenissen)
    .values({
      webhookId: id,
      berichtId: String(data.email_id ?? ""),
      soort,
      lidId: uuidOfNull(label("flow_lid")),
      flowId: uuidOfNull(label("flow")),
      stap: Number.isFinite(stap) ? stap : null,
      customerId: uuidOfNull(label("klant")),
      email: Array.isArray(data.to) ? String(data.to[0] ?? "") : String(data.to ?? ""),
      url: String((data.click as { link?: string } | undefined)?.link ?? ""),
      gebeurdOp: melding.created_at ? new Date(melding.created_at) : new Date(),
    })
    // Al binnengekomen: Svix probeert opnieuw als hij geen 2xx kreeg, en dan
    // zou dezelfde opening dubbel tellen.
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}
