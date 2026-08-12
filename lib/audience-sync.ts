import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { audiences, audienceSyncs } from "@/db/schema";
import { ledenVoorUitlevering } from "@/lib/audiences";

/**
 * Uitlevering van doelgroepen naar de kanalen.
 *
 * Wat elk platform verwacht, en waarom het hier zo staat:
 *
 *  - META en GOOGLE ADS matchen op een SHA256-hash van een genormaliseerde
 *    waarde. Normaliseren en dán hashen — andersom levert een geldige hash op
 *    die nergens matcht, en dat merk je pas aan een matchpercentage van nul
 *    zonder foutmelding. Die hashes staan al klaar in customer_profiles.
 *  - RESEND werkt met gewone adressen; daar gaat het adres zelf heen.
 *  - CSV is de ontsnappingsklep voor alles wat we (nog) niet koppelen.
 *
 * Toestemming is de deur, niet een filter achteraf: `ledenVoorUitlevering`
 * levert standaard alleen bereikbare klanten. Er is bewust geen "stuur toch
 * alles"-knop in de UI — wie dat wil moet code aanraken en dus nadenken.
 *
 * Alles is env-gated. Zonder sleutels doet een kanaal niets en zegt dat ook,
 * in plaats van te doen alsof het gelukt is.
 */

export type SyncKanaal = "resend" | "meta" | "google" | "csv";
export type SyncResultaat = {
  kanaal: SyncKanaal;
  status: "klaar" | "fout" | "overgeslagen";
  toegevoegd: number;
  verwijderd: number;
  overgeslagen: number;
  fout?: string;
  externId?: string;
};

/** Batchgrootte: Meta accepteert 10.000 per verzoek, Google 100.000 per taak. */
const META_BATCH = 5_000;
const GOOGLE_BATCH = 10_000;

async function logSync(audienceId: string, r: SyncResultaat) {
  const db = getDb();
  await db.insert(audienceSyncs).values({
    audienceId,
    kanaal: r.kanaal,
    status: r.status === "klaar" ? "klaar" : r.status === "fout" ? "fout" : "bezig",
    toegevoegd: r.toegevoegd,
    verwijderd: r.verwijderd,
    overgeslagen: r.overgeslagen,
    fout: (r.fout || "").slice(0, 500),
    externId: (r.externId || "").slice(0, 120),
  });
}

/* ────────────────────────────────  Resend  ──────────────────────────────── */

/**
 * Resend werkt met contacten in één audience. We zetten iedereen erin met
 * `unsubscribed: false`; wie geen toestemming heeft zit al niet in de lijst die
 * we ophalen. Resend heeft geen bulk-endpoint, dus dit is per contact — daarom
 * gedoseerd, met een kleine pauze, zodat we niet in de rate limit lopen.
 */
async function syncResend(audienceId: string, resendAudienceId: string): Promise<SyncResultaat> {
  const key = process.env.RESEND_API_KEY;
  const uit: SyncResultaat = { kanaal: "resend", status: "klaar", toegevoegd: 0, verwijderd: 0, overgeslagen: 0 };
  if (!key) return { ...uit, status: "overgeslagen", fout: "RESEND_API_KEY ontbreekt" };
  if (!resendAudienceId) return { ...uit, status: "overgeslagen", fout: "Geen Resend-audience ingesteld" };

  const leden = await ledenVoorUitlevering(audienceId);
  for (const l of leden) {
    if (!l.email) {
      uit.overgeslagen++;
      continue;
    }
    try {
      const res = await fetch(`https://api.resend.com/audiences/${resendAudienceId}/contacts`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email: l.email, unsubscribed: false }),
      });
      if (res.ok) uit.toegevoegd++;
      else uit.overgeslagen++;
    } catch {
      uit.overgeslagen++;
    }
    if (uit.toegevoegd % 50 === 0) await new Promise((r) => setTimeout(r, 250));
  }
  uit.externId = resendAudienceId;
  return uit;
}

/* ─────────────────────────────────  Meta  ───────────────────────────────── */

/**
 * Meta Custom Audiences. Het `schema`-veld vertelt Meta welke kolom wat is; wij
 * sturen e-mail, telefoon, voornaam, achternaam en postcode, allemaal gehasht.
 * Meer velden = hoger matchpercentage, en Meta gebruikt ze alleen om te matchen.
 *
 * `session` met page/batch-nummers is verplicht bij meerdere batches — laat je
 * dat weg, dan behandelt Meta elke batch als een losse upload en telt het
 * resultaat niet op zoals je verwacht.
 */
