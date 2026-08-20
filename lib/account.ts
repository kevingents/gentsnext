import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { after } from "next/server";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  customers,
  customerAddresses,
  customerSessions,
  vouchers,
  loyaltyEvents,
  storePurchases,
  orders,
  orderLines,
  newsletterSubscribers,
  maatadviesLog,
  returns,
  returnLines,
} from "@/db/schema";
import { getGiftcardsForCustomer, scrubGiftcardEmails } from "@/lib/giftcards";
import { koppelDevice, synchroniseerKlantIdentiteiten } from "@/lib/identity";
import { creditOrderLoyalty, reverseOrderLoyalty, redeemableBalance, pendingBalance } from "@/lib/loyalty-claim";
import { resolveKlantIdentiteit } from "@/lib/vouchers";
import { listStoreBuysForProfileCore } from "@/lib/pos-sales-core";
import { mediaByHandle, mediaByArticleCode } from "@/lib/order-media";
import { pickedKeysByOrder } from "@/lib/split-fulfilment";
import { getSettings } from "@/lib/settings";
import { sendWelcomeEmail } from "@/lib/email";
import { importStorePurchasesOnce } from "@/lib/srs-store-import";

/**
 * Klant-accountlaag. Auth via magic-link (wachtwoordloos): e-mail → login-token
 * → sessie-cookie. Tokens worden gehasht opgeslagen (nooit plaintext in de DB).
 * Omnichannel: koppelt online orders (orders.customerId) én winkelaankopen
 * (storePurchases) aan het account.
 */

const SESSION_COOKIE = "gents_session";
const SESSION_DAYS = 60;
const MAGIC_MINUTES = 30;

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function findOrCreateCustomer(email: string) {
  const db = getDb();
  const norm = email.trim().toLowerCase();
  const existing = await db.select().from(customers).where(eq(customers.email, norm)).limit(1);
  if (existing[0]) return existing[0];
  const [created] = await db.insert(customers).values({ email: norm }).returning();
  return created;
}

/**
 * Maak/vind een gents.nl-klant met naam + telefoon, voor de kassa/scanner.
 * GEEN SRS-push — dit is puur de gents.nl-klantkaart (omnichannel-profiel). Bestaat
 * de klant al (op e-mail), dan vullen we alleen lege velden aan (niet overschrijven).
 *
 * Een NIEUWE klant krijgt hier de welkomstpunten: een profiel aanmaken telt aan de
 * kassa net zo goed als online. Een bestaande klant niet — die heeft z'n profiel al.
 * Meldt de bonus terug zodat de kassa 'm op de bon of op het scherm kan zetten.
 */
export async function createPosCustomer(input: { email: string; firstName?: string; lastName?: string; phone?: string }) {
  const db = getDb();
  const email = String(input.email || "").trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) throw new Error("Geldig e-mailadres vereist.");
  const firstName = String(input.firstName || "").trim();
  const lastName = String(input.lastName || "").trim();
  const phone = String(input.phone || "").trim();

  const [existing] = await db.select().from(customers).where(eq(customers.email, email)).limit(1);
  if (existing) {
    const patch: Partial<typeof customers.$inferInsert> = {};
    if (firstName && !existing.firstName) patch.firstName = firstName;
    if (lastName && !existing.lastName) patch.lastName = lastName;
    if (phone && !existing.phone) patch.phone = phone;
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date();
      await db.update(customers).set(patch).where(eq(customers.id, existing.id));
    }
    return { ...existing, ...patch, welkomstpunten: 0 };
  }
  const [created] = await db.insert(customers).values({ email, firstName, lastName, phone }).returning();
  let welkomstpunten = 0;
  try {
    const { awardAccountBonus } = await import("@/lib/loyalty-bonus");
    const r = await awardAccountBonus(created.id);
    welkomstpunten = r.awarded ? r.points : 0;
  } catch (e) {
    // Nooit fataal: de klant is aangemaakt, dat is waar de kassier op wacht.
    console.error("[account] welkomstpunten kassa mislukt:", e);
  }
  return { ...created, welkomstpunten };
}

/** Klantgegevens bijwerken vanaf de kassa (Kevin 5 aug: "klantgegevens kunnen
 *  aanpassen (wel loggen)" — het audit-log schrijft de storegents-kant, op naam
 *  van de kassier). Alleen meegegeven velden wijzigen; e-mail moet geldig zijn
 *  en mag niet botsen met een andere klant. Retourneert previous + updated
 *  zodat de aanroeper het verschil kan loggen. */
