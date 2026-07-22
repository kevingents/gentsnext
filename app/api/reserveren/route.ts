import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db";
import { createReservation } from "@/lib/reservations";
import { availableForSkus } from "@/lib/stock-reservations";
import { getProductByHandle } from "@/lib/catalog";
import { BRANCH_CITY } from "@/lib/fulfillment-config";
import { getSessionCustomer } from "@/lib/account";
import { storeNotifyEmail } from "@/lib/appointments";
import { sendReserveringEmail, sendReservationStoreNotify } from "@/lib/email";
import { rateLimit, fingerprint } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Reserveer-om-te-passen vanaf de PDP: klant kiest maat + winkel → we houden het
 * stuk HARD vast via de bestaande reserverings-rail (reservations +
 * web_stock_holds, TTL instelbaar via de ReserveringConfig-kaart). De kassa ziet
 * 'm in het reserveringenoverzicht; klant en winkel krijgen een mail.
 *
 * Anti-misbruik: per-IP rate-limit, servervalidatie van sku/prijs/winkel
 * (client-waarden zijn alleen hints), max 3 open web-reserveringen per e-mail.
 */

// Meerlaagse anti-drain-caps: de hold is hard en duurt dagen, dus zonder rem kan
// een bot met adres-/IP-rotatie de zichtbare voorraad droogleggen. Per-e-mail is
// makkelijk te roteren → daarom ook per (sku, winkel), per winkel/dag en globaal
// per dag. De caps zijn check-then-act (neon-http, geen transacties): een kleine
// overshoot onder race is acceptabel — de teller-gate voorkomt oversell sowieso.
const MAX_OPEN_PER_EMAIL = 3;
const MAX_OPEN_PER_SKU_STORE = 2;
const MAX_PER_STORE_PER_DAY = 15;
const MAX_TOTAL_PER_DAY = 40;

/** Regel-injectie (CR/LF) uit vrije velden strippen — die belanden in mails. */
const oneLine = (v: string) => v.replace(/[\r\n\t]+/g, " ").replace(/\s{2,}/g, " ").trim();

