import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { stockNotifications, products, productVariants } from "@/db/schema";
import { emailConfigured, brandedEmailHtml } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";
import { sendBackInStockWhatsApp, sendAlternativeWhatsApp, normalizePhone } from "@/lib/whatsapp";
import { getSettings } from "@/lib/settings";

/**
 * Terug-op-voorraad-notificaties. Klant laat e-mail achter op een uitverkocht
 * product/maat; de voorraad-sync roept processStockNotifications() aan en mailt
 * zodra het er weer is. Env-gated op Resend (zonder mailinfra: alleen opslaan).
 */

export async function createStockNotification(input: {
  email?: string;
  phone?: string;
  channel?: string; // 'email' | 'whatsapp' | 'both'
  productHandle: string;
  productTitle?: string;
  sku?: string;
  size?: string;
  color?: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.productHandle) return { ok: false, error: "geen product" };
  const channel = input.channel === "whatsapp" || input.channel === "both" ? input.channel : "email";

  const email = (input.email || "").trim().toLowerCase();
  const phone = normalizePhone(input.phone || "") || "";

  const wantsEmail = channel === "email" || channel === "both";
  const wantsWhats = channel === "whatsapp" || channel === "both";
  if (wantsEmail && !/.+@.+\..+/.test(email)) return { ok: false, error: "ongeldig e-mailadres" };
  if (wantsWhats && !phone) return { ok: false, error: "ongeldig telefoonnummer" };

  const db = getDb();
  // Idempotent: zelfde contact + product + sku → niet dubbel.
  await db
    .insert(stockNotifications)
    .values({
      email,
      phone,
      channel,
      productHandle: input.productHandle,
      productTitle: input.productTitle || "",
      sku: input.sku || "",
      size: input.size || "",
      color: input.color || "",
      status: "pending",
    })
    .onConflictDoNothing();
  return { ok: true };
}

/**
 * Verstuurt notificaties voor producten/maten die wéér voorraad hebben.
 * Bedoeld om aangeroepen te worden na de voorraad-sync (flags net bijgewerkt).
 * Retourneert het aantal verstuurde mails.
 */
export async function processStockNotifications(): Promise<number> {
  const cfg = (await getSettings()).stockNotifyConfig;
  if (!cfg.enabled) return 0;
  const db = getDb();
  const pending = await db
    .select()
    .from(stockNotifications)
    .where(eq(stockNotifications.status, "pending"))
    .limit(2000);
  if (!pending.length) return 0;

  // Voorraad-status ophalen: per-sku (variant.stockQty) en per-product (in_stock).
  const skus = [...new Set(pending.map((p) => p.sku).filter(Boolean))];
  const handles = [...new Set(pending.map((p) => p.productHandle))];

  const skuStock = new Map<string, number>();
  if (skus.length) {
    const rows = await db
      .select({ sku: productVariants.sku, qty: productVariants.stockQty })
      .from(productVariants)
      .where(inArray(productVariants.sku, skus));
    for (const r of rows) skuStock.set(r.sku, Math.max(skuStock.get(r.sku) ?? 0, r.qty));
  }
  const productInStock = new Map<string, boolean>();
  if (handles.length) {
    const rows = await db
      .select({ handle: products.handle, inStock: products.inStock })
      .from(products)
      .where(inArray(products.handle, handles));
    for (const r of rows) productInStock.set(r.handle, r.inStock);
  }

  const site = getSiteUrl();
  let sent = 0;
  for (const n of pending) {
    const backInStock = n.sku ? (skuStock.get(n.sku) ?? 0) > 0 : productInStock.get(n.productHandle) === true;
    if (!backInStock) continue;

    const wantsEmail = cfg.emailEnabled && (n.channel === "email" || n.channel === "both") && n.email;
    const wantsWhats = cfg.whatsappEnabled && (n.channel === "whatsapp" || n.channel === "both") && n.phone;
    const url = `${site}/products/${n.productHandle}`;
    const title = n.productTitle || "Je product";

    let any = false;
    if (wantsEmail) any = (await sendBackInStockEmail(n, site)) || any;
    if (wantsWhats) {
      any = (await sendBackInStockWhatsApp(n.phone, { productTitle: title, size: n.size || undefined, url })) || any;
    }

    if (any) {
      await db
        .update(stockNotifications)
        .set({ status: "notified", notifiedAt: sql`now()` })
        .where(eq(stockNotifications.id, n.id));
      sent++;
    }
  }
  return sent;
}