export async function updatePosCustomer(customerId: string, input: { firstName?: string; lastName?: string; email?: string; phone?: string; street?: string; houseNumber?: string; postalCode?: string; city?: string }) {
  const db = getDb();
  const id = String(customerId || "").trim();
  if (!id) throw new Error("customerId vereist.");
  const [existing] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!existing) throw new Error("Klant niet gevonden.");

  const patch: Partial<typeof customers.$inferInsert> = {};
  if (input.firstName !== undefined) patch.firstName = String(input.firstName).trim();
  if (input.lastName !== undefined) patch.lastName = String(input.lastName).trim();
  if (input.phone !== undefined) patch.phone = String(input.phone).trim();
  if (input.email !== undefined) {
    const email = String(input.email).trim().toLowerCase();
    if (!/.+@.+\..+/.test(email)) throw new Error("Geldig e-mailadres vereist.");
    if (email !== existing.email) {
      const [inUse] = await db.select({ id: customers.id }).from(customers).where(eq(customers.email, email)).limit(1);
      if (inUse && inUse.id !== id) throw new Error("Dit e-mailadres hoort al bij een andere klant.");
      patch.email = email;
    }
  }

  const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter((k) => patch[k] !== (existing as Record<string, unknown>)[k as string]) as string[];

  /* Adres hoort bij het 360-klantbeeld aan de kassa (Kevin 20 aug). Het leeft in
     customer_addresses, niet op de klantrij: we werken de default-rij bij (of
     maken 'm aan) en rapporteren per veld oud → nieuw voor het winkel-logboek.
     Alleen als er ook echt een adresveld is meegegeven — een correctie van
     alleen de naam mag nooit een adres aanmaken of aanraken. */
  const adresInput: Record<string, string> = {};
  for (const [veld, kolom] of [["street", "street"], ["houseNumber", "houseNumber"], ["postalCode", "postalCode"], ["city", "city"]] as const) {
    const v = (input as Record<string, string | undefined>)[veld];
    if (v !== undefined) adresInput[kolom] = String(v).trim();
  }
  const previousExtra: Record<string, string> = {};
  const updatedExtra: Record<string, string> = {};
  if (Object.keys(adresInput).length) {
    const [adres] = await db
      .select()
      .from(customerAddresses)
      .where(eq(customerAddresses.customerId, id))
      .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.createdAt))
      .limit(1);
    const adresChanged = (Object.keys(adresInput) as (keyof typeof adresInput)[]).filter(
      (k) => adresInput[k] !== String((adres as Record<string, unknown> | undefined)?.[k] ?? "")
    );
    if (adresChanged.length) {
      for (const k of adresChanged) {
        previousExtra[k] = String((adres as Record<string, unknown> | undefined)?.[k] ?? "");
        updatedExtra[k] = adresInput[k];
      }
      if (adres) {
        await db.update(customerAddresses).set(adresInput).where(eq(customerAddresses.id, adres.id));
      } else {
        await db.insert(customerAddresses).values({
          customerId: id,
          firstName: String(input.firstName ?? existing.firstName ?? ""),
          lastName: String(input.lastName ?? existing.lastName ?? ""),
          street: adresInput.street || "",
          houseNumber: adresInput.houseNumber || "",
          postalCode: adresInput.postalCode || "",
          city: adresInput.city || "",
          isDefault: true,
        });
      }
      changed.push(...adresChanged);
    }
  }

  if (!changed.length) return { previous: existing, updated: existing, changed: [] as string[] };
  let updated = existing;
  if ((Object.keys(patch) as (keyof typeof patch)[]).some((k) => changed.includes(k as string))) {
    patch.updatedAt = new Date();
    [updated] = await db.update(customers).set(patch).where(eq(customers.id, id)).returning();
  }
  return {
    previous: { ...existing, ...previousExtra },
    updated: { ...updated, ...updatedExtra },
    changed,
  };
}

/** Default-adres voor het kassa-klantpaneel. De kassa kan een SRS-nummer of
 *  alleen een e-mailadres hebben — zelfde id-resolutie als de tegoedbonnen. */
export async function defaultAddressForCustomer(input: { customerId?: string; email?: string }): Promise<{ street: string; houseNumber: string; postalCode: string; city: string } | null> {
  const { uuid } = await resolveKlantIdentiteit(input);
  if (!uuid) return null;
  const db = getDb();
  const [adres] = await db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.customerId, uuid))
    .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.createdAt))
    .limit(1);
  if (!adres) return null;
  return {
    street: String(adres.street || ""),
    houseNumber: String(adres.houseNumber || ""),
    postalCode: String(adres.postalCode || ""),
    city: String(adres.city || ""),
  };
}

