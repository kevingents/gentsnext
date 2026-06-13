import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { stockNotifications, products, productVariants } from "@/db/schema";
import { emailConfigured } from "@/lib/email";
import { getSiteUrl } from "@/lib/site-url";

/**
 * Terug-op-voorraad-notificaties. Klant laat e-mail achter op een uitverkocht
 * product/maat; de voorraad-sync roept processStockNotifications() aan en mailt
 * zodra het er weer is. Env-gated op Resend (zonder mailinfra: alleen opslaan).
 */

export async function createStockNotification(input: {
  email: string;
  productHandle: string;
  productTitle?: string;
  sku?: string;
  size?: string;
  color?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(email)) return { ok: false, error: "ongeldig e-mailadres" };
  if (!input.productHandle) return { ok: false, error: "geen product" };
  const db = getDb();
  // Idempotent: zelfde e-mail + product + sku → niet dubbel.
  await db
    .insert(stockNotifications)
    .values({
      email,
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

    const ok = await sendBackInStockEmail(n, site);
    if (ok) {
      await db
        .update(stockNotifications)
        .set({ status: "notified", notifiedAt: sql`now()` })
        .where(eq(stockNotifications.id, n.id));
      sent++;
    }
  }
  return sent;
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
        html: `<p>Goed nieuws!</p><p><strong>${title}</strong>${maat} is weer op voorraad. Wees er snel bij — op = op.</p><p><a href="${url}" style="display:inline-block;background:#0A0A0A;color:#fff;padding:12px 20px;text-decoration:none">Bekijk product</a></p>`,
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