/**
 * Zoekt een alternatief dat NU op voorraad is in de maat van de klant en in dezelfde
 * hoofdgroep (bv. een ander pak in maat 50), buiten het originele product. Voorkeur:
 * meeste voorraad eerst (betrouwbaar leverbaar). Retourneert {handle, title} of null.
 */
export async function findInStockAlternative(n: {
  productHandle: string;
  size: string;
}): Promise<{ handle: string; title: string } | null> {
  const db = getDb();
  const orig = await db.execute<{ hg: string }>(sql`
    select attributes ->> 'hoofdgroep_omschrijving' hg from ${products} where handle = ${n.productHandle} limit 1
  `);
  const hg = orig.rows[0]?.hg;
  if (!hg) return null;

  // Maat matchen op de RAW size (bv. "50"); zonder maat → elk in-stock alternatief.
  const sizeCond = n.size ? sql` and v.size = ${n.size}` : sql``;
  const rows = await db.execute<{ handle: string; title: string }>(sql`
    select p.handle, p.title
    from ${products} p
    join ${productVariants} v on v.product_id = p.id
    where p.status='active' and p.has_image=true and p.in_stock=true and p.is_group_primary=true
      and p.handle <> ${n.productHandle}
      and p.attributes ->> 'hoofdgroep_omschrijving' = ${hg}
      and v.stock_qty > 0${sizeCond}
    group by p.id, p.handle, p.title, p.stock_qty, p.source_created_at
    order by p.stock_qty desc nulls last, p.source_created_at desc nulls last
    limit 1
  `);
  const r = rows.rows[0];
  return r ? { handle: r.handle, title: r.title } : null;
}

/**
 * 2-weken-vervolg: pending-meldingen ouder dan `alternativeAfterDays` waarvan de maat
 * NOG STEEDS niet terug is → stuur een alternatief-op-maat (mail/WhatsApp) en zet op
 * 'alternative_sent'. Zo blijft de klant niet in de kou staan. Is de maat inmiddels wél
 * terug, dan slaat de restock-processor 'm alsnog aan (deze slaat 'm hier over).
 * Retourneert het aantal verstuurde alternatieven.
 */