/* ── "Rond je profiel af voor +50 punten" ── */

/** Geef een (gehasht opgeslagen) profiel-afrond-token uit voor de incentive-mail. */
export async function issueProfileCompletionToken(customerId: string): Promise<string> {
  const db = getDb();
  const raw = newToken();
  await db.update(customers).set({ profileCompletionTokenHash: sha256(raw), updatedAt: new Date() }).where(eq(customers.id, customerId));
  return raw;
}

/**
 * Verzilver het token: profiel bijwerken + éénmalig de profielbonus (idempotent).
 *
 * De toekenning zelf loopt via lib/loyalty-bonus, dezelfde route als het
 * zelfservice-formulier op /account. Dat is nodig én bewust: anders kon dezelfde
 * klant de bonus twee keer pakken (één keer via deze mail, één keer door z'n
 * profiel in te vullen). Bedrag komt uit de instellingen, niet uit code.
 */
export async function redeemProfileCompletionBonus(
  rawToken: string,
  profile?: { firstName?: string; lastName?: string; phone?: string; sizeProfile?: Record<string, unknown> },
): Promise<{ ok: boolean; alreadyClaimed?: boolean; points?: number; customerId?: string }> {
  if (!rawToken) return { ok: false };
  const db = getDb();
  const [c] = await db.select().from(customers).where(eq(customers.profileCompletionTokenHash, sha256(String(rawToken)))).limit(1);
  if (!c) return { ok: false };

  const patch: Partial<typeof customers.$inferInsert> = { updatedAt: new Date() };
  if (profile?.firstName && !c.firstName) patch.firstName = profile.firstName.trim();
  if (profile?.lastName && !c.lastName) patch.lastName = profile.lastName.trim();
  if (profile?.phone && !c.phone) patch.phone = profile.phone.trim();
  if (profile?.sizeProfile && typeof profile.sizeProfile === "object") {
    patch.sizeProfile = { ...((c.sizeProfile as Record<string, unknown>) || {}), ...profile.sizeProfile };
  }
  await db.update(customers).set(patch).where(eq(customers.id, c.id));

  const { awardBonus, awardSizeAdviceBonusIfEarned, bonusPointsFor, markProfileBonusClaimed } =
    await import("@/lib/loyalty-bonus");
  const bonus = await awardBonus(c.id, "profiel");
  if (bonus.awarded) {
    /* Vulde hij hier ook z'n maten in? Dan heeft hij de maatprofiel-bonus óók
       verdiend — anders moet hij daarvoor nóg een keer langs /account. */
    const [na] = await db.select({ sizeProfile: customers.sizeProfile }).from(customers).where(eq(customers.id, c.id)).limit(1);
    await awardSizeAdviceBonusIfEarned({ id: c.id, sizeProfile: na?.sizeProfile });
    return { ok: true, points: bonus.points, customerId: c.id };
  }
  /* Geen uitbetaling: al gehad, óf de bonus staat op 0. Het token is hoe dan ook
     verbruikt, maar de "al gehad"-vlag zetten we alleen als er iets te halen
     viel — een tijdelijk uitgezette bonus mag hem niet voorgoed blokkeren. */
  if ((await bonusPointsFor("profiel")) > 0) await markProfileBonusClaimed(c.id);
  else await db.update(customers).set({ profileCompletionTokenHash: null }).where(eq(customers.id, c.id));
  return { ok: true, alreadyClaimed: true, customerId: c.id };
}

/**
 * Throttle tegen e-mail-bombing: max N magic-links per e-mailadres per 10 min.
 * Telt alleen bestaande klanten (onbekend adres = nog geen sessies = niet beperkt).
 */
export async function magicLinkThrottled(email: string, maxPer10Min = 4): Promise<boolean> {
  const db = getDb();
  const norm = email.trim().toLowerCase();
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(
      and(
        eq(customers.email, norm),
        eq(customerSessions.kind, "magic"),
        sql`${customerSessions.createdAt} > now() - interval '10 minutes'`,
      ),
    );
  return (rows[0]?.n ?? 0) >= maxPer10Min;
}