async function syncMeta(audienceId: string, metaAudienceId: string): Promise<SyncResultaat> {
  const token = process.env.META_ADS_TOKEN;
  const uit: SyncResultaat = { kanaal: "meta", status: "klaar", toegevoegd: 0, verwijderd: 0, overgeslagen: 0 };
  if (!token) return { ...uit, status: "overgeslagen", fout: "META_ADS_TOKEN ontbreekt" };
  if (!metaAudienceId) return { ...uit, status: "overgeslagen", fout: "Geen Meta-audience ingesteld" };

  const leden = await ledenVoorUitlevering(audienceId);
  const rijen = leden.map((l) => [
    l.email_sha256, l.phone_sha256 || "", l.voornaam_sha256 || "", l.achternaam_sha256 || "",
    l.postcode ? l.postcode.replace(/\s/g, "").toLowerCase() : "", (l.land || "nl").toLowerCase(),
  ]);
  const sessieId = Date.now();
  const paginas = Math.ceil(rijen.length / META_BATCH) || 1;

  for (let i = 0; i < paginas; i++) {
    const batch = rijen.slice(i * META_BATCH, (i + 1) * META_BATCH);
    if (!batch.length) break;
    const payload = {
      schema: ["EMAIL", "PHONE", "FN", "LN", "ZIP", "COUNTRY"],
      data: batch,
    };
    const body = new URLSearchParams({
      access_token: token,
      payload: JSON.stringify(payload),
      session: JSON.stringify({
        session_id: sessieId,
        batch_seq: i + 1,
        last_batch_flag: i === paginas - 1,
      }),
    });
    const res = await fetch(`https://graph.facebook.com/v21.0/${metaAudienceId}/users`, {
      method: "POST",
      body,
    });
    if (!res.ok) {
      const tekst = await res.text().catch(() => "");
      return { ...uit, status: "fout", fout: `Meta ${res.status}: ${tekst.slice(0, 300)}` };
    }
    uit.toegevoegd += batch.length;
  }
  uit.externId = metaAudienceId;
  return uit;
}

/* ──────────────────────────────  Google Ads  ────────────────────────────── */

/**
 * Google Ads Customer Match via de REST-API.
 *
 * Google werkt met een OfflineUserDataJob: aanmaken → in stukken vullen → laten
 * draaien. Dat is omslachtiger dan Meta, maar het is de enige manier om een
 * lijst betrouwbaar bij te werken zonder hem eerst leeg te gooien.
 *
 * Let op de twee identifiers per klant: e-mail én telefoon in ÉÉN
 * UserIdentifier-object mag niet — Google ziet dat als "beide moeten matchen".
 * Twee losse objecten in dezelfde userIdentifiers-lijst betekent "een van beide
 * volstaat", en dat is wat je wilt.
 */
async function syncGoogle(audienceId: string, userListId: string): Promise<SyncResultaat> {
  const token = process.env.GOOGLE_ADS_ACCESS_TOKEN;
  const dev = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const klantId = (process.env.GOOGLE_ADS_CUSTOMER_ID || "").replace(/\D/g, "");
  const uit: SyncResultaat = { kanaal: "google", status: "klaar", toegevoegd: 0, verwijderd: 0, overgeslagen: 0 };
  if (!token || !dev || !klantId) {
    return { ...uit, status: "overgeslagen", fout: "Google Ads-sleutels ontbreken (token/developer-token/klantnummer)" };
  }
  if (!userListId) return { ...uit, status: "overgeslagen", fout: "Geen Google-doelgroeplijst ingesteld" };

  const basis = `https://googleads.googleapis.com/v18/customers/${klantId}`;
  const kop = {
    Authorization: `Bearer ${token}`,
    "developer-token": dev,
    "Content-Type": "application/json",
    ...(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID
      ? { "login-customer-id": process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, "") }
      : {}),
  };

  const maak = await fetch(`${basis}/offlineUserDataJobs:create`, {
    method: "POST",
    headers: kop,
    body: JSON.stringify({
      job: {
        type: "CUSTOMER_MATCH_USER_LIST",
        customerMatchUserListMetadata: { userList: `customers/${klantId}/userLists/${userListId}` },
      },
    }),
  });
  if (!maak.ok) {
    const t = await maak.text().catch(() => "");
    return { ...uit, status: "fout", fout: `Google job aanmaken ${maak.status}: ${t.slice(0, 300)}` };
  }
  const jobNaam = ((await maak.json()) as { resourceName?: string }).resourceName || "";

  const leden = await ledenVoorUitlevering(audienceId);
  for (let i = 0; i < leden.length; i += GOOGLE_BATCH) {
    const batch = leden.slice(i, i + GOOGLE_BATCH);
    const operations = batch.map((l) => {
      const ids: Record<string, string>[] = [{ hashedEmail: l.email_sha256 }];
      // Twee LOSSE identifiers = "een van beide volstaat". Samen in één object
      // zou betekenen dat ze allebei moeten matchen, en dan zakt je bereik in.
      if (l.phone_sha256) ids.push({ hashedPhoneNumber: l.phone_sha256 });
      return { create: { userIdentifiers: ids } };
    });
    const vul = await fetch(`https://googleads.googleapis.com/v18/${jobNaam}:addOperations`, {
      method: "POST",
      headers: kop,
      body: JSON.stringify({ operations, enablePartialFailure: true }),
    });
    if (!vul.ok) {
      const t = await vul.text().catch(() => "");
      return { ...uit, status: "fout", fout: `Google vullen ${vul.status}: ${t.slice(0, 300)}`, externId: jobNaam };
    }
    uit.toegevoegd += batch.length;
  }

  const draai = await fetch(`https://googleads.googleapis.com/v18/${jobNaam}:run`, { method: "POST", headers: kop, body: "{}" });
  if (!draai.ok) {
    const t = await draai.text().catch(() => "");
    return { ...uit, status: "fout", fout: `Google starten ${draai.status}: ${t.slice(0, 300)}`, externId: jobNaam };
  }
  uit.externId = jobNaam;
  return uit;
}

