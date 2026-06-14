import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
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
} from "@/db/schema";
import { getGiftcardsForCustomer } from "@/lib/giftcards";

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
    await db.update(customers).set({ emailVerifiedAt: sql`now()`, lastLoginAt: sql`now()` }).where(eq(customers.id, cust.id));
    await claimGuestData(cust.id, cust.email);
  }
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

  return {
    onlineOrders: onlineOrders.map((o) => ({ ...o, lines: linesByOrder.get(o.id) ?? [] })),
    storeBuys,
    vouchers: vouchersList,
    activeVouchers,
    giftcards: giftcardsList,
    loyalty,
    pointsBalance,
    addresses,
  };
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