/** Maakt een magic-login-token. Retourneert het ruwe token (voor de e-maillink). */
export async function issueMagicToken(email: string): Promise<{ customerId: string; rawToken: string }> {
  const db = getDb();
  const customer = await findOrCreateCustomer(email);
  const rawToken = newToken();
  const expires = new Date(Date.now() + MAGIC_MINUTES * 60_000);
  await db.insert(customerSessions).values({
    customerId: customer.id,
    tokenHash: sha256(rawToken),
    kind: "magic",
    expiresAt: expires,
  });
  return { customerId: customer.id, rawToken };
}

/** Verzilvert een magic-token → maakt een sessie en zet de cookie. */
export async function consumeMagicToken(rawToken: string): Promise<boolean> {
  const db = getDb();
  const hash = sha256(rawToken);
  const rows = await db
    .select()
    .from(customerSessions)
    .where(and(eq(customerSessions.tokenHash, hash), eq(customerSessions.kind, "magic"), isNull(customerSessions.consumedAt)))
    .limit(1);
  const magic = rows[0];
  if (!magic || magic.expiresAt.getTime() < Date.now()) return false;

  // Atomair verzilveren (CAS op consumedAt): alleen doorgaan als DEZE update de rij
  // van null→now() zette. Zonder de guard passeren twee gelijktijdige GET's (of een
  // link-prefetcher + de echte klik) beide de isNull-check hierboven en maken beide
  // een sessie; nu wint er precies één en faalt de ander netjes.
  const consumed = await db
    .update(customerSessions)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(customerSessions.id, magic.id), isNull(customerSessions.consumedAt)))
    .returning({ id: customerSessions.id });
  if (!consumed.length) return false;
  await createSession(magic.customerId);

  // Bestaande gast-orders met dit e-mailadres aan het account koppelen.
  const [cust] = await db.select().from(customers).where(eq(customers.id, magic.customerId)).limit(1);
  if (cust) {
    const firstTime = !cust.emailVerifiedAt; // eerste bevestiging → welkomstmail
    await db.update(customers).set({ emailVerifiedAt: sql`now()`, lastLoginAt: sql`now()` }).where(eq(customers.id, cust.id));
    await claimGuestData(cust.id, cust.email);
    if (firstTime) {
      /* Welkomstpunten pas hier, bij de EERSTE bevestigde login — niet zodra er
         een klantrij bestaat. findOrCreateCustomer maakt die rij al zodra iemand
         een adres intikt op het inlogformulier; punten daaraan hangen betekent
         dat honderd verzonnen adressen honderd bonussen opleveren zonder dat er
         ooit een mailbox opengaat. Wie hier komt heeft de link écht geopend. */
      try {
        const { awardAccountBonus } = await import("@/lib/loyalty-bonus");
        await awardAccountBonus(cust.id);
      } catch (e) {
        console.error("[account] welkomstpunten-fout:", e);
      }
      try {
        await sendWelcomeEmail(cust.email, cust.firstName);
      } catch (e) {
        console.error("[account] welkomstmail-fout:", e);
      }
    }
  }

  // Self-healing omnichannel: importeer de SRS-winkelhistorie op de achtergrond
  // (non-blocking — ná de response; 1× + wekelijkse refresh; stil als SRS niet
  // geconfigureerd is). Zo vult srs_customer_id + store_purchases vanzelf.
  after(() => importStorePurchasesOnce(magic.customerId).catch(() => {}));

  return true;
}

export async function createSession(customerId: string): Promise<void> {
  const db = getDb();
  const rawToken = newToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await db.insert(customerSessions).values({
    customerId,
    tokenHash: sha256(rawToken),
    kind: "session",
    expiresAt: expires,
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });

  // Inloggen is hét moment waarop een anoniem apparaat een naam krijgt. Koppel
  // het device en kleur zijn verleden in — juist de oriëntatiesessie vóór het
  // inloggen (welke pakken bekeken, waarop gezocht) is het interessantst, en
  // die zou anders voorgoed anoniem blijven. Non-fataal: een mislukte koppeling
  // mag nooit een login blokkeren.
  try {
    const sid = jar.get("gents-sid")?.value;
    if (sid) await koppelDevice(customerId, decodeURIComponent(sid), "login");
    await synchroniseerKlantIdentiteiten(customerId, "login");
  } catch (e) {
    console.warn("[account] device koppelen mislukt:", e instanceof Error ? e.message : e);
  }
}

export async function logout(): Promise<void> {
  const db = getDb();
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (raw) {
    await db.delete(customerSessions).where(eq(customerSessions.tokenHash, sha256(raw)));
  }
  jar.delete(SESSION_COOKIE);
}