/** Cap-sleutel: plus-tag uit het local-part strippen (a+b@x == a@x). */
function emailBase(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.split("+")[0]}@${domain}`;
}

/** Klant-mail test-gated, zelfde regel als de core-route: alleen @gents.nl
 *  tenzij RESERVERING_MAIL_ENABLED=1. */
function mailAllowed(email: string): boolean {
  return process.env.RESERVERING_MAIL_ENABLED === "1" || String(email || "").toLowerCase().endsWith("@gents.nl");
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "?";
  const rl = rateLimit("reserveren:" + fingerprint(ip), 4, 60000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "Te veel aanvragen — probeer het zo weer." }, { status: 429, headers: { "retry-after": String(rl.retryAfterSec) } });
  }

  let body: { handle?: string; sku?: string; store?: string; name?: string; email?: string; phone?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const handle = String(body.handle || "").trim();
  const sku = String(body.sku || "").trim();
  const storeReq = String(body.store || "").trim();
  const name = oneLine(String(body.name || "")).slice(0, 120);
  const email = oneLine(String(body.email || "")).toLowerCase().slice(0, 200);
  const phone = oneLine(String(body.phone || "")).slice(0, 40);
  if (!handle || !sku || !storeReq) return NextResponse.json({ ok: false, error: "Onvolledige aanvraag." }, { status: 400 });
  if (!name) return NextResponse.json({ ok: false, error: "Vul je naam in." }, { status: 400 });
  if (!/.+@.+\..+/.test(email)) return NextResponse.json({ ok: false, error: "Vul een geldig e-mailadres in." }, { status: 400 });

  // Server-waarheid: artikel + prijs uit de catalogus, nooit uit de client.
  const data = await getProductByHandle(handle);
  const variant = data?.variants.find((v) => v.sku && v.sku.toLowerCase() === sku.toLowerCase());
  if (!data || !variant) return NextResponse.json({ ok: false, error: "Artikel niet gevonden." }, { status: 404 });

  // Winkel-check: alleen echte winkels (geen magazijn) mét netto voorraad daar.
  const stock = (await availableForSkus([variant.sku])).get(variant.sku);
  const branch = stock?.byBranch.find(
    (b) => Boolean(BRANCH_CITY[b.branchId]) && b.store.toLowerCase() === storeReq.toLowerCase() && b.qty > 0,
  );
  if (!branch) {
    return NextResponse.json({ ok: false, error: "Deze maat is (net) niet meer beschikbaar in die winkel." }, { status: 409 });
  }

  // Anti-drain-caps in één telling (zie constanten boven). Eén generieke
  // weigering voor alle caps — geen enumeratie van andermans reserveringen.
  try {
    const db = getDb();
    const base = emailBase(email);
    const locL = branch.store.toLowerCase();
    const skuL = variant.sku.toLowerCase();
    const rows = await db.execute<{ open_email: number; open_sku_store: number; day_store: number; day_total: number }>(sql`
      select
        count(*) filter (
          where status = 'open'
            and split_part(split_part(customer_email, '@', 1), '+', 1) || '@' || split_part(customer_email, '@', 2) = ${base}
        )::int as open_email,
        count(*) filter (
          where status = 'open' and lower(location) = ${locL}
            and exists (select 1 from jsonb_array_elements(lines) el where lower(el->>'sku') = ${skuL})
        )::int as open_sku_store,
        count(*) filter (where created_at > now() - interval '24 hours' and lower(location) = ${locL})::int as day_store,
        count(*) filter (where created_at > now() - interval '24 hours')::int as day_total
      from reservations
      where created_by = 'webshop'
    `);
    const c = rows.rows[0];
    if (
      c &&
      ((c.open_email ?? 0) >= MAX_OPEN_PER_EMAIL ||
        (c.open_sku_store ?? 0) >= MAX_OPEN_PER_SKU_STORE ||
        (c.day_store ?? 0) >= MAX_PER_STORE_PER_DAY ||
        (c.day_total ?? 0) >= MAX_TOTAL_PER_DAY)
    ) {
      return NextResponse.json({ ok: false, error: "Reserveren lukt nu even niet — kom gerust langs in de winkel, of probeer het later opnieuw." }, { status: 409 });
    }
  } catch {
    // Tel-fout mag een legitieme klant niet blokkeren.
  }

  // Ingelogde klant koppelen (niet vereist — gast mag reserveren).
  const session = await getSessionCustomer().catch(() => null);

  const result = await createReservation({
    location: branch.store,
    customer: { customerId: session?.id, email, name, phone },
    lines: [{
      stockKey: variant.sku,
      sku: variant.sku,
      title: data.product.title,
      size: variant.size || "",
      color: variant.color || "",
      imageUrl: data.images[0]?.url || "",
      qty: 1,
      priceCents: variant.priceCents,
    }],
    reason: "passen",
    note: "Reserveer om te passen — via gents.nl",
    createdBy: "webshop",
  });
  if (!result.ok || !result.reservation) {
    return NextResponse.json({ ok: false, error: result.error || "Reserveren lukte net niet — probeer het opnieuw." }, { status: 409 });
  }
  const res = result.reservation;

  // Mails: klant (test-gated) + winkel (best effort — de kassa ziet 'm sowieso).
  let mailed = false;
  if (mailAllowed(email)) {
    mailed = await sendReserveringEmail({
      to: email,
      name,
      store: res.location,
      validUntil: res.validUntil,
      lines: [{ title: data.product.title, sku: variant.sku, size: variant.size || "", color: variant.color || "", qty: 1 }],
      payToken: res.payToken,
    }).catch(() => false);
  }
  const storeTo = await storeNotifyEmail(res.location).catch(() => null);
  if (storeTo) {
    await sendReservationStoreNotify({
      to: storeTo,
      store: res.location,
      customerName: name,
      customerEmail: email,
      customerPhone: phone,
      title: data.product.title,
      size: variant.size || "",
      color: variant.color || "",
      validUntil: res.validUntil,
    }).catch(() => false);
  } else {
    console.warn(`[reserveren] geen notificatie-adres voor ${res.location} (settings.storeEmails) — kassa-overzicht is de vangnet-route.`);
  }

  return NextResponse.json({ ok: true, store: res.location, validUntil: res.validUntil, mailed });
}