export async function processStaleStockNotifications(): Promise<number> {
  const cfg = (await getSettings()).stockNotifyConfig;
  if (!cfg.enabled || !cfg.alternativeEnabled) return 0;
  const days = Math.max(1, Math.floor(cfg.alternativeAfterDays || 14));
  const db = getDb();
  const stale = await db.execute<{
    id: string; email: string; phone: string; channel: string;
    product_handle: string; product_title: string; sku: string; size: string;
  }>(sql`
    select id, email, phone, channel, product_handle, product_title, sku, size
    from ${stockNotifications}
    where status = 'pending' and created_at < now() - (${days} || ' days')::interval
    limit 1000
  `);
  if (!stale.rows.length) return 0;

  // Nog-op-voorraad? Dan handelt de restock-processor het af — geen alternatief sturen.
  const skus = [...new Set(stale.rows.map((r) => r.sku).filter(Boolean))];
  const handles = [...new Set(stale.rows.map((r) => r.product_handle))];
  const skuStock = new Map<string, number>();
  if (skus.length) {
    const rows = await db.select({ sku: productVariants.sku, qty: productVariants.stockQty }).from(productVariants).where(inArray(productVariants.sku, skus));
    for (const r of rows) skuStock.set(r.sku, Math.max(skuStock.get(r.sku) ?? 0, r.qty));
  }
  const productInStock = new Map<string, boolean>();
  if (handles.length) {
    const rows = await db.select({ handle: products.handle, inStock: products.inStock }).from(products).where(inArray(products.handle, handles));
    for (const r of rows) productInStock.set(r.handle, r.inStock);
  }

  const site = getSiteUrl();
  let sent = 0;
  for (const n of stale.rows) {
    const backInStock = n.sku ? (skuStock.get(n.sku) ?? 0) > 0 : productInStock.get(n.product_handle) === true;
    if (backInStock) continue;

    const alt = await findInStockAlternative({ productHandle: n.product_handle, size: n.size });
    if (!alt) continue; // (nog) geen alternatief — laat pending, probeer later opnieuw

    const wantsEmail = cfg.emailEnabled && (n.channel === "email" || n.channel === "both") && n.email;
    const wantsWhats = cfg.whatsappEnabled && (n.channel === "whatsapp" || n.channel === "both") && n.phone;
    const altUrl = `${site}/products/${alt.handle}`;
    const origTitle = n.product_title || "Je product";

    let any = false;
    if (wantsEmail) any = (await sendAlternativeEmail({ email: n.email, origTitle, altTitle: alt.title, altUrl, size: n.size })) || any;
    if (wantsWhats) any = (await sendAlternativeWhatsApp(n.phone, { origTitle, altTitle: alt.title, size: n.size || undefined, url: altUrl })) || any;

    if (any) {
      await db.update(stockNotifications).set({ status: "alternative_sent", notifiedAt: sql`now()` }).where(eq(stockNotifications.id, n.id));
      sent++;
    }
  }
  return sent;
}

async function sendAlternativeEmail(
  n: { email: string; origTitle: string; altTitle: string; altUrl: string; size: string }
): Promise<boolean> {
  const maat = n.size ? ` (maat ${n.size})` : "";
  if (!emailConfigured()) {
    console.log(`[stock-notify] (stub) zou alternatief mailen: ${n.email} → ${n.altTitle} i.p.v. ${n.origTitle}${maat}`);
    return true;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [n.email],
        subject: "Nog niet terug — maar dit alternatief is er wél in jouw maat",
        html: brandedEmailHtml({
          heading: "Dit alternatief is er wél in jouw maat",
          bodyHtml: `<p style="margin:0 0 10px">Je wachtte op <strong>${n.origTitle}</strong>${maat}. Die is helaas nog niet terug op voorraad.</p><p style="margin:0 0 10px">Goed nieuws: dit alternatief hebben we wél direct leverbaar in jouw maat:</p><p style="margin:0;font:600 16px Arial,sans-serif;color:#111111">${n.altTitle}</p>`,
          cta: { label: "Bekijk het alternatief", href: n.altUrl },
        }),
      }),
    });
    if (!res.ok) {
      console.error("[stock-notify] alt-Resend-fout:", res.status, (await res.text()).slice(0, 160));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[stock-notify] alt fetch-fout:", e);
    return false;
  }
}

async function sendBackInStockEmail(
  n: { email: string; productHandle: string; productTitle: string; size: string },
  site: string
): Promise<boolean> {
  const url = `${site}/products/${n.productHandle}`;
  const title = n.productTitle || "Je product";
  const maat = n.size ? ` (maat ${n.size})` : "";

  if (!emailConfigured()) {
    console.log(`[stock-notify] (stub) zou mailen: ${n.email} → ${title}${maat} ${url}`);
    return true; // in stub-modus markeren als verstuurd zodat we niet blijven herproberen
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.RESEND_FROM,
        to: [n.email],
        subject: `${title} is weer op voorraad`,
        html: brandedEmailHtml({
          heading: `${title} is weer op voorraad`,
          bodyHtml: `<p style="margin:0">Goed nieuws! <strong>${title}</strong>${maat} is weer op voorraad. Wees er snel bij — op = op.</p>`,
          cta: { label: "Bekijk product", href: url },
        }),
      }),
    });
    if (!res.ok) {
      console.error("[stock-notify] Resend-fout:", res.status, (await res.text()).slice(0, 160));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[stock-notify] fetch-fout:", e);
    return false;
  }
}