/** Huidige ingelogde klant (of null). Voor server components & route handlers. */
export async function getSessionCustomer() {
  const jar = await cookies();
  const raw = jar.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const db = getDb();
  const rows = await db
    .select({ customer: customers })
    .from(customerSessions)
    .innerJoin(customers, eq(customers.id, customerSessions.customerId))
    .where(
      and(
        eq(customerSessions.tokenHash, sha256(raw)),
        eq(customerSessions.kind, "session"),
        // Server-side expiry: de cookie verloopt client-side (maxAge), maar een
        // bewaard raw token mag na de 60 dagen ook hier niet meer valideren.
        sql`${customerSessions.expiresAt} > now()`,
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return row.customer;
}

/** Koppelt eerdere gast-orders en winkelaankopen op e-mail aan het account. */
export async function claimGuestData(customerId: string, email: string): Promise<void> {
  const db = getDb();
  await db
    .update(orders)
    .set({ customerId })
    .where(and(eq(orders.email, email), isNull(orders.customerId)));
  await db
    .update(storePurchases)
    .set({ customerId })
    .where(and(eq(storePurchases.email, email), isNull(storePurchases.customerId)));
  // Punten van de (zojuist gekoppelde) betaalde weborders bijschrijven — idempotent,
  // dus opnieuw inloggen schrijft nooit dubbel bij. Non-fataal.
  try {
    const linked = await db
      .select({ id: orders.id, totalCents: orders.totalCents, status: orders.status, paidAt: orders.paidAt, createdAt: orders.createdAt })
      .from(orders)
      .where(eq(orders.customerId, customerId));
    for (const o of linked) {
      await creditOrderLoyalty(customerId, { id: o.id, totalCents: o.totalCents, status: String(o.status), paidAt: o.paidAt, createdAt: o.createdAt });
      // Was dit (gast-)order al (deels) geretourneerd vóór het koppelen? Draai die
      // punten alsnog terug — anders krijgt de klant punten voor teruggestuurde waar.
      const doneReturns = await db
        .select({ id: returns.id, itemsCents: returns.itemsCents })
        .from(returns)
        .where(and(eq(returns.orderId, o.id), eq(returns.status, "completed")));
      for (const r of doneReturns) await reverseOrderLoyalty(customerId, o.id, r.itemsCents, r.id);
    }
  } catch (e) {
    console.warn("[claimGuestData] punten bijschrijven mislukt:", e instanceof Error ? e.message : e);
  }
}

export type ProfileData = Awaited<ReturnType<typeof getProfileData>>;

/** Bonnummers vergelijkbaar maken: SRS levert ze soms met voorloopnullen/prefix. */
function normReceiptRef(v: unknown): string {
  return String(v ?? "").replace(/\D/g, "").replace(/^0+/, "");
}
function dayKey(d: Date | string | null | undefined): string {
  const x = d instanceof Date ? d : new Date(String(d ?? ""));
  return isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
}

/**
 * De zendingen van een split-order, met per zending of dat deel al klaarstaat.
 * `gereed` komt uit order_shipment_picks (winkel meldt z'n deel gereed); het
 * magazijn heeft daar geen melding, dus dat blijft null (= geen uitspraak) totdat
 * de hele order verzonden is. Bij één zending: lege lijst — dan zegt de orderstatus
 * alles al en zou een "zending 1 van 1" alleen maar ruis zijn.
 */
function deelzendingen(
  plan: unknown,
  gemeld: Set<string> | undefined,
  orderStatus: string,
): { store: string; isWarehouse: boolean; gereed: boolean | null; lines: { title: string; qty: number }[] }[] {
  const ships = (plan as { shipments?: { store?: string; isWarehouse?: boolean; units?: number; lines?: { sku?: string; qty?: number; title?: string }[] }[] } | null)?.shipments ?? [];
  if (ships.length < 2) return [];
  const onderweg = ["shipped", "ready_pickup", "delivered"].includes(String(orderStatus));
  const picked = gemeld ?? new Set<string>();
  return ships.map((s) => ({
    store: String(s.store || ""),
    isWarehouse: Boolean(s.isWarehouse),
    gereed: onderweg ? true : s.isWarehouse ? null : picked.has(String(s.store || "").trim().toLowerCase()),
    lines: (s.lines ?? []).map((l) => ({ title: String(l.title || l.sku || ""), qty: Number(l.qty) || 1 })),
  }));
}

/** Alle profielgegevens in één keer voor de accountpagina. */
export async function getProfileData(customerId: string, email = "") {
  const db = getDb();
  const [onlineOrders, importedBuys, posBuys, vouchersList, loyalty, addresses, giftcardsList] = await Promise.all([
    db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt)).limit(50),
    db.select().from(storePurchases).where(eq(storePurchases.customerId, customerId)).orderBy(desc(storePurchases.purchasedAt)).limit(50),
    // Bonnen van de nieuwe kassa (pos_sales) — die staan NIET in store_purchases.
    listStoreBuysForProfileCore({ customerId, email, limit: 50 }),
    db.select().from(vouchers).where(eq(vouchers.customerId, customerId)).orderBy(desc(vouchers.createdAt)),
    db.select().from(loyaltyEvents).where(eq(loyaltyEvents.customerId, customerId)).orderBy(desc(loyaltyEvents.createdAt)).limit(100),
    db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customerId)).orderBy(desc(customerAddresses.isDefault)),
    getGiftcardsForCustomer(customerId, email),
  ]);

  /* Winkelaankopen = SRS-import (store_purchases) + kassabonnen (pos_sales), in één lijst.
     Ontdubbelen is nodig omdat de kassa z'n bon óók naar SRS boekt: heeft de klant een
     SRS-klantnummer, dan haalt de import diezelfde bon later alsnog op. Sleutel is het
     SRS-bonnummer, met de dag als extra guard (bonnummers zijn per filiaal, dus niet
     uniek genoeg om er alleen op te ontdubbelen). Bij een treffer wint de kassa-versie:
     die is native, heeft de regels zoals ze geslagen zijn, en kent retouren. */
  const posRefDays = new Map<string, Set<string>>();
  for (const b of posBuys) {
    const k = normReceiptRef(b.receiptRef);
    if (!k) continue;
    if (!posRefDays.has(k)) posRefDays.set(k, new Set());
    posRefDays.get(k)!.add(dayKey(b.purchasedAt));
  }
  const storeBuys = [
    ...importedBuys
      .filter((s) => {
        const k = normReceiptRef(s.receiptId);
        return !k || !posRefDays.get(k)?.has(dayKey(s.purchasedAt));
      })
      .map((s) => ({
        id: s.id,
        storeName: s.storeName,
        purchasedAt: s.purchasedAt,
        totalCents: s.totalCents,
        pointsEarned: s.pointsEarned,
        kind: (s.totalCents < 0 ? "retour" : "sale") as "sale" | "retour",
        receiptRef: s.receiptId || "",
        lines: ((s.lines ?? []) as { title: string; size: string; color: string; qty: number; unitPriceCents: number }[])
          .map((l) => ({ ...l, sku: "", barcode: "" })),
      })),
    ...posBuys,
  ]
    .sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime())
    .slice(0, 50);

  // Orderregels ophalen voor de online orders.
  const orderIds = onlineOrders.map((o) => o.id);
  const lines = orderIds.length
    ? await db.select().from(orderLines).where(sql`${orderLines.orderId} in (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)})`)
    : [];

  /* Productbeeld erbij — voor beide kanalen tegelijk, in twee batch-queries. Online
     regels vinden hun product via de handle, kassaregels via de artikelcode die over
     de scanner ging. Zonder de tweede zou de helft van één en dezelfde lijst
     beeldloos blijven. */
  const [mediaHandles, mediaCodes, pickedKeys] = await Promise.all([
    mediaByHandle(lines.map((l) => l.productHandle)),
    mediaByArticleCode(storeBuys.flatMap((b) => b.lines.flatMap((l) => [l.sku, l.barcode]))),
    pickedKeysByOrder(onlineOrders.map((o) => o.orderNumber)),
  ]);
  const mediaVoorRegel = (sku: string, barcode: string) => mediaCodes.get(sku) ?? mediaCodes.get(barcode);

  const linesByOrder = new Map<string, (typeof lines[number] & { imageUrl: string })[]>();
  for (const l of lines) {
    if (!linesByOrder.has(l.orderId)) linesByOrder.set(l.orderId, []);
    linesByOrder.get(l.orderId)!.push({ ...l, imageUrl: mediaHandles.get(l.productHandle)?.imageUrl ?? "" });
  }
  const storeBuysMetBeeld = storeBuys.map((b) => ({
    ...b,
    lines: b.lines.map((l) => {
      const m = mediaVoorRegel(l.sku, l.barcode);
      return { ...l, imageUrl: m?.imageUrl ?? "", handle: m?.handle ?? "" };
    }),
  }));

  // Beschikbaar (gevest) vs in behandeling — uit het HELE grootboek (SUM, niet de op
  // 100 gekapte history-lijst), en geklemd op 0. De `loyalty`-array blijft puur voor
  // de mutatie-weergave.
  const [availRaw, pendRaw] = await Promise.all([redeemableBalance(customerId), pendingBalance(customerId)]);
  const pointsAvailable = Math.max(0, availRaw);
  const pointsPending = Math.max(0, pendRaw);
  const pointsBalance = pointsAvailable + pointsPending;
  const activeVouchers = vouchersList.filter(
    (v) => v.status === "active" && (!v.expiresAt || v.expiresAt.getTime() > Date.now())
  );

  // Retouren van deze klant (gekoppeld aan z'n online orders) + hun regels.
  const retRows = orderIds.length
    ? await db.select().from(returns).where(sql`${returns.orderId} in (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)})`).orderBy(desc(returns.createdAt))
    : [];
  const retIds = retRows.map((r) => r.id);
  const retLines = retIds.length
    ? await db.select().from(returnLines).where(sql`${returnLines.returnId} in (${sql.join(retIds.map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const retLinesBy = new Map<string, typeof retLines>();
  for (const l of retLines) {
    if (!retLinesBy.has(l.returnId)) retLinesBy.set(l.returnId, []);
    retLinesBy.get(l.returnId)!.push(l);
  }

  return {
    onlineOrders: onlineOrders.map((o) => ({
      ...o,
      lines: linesByOrder.get(o.id) ?? [],
      /* Deellevering: bij een order uit meerdere locaties wil de klant weten wát er al
         klaarstaat en wat nog niet. Alleen tonen als er echt meerdere zendingen zijn —
         bij één zending is de orderstatus zelf het hele verhaal. */
      shipments: deelzendingen(o.fulfillmentPlan, pickedKeys.get(o.orderNumber), o.status),
    })),
    storeBuys: storeBuysMetBeeld,
    vouchers: vouchersList,
    activeVouchers,
    giftcards: giftcardsList,
    loyalty,
    pointsBalance,
    pointsAvailable,
    pointsPending,
    addresses,
    returnWindowDays: (await getSettings()).returnConfig.windowDays,
    returns: retRows.map((r) => ({
      id: r.id, orderNumber: r.orderNumber, status: r.status, method: r.method, refundType: r.refundType,
      itemsCents: r.itemsCents, shippingCostCents: r.shippingCostCents, refundedCents: r.refundedCents,
      creditCode: r.creditCode, dhlTracking: r.dhlTracking, dhlLabelUrl: r.dhlLabelUrl, createdAt: r.createdAt,
      lines: (retLinesBy.get(r.id) || []).map((l) => ({ title: l.title, size: l.size, color: l.color, qty: l.qty })),
    })),
  };
}

/** Lichte adres-lijst (default eerst) — voor checkout-prefill. */
export async function getCustomerAddresses(customerId: string) {
  const db = getDb();
  return db
    .select()
    .from(customerAddresses)
    .where(eq(customerAddresses.customerId, customerId))
    .orderBy(desc(customerAddresses.isDefault), desc(customerAddresses.createdAt));
}

export async function updateProfile(
  customerId: string,
  patch: { firstName?: string; lastName?: string; phone?: string; marketingOptIn?: boolean }
) {
  const db = getDb();
  await db
    .update(customers)
    .set({ ...patch, updatedAt: sql`now()` })
    .where(eq(customers.id, customerId));
}

export type SizeProfile = {
  colbert?: string;
  broek?: string;
  overhemd?: string;
  schoen?: string;
  pasvorm?: string;
  lengte?: string;
  gewicht?: string;
  notities?: string;
};

export async function updateSizeProfile(customerId: string, sizeProfile: SizeProfile) {
  const db = getDb();
  await db.update(customers).set({ sizeProfile, updatedAt: sql`now()` }).where(eq(customers.id, customerId));
}

/**
 * Losse voorkeur bijwerken (bv. favoriteStore) — merge, nooit de rest wissen.
 * Een lijst (favoriteStores) gaat als jsonb-array de kolom in, niet als tekst:
 * anders leest elke lezer er een string uit waar hij een array verwacht.
 */
export async function updatePreference(customerId: string, key: string, value: string | string[]) {
  const db = getDb();
  const waarde = Array.isArray(value)
    ? sql`${JSON.stringify(value)}::jsonb`
    : sql`to_jsonb(${value}::text)`;
  await db
    .update(customers)
    .set({
      preferences: sql`coalesce(${customers.preferences}, '{}'::jsonb) || jsonb_build_object(${key}::text, ${waarde})`,
      updatedAt: sql`now()`,
    })
    .where(eq(customers.id, customerId));
}

/**
 * Meerdere voorkeuren in één keer bijwerken (het voorkeuren-formulier op
 * /account). Merge op jsonb-niveau in de database zelf, zodat sleutels die dit
 * formulier niet kent — of die een ander apparaat net zette — blijven staan;
 * een lees-wijzig-schrijf ronde zou die stil overschrijven.
 *
 * Leegmaken doe je door de sleutel met een lege waarde mee te sturen ("" of
 * []). Alle lezers behandelen leeg als "niet ingevuld", dus dat wist de
 * voorkeur zonder dat we sleutels hoeven te verwijderen.
 *
 * Retourneert de NIEUWE voorkeuren, zodat de aanroeper meteen kan beoordelen of
 * het profiel daarmee compleet is (scheelt een tweede leesronde).
 */
export async function mergePreferences(
  customerId: string,
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const db = getDb();
  const [row] = await db
    .update(customers)
    .set({
      preferences: sql`coalesce(${customers.preferences}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(eq(customers.id, customerId))
    .returning({ preferences: customers.preferences });
  return (row?.preferences ?? {}) as Record<string, unknown>;
}

/* ── AVG: inzage & verwijdering ───────────────────────────────────────────── */

/** Alle persoonsgegevens van de klant in één bundel (recht op inzage/dataportabiliteit). */
export async function exportMyData(customerId: string, email: string) {
  const db = getDb();
  const [cust] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  const profile = await getProfileData(customerId, email);
  return {
    geexporteerdOp: new Date().toISOString(),
    account: cust
      ? {
          email: cust.email,
          voornaam: cust.firstName,
          achternaam: cust.lastName,
          telefoon: cust.phone,
          maatprofiel: cust.sizeProfile,
          voorkeuren: cust.preferences,
          nieuwsbriefAangemeld: cust.marketingOptIn,
          punten: profile.pointsBalance,
          klantSinds: cust.createdAt,
        }
      : null,
    onlineBestellingen: profile.onlineOrders,
    winkelaankopen: profile.storeBuys,
    adresboek: profile.addresses,
    tegoedbonnen: profile.vouchers,
    cadeaubonnen: profile.giftcards,
    puntenHistorie: profile.loyalty,
  };
}

/**
 * Recht op vergetelheid: anonimiseert het account (e-mail/naam/telefoon/maten/
 * voorkeuren gewist, wachtwoord verwijderd) en wist adresboek, sessies en
 * nieuwsbrief-inschrijvingen. Bestellingen/winkelaankopen blijven bewaard als
 * wettelijk verplichte administratie (NL 7 jaar), gekoppeld aan het anonieme account.
 */
export async function deleteAccount(customerId: string, email: string): Promise<void> {
  const db = getDb();
  const anonEmail = `verwijderd+${customerId}@gents.invalid`;
  await db
    .update(customers)
    .set({
      email: anonEmail,
      firstName: "",
      lastName: "",
      phone: "",
      passwordHash: null,
      srsCustomerId: null,
      sizeProfile: {},
      preferences: {},
      marketingOptIn: false,
      updatedAt: sql`now()`,
    })
    .where(eq(customers.id, customerId));
  await db.delete(customerAddresses).where(eq(customerAddresses.customerId, customerId));
  await db.delete(customerSessions).where(eq(customerSessions.customerId, customerId));
  if (email) await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.email, email.trim().toLowerCase()));
  /* Cadeaubon-e-mails losmaken: getGiftcardsForCustomer matcht op e-mailtekst,
     dus zonder dit ziet een later hergebruikt adres andermans bonnen. De bon
     zelf (saldo/code) blijft als administratie staan en blijft inwisselbaar. */
  if (email) await scrubGiftcardEmails(email);
  /* Maatadviezen ontkoppelen in plaats van verwijderen: lengte en gewicht zijn
     persoonsgegevens zolang ze aan iemand hangen, maar de meting "hoe vaak klopt
     ons advies" heeft die persoon niet nodig. Zonder klant_id is de rij niet
     meer herleidbaar en blijft de kwaliteitsmeting overeind. */
  await db.update(maatadviesLog).set({ klantId: null }).where(eq(maatadviesLog.klantId, customerId));
}