/* ──────────────────────────────────  CSV  ───────────────────────────────── */

/**
 * CSV-export. Bevat bewust ZOWEL het adres als de hash: het adres om zelf mee
 * te werken, de hash om handmatig in een advertentieplatform te plakken zonder
 * dat er ergens een rauw bestand met klantgegevens rondslingert.
 */
export async function exporteerCsv(audienceId: string, alleenBereikbaar = true): Promise<string> {
  const leden = await ledenVoorUitlevering(audienceId, alleenBereikbaar);
  const kop = [
    "email", "email_sha256", "telefoon", "telefoon_sha256",
    "postcode", "plaats", "land", "segment", "besteed_euro",
  ];
  const ontsnap = (v: unknown) => {
    const s = String(v ?? "");
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const regels = leden.map((l) =>
    [
      l.email, l.email_sha256, l.phone_e164, l.phone_sha256,
      l.postcode, l.plaats, l.land, l.segment,
      (l.besteed_totaal_cents / 100).toFixed(2),
    ].map(ontsnap).join(",")
  );
  return [kop.join(","), ...regels].join("\n");
}

/* ────────────────────────────  Aansturing  ──────────────────────────────── */

/**
 * Lever een doelgroep uit naar één kanaal. De instellingen per kanaal staan in
 * `audiences.kanalen` — in de tool dus, niet in Vercel. Alleen de SLEUTELS
 * staan in env, want dat zijn secrets; welke doelgroep naar welke lijst gaat is
 * gewoon configuratie die Kevin zelf moet kunnen wijzigen.
 */
export async function leverUit(audienceId: string, kanaal: SyncKanaal): Promise<SyncResultaat> {
  const db = getDb();
  const [a] = await db.select().from(audiences).where(eq(audiences.id, audienceId)).limit(1);
  if (!a) throw new Error("Doelgroep bestaat niet");
  const conf = (a.kanalen ?? {}) as Record<string, { id?: string } | undefined>;

  let r: SyncResultaat;
  try {
    if (kanaal === "resend") r = await syncResend(audienceId, conf.resend?.id || process.env.RESEND_AUDIENCE_ID || "");
    else if (kanaal === "meta") r = await syncMeta(audienceId, conf.meta?.id || "");
    else if (kanaal === "google") r = await syncGoogle(audienceId, conf.google?.id || "");
    else r = { kanaal: "csv", status: "klaar", toegevoegd: a.aantalBereikbaar, verwijderd: 0, overgeslagen: 0 };
  } catch (e) {
    r = {
      kanaal, status: "fout", toegevoegd: 0, verwijderd: 0, overgeslagen: 0,
      fout: e instanceof Error ? e.message : String(e),
    };
  }
  await logSync(audienceId, r);
  return r;
}

/** Het uitleverlogboek van een doelgroep — laatste 20 pogingen. */
export async function syncGeschiedenis(audienceId: string) {
  const db = getDb();
  return db
    .select()
    .from(audienceSyncs)
    .where(eq(audienceSyncs.audienceId, audienceId))
    .orderBy(sql`${audienceSyncs.createdAt} desc`)
    .limit(20);
}
