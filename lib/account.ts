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
  returns,
  returnLines,
} from "@/db/schema";
import { getGiftcardsForCustomer } from "@/lib/giftcards";
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
    return { ...existing, ...patch };
  }
  const [created] = await db.insert(customers).values({ email, firstName, lastName, phone }).returning();
  return created;
}

/* ── "Rond je profiel af voor +50 punten" ── */
const PROFILE_BONUS_POINTS = 50;

/** Geef een (gehasht opgeslagen) profiel-afrond-token uit voor de incentive-mail. */
export async function issueProfileCompletionToken(customerId: string): Promise<string> {
  const db = getDb();
  const raw = newToken();
  await db.update(customers).set({ profileCompletionTokenHash: sha256(raw), updatedAt: new Date() }).where(eq(customers.id, customerId));
  return raw;
}

/** Verzilver het token: profiel bijwerken + éénmalig +50 punten (idempotent). */
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

  if (c.profileCompletionBonusClaimed) {
    await db.update(customers).set(patch).where(eq(customers.id, c.id)); // wel profiel, geen dubbele bonus
    return { ok: true, alreadyClaimed: true, customerId: c.id };
  }

  await db.insert(loyaltyEvents).values({ customerId: c.id, points: PROFILE_BONUS_POINTS, reason: "Profiel afgerond", refType: "profile_completion" });
  await db.update(customers).set({
    ...patch,
    loyaltyPoints: (c.loyaltyPoints || 0) + PROFILE_BONUS_POINTS,
    profileCompletionBonusClaimed: true,
    profileCompletionTokenHash: null,
  }).where(eq(customers.id, c.id));
  return { ok: true, points: PROFILE_BONUS_POINTS, customerId: c.id };
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

  await db.update(customerSessions).set({ consumedAt: sql`now()` }).where(eq(customerSessions.id, magic.id));
  await createSession(magic.customerId);

  // Bestaande gast-orders met dit e-mailadres aan het account koppelen.
  const [cust] = await db.select().from(customers).where(eq(customers.id, magic.customerId)).limit(1);
  if (cust) {
    const firstTime = !cust.emailVerifiedAt; // eerste bevestiging → welkomstmail
    await db.update(customers).set({ emailVerifiedAt: sql`now()`, lastLoginAt: sql`now()` }).where(eq(customers.id, cust.id));
    await claimGuestData(cust.id, cust.email);
    if (firstTime) {
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
    .where(and(eq(customerSessions.tokenHash, sha256(raw)), eq(customerSessions.kind, "session")))
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
}

export type ProfileData = Awaited<ReturnType<typeof getProfileData>>;

/** Alle profielgegevens in één keer voor de accountpagina. */
export async function getProfileData(customerId: string, email = "") {
  const db = getDb();
  const [onlineOrders, storeBuys, vouchersList, loyalty, addresses, giftcardsList] = await Promise.all([
    db.select().from(orders).where(eq(orders.customerId, customerId)).orderBy(desc(orders.createdAt)).limit(50),
    db.select().from(storePurchases).where(eq(storePurchases.customerId, customerId)).orderBy(desc(storePurchases.purchasedAt)).limit(50),
    db.select().from(vouchers).where(eq(vouchers.customerId, customerId)).orderBy(desc(vouchers.createdAt)),
    db.select().from(loyaltyEvents).where(eq(loyaltyEvents.customerId, customerId)).orderBy(desc(loyaltyEvents.createdAt)).limit(100),
    db.select().from(customerAddresses).where(eq(customerAddresses.customerId, customerId)).orderBy(desc(customerAddresses.isDefault)),
    getGiftcardsForCustomer(customerId, email),
  ]);

  // Orderregels ophalen voor de online orders.
  const orderIds = onlineOrders.map((o) => o.id);
  const lines = orderIds.length
    ? await db.select().from(orderLines).where(sql`${orderLines.orderId} in (${sql.join(orderIds.map((i) => sql`${i}`), sql`, `)})`)
    : [];
  const linesByOrder = new Map<string, typeof lines>();
  for (const l of lines) {
    if (!linesByOrder.has(l.orderId)) linesByOrder.set(l.orderId, []);
    linesByOrder.get(l.orderId)!.push(l);
  }

  const pointsBalance = loyalty.reduce((s, e) => s + e.points, 0);
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
    onlineOrders: onlineOrders.map((o) => ({ ...o, lines: linesByOrder.get(o.id) ?? [] })),
    storeBuys,
    vouchers: vouchersList,
    activeVouchers,
    giftcards: giftcardsList,
    loyalty,
    pointsBalance,
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
          spaarpunten: profile.pointsBalance,
          klantSinds: cust.createdAt,
        }
      : null,
    onlineBestellingen: profile.onlineOrders,
    winkelaankopen: profile.storeBuys,
    adresboek: profile.addresses,
    tegoedbonnen: profile.vouchers,
    cadeaubonnen: profile.giftcards,
    spaarpuntenHistorie: profile.loyalty,
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
}
