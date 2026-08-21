import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { coreAuth } from "@/lib/store-core-token";
import { createPosCustomer, updatePosCustomer, defaultAddressForCustomer, getProfileData } from "@/lib/account";
import { resolveKlantIdentiteit } from "@/lib/vouchers";
import { listOrdersByCustomerCore } from "@/lib/orders";
import { listPosSalesByCustomerCore } from "@/lib/pos-sales-core";
import { getDb } from "@/db";
import { customers } from "@/db/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/core/customer — gents.nl-klant vanaf de kassa/scanner. Auth: STORE_CORE_TOKEN.
 *
 *   create   { email, firstName?, lastName?, phone? }
 *     → { ok, customer:{ customerId, email, name, firstName, lastName, phone } }
 *   update   { customerId, firstName?, lastName?, email?, phone? }  (kassa-correctie)
 *     → { ok, customer:{…}, changed:[velden], previous:{…} }   — de aanroeper logt
 *   overview { customerId?, email?, limit? }   (360-beeld voor het kassa-klantpaneel)
 *     → { ok, orders:[…online, met regels+beeld…], sales:[…ruwe kassa-bonnen…],
 *         winkelaankopen:[…POS+SRS ontdubbeld…]|null, giftcards:[{code,balanceCents,expiresAt}],
 *         retouren:[…], adres:{straat…}|null, maatprofiel:{colbert,broek,…}|null }
 */
export async function POST(req: Request) {
  if (!(await coreAuth(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: { action?: string; email?: string; firstName?: string; lastName?: string; phone?: string; customerId?: string; limit?: number; street?: string; houseNumber?: string; postalCode?: string; city?: string };
  try { b = (await req.json()) as typeof b; } catch { return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 }); }
  const action = String(b?.action || "");

  try {
    if (action === "create") {
      const c = await createPosCustomer({ email: b.email || "", firstName: b.firstName, lastName: b.lastName, phone: b.phone });
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      return NextResponse.json({
        ok: true,
        customer: { customerId: c.id, email: c.email, name, firstName: c.firstName || "", lastName: c.lastName || "", phone: c.phone || "" },
        /* 0 als de klant al bestond. De kassa kan hiermee "welkom, +50 punten"
           tonen of op de bon zetten — zonder dat de kassa de regel hoeft te kennen. */
        welkomstpunten: c.welkomstpunten ?? 0,
      });
    }
    if (action === "update") {
      const r = await updatePosCustomer(String(b.customerId || ""), {
        firstName: b.firstName, lastName: b.lastName, email: b.email, phone: b.phone,
        street: b.street, houseNumber: b.houseNumber, postalCode: b.postalCode, city: b.city,
      });
      const c = r.updated as Record<string, unknown> & typeof r.updated;
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      return NextResponse.json({
        ok: true,
        changed: r.changed,
        /* previous alléén van de gewijzigde velden: genoeg voor een audit-regel
           "van X naar Y", zonder het hele klantrecord terug te sturen. */
        previous: Object.fromEntries(r.changed.map((k) => [k, (r.previous as unknown as Record<string, unknown>)[k] ?? ""])),
        customer: {
          customerId: c.id, email: c.email, name, firstName: c.firstName || "", lastName: c.lastName || "", phone: c.phone || "",
          street: String(c.street || ""), houseNumber: String(c.houseNumber || ""), postalCode: String(c.postalCode || ""), city: String(c.city || ""),
        },
      });
    }
    if (action === "overview") {
      /* Het 360-beeld voor de kassa-klantkaart. Met een gents.nl-account komt
         alles uit getProfileData — dezelfde samenstelling als 'Mijn GENTS',
         inclusief de POS+SRS-ontdubbeling van winkelaankopen en productbeeld.
         Zonder account (pure SRS-klant) blijft het bij het oude, smallere beeld. */
      const lim = Math.max(1, Math.min(50, Number(b.limit) || 20));
      const { uuid, email: mail } = await resolveKlantIdentiteit({ customerId: b.customerId, email: b.email });
      const sales = await listPosSalesByCustomerCore({ customerId: b.customerId, email: b.email, limit: b.limit });

      if (!uuid) {
        const [orders, adres] = await Promise.all([
          listOrdersByCustomerCore({ customerId: b.customerId, email: b.email, limit: b.limit }),
          defaultAddressForCustomer({ customerId: b.customerId, email: b.email }),
        ]);
        return NextResponse.json({ ok: true, orders, sales, adres, winkelaankopen: null, giftcards: [], retouren: [], maatprofiel: null });
      }

      const [profiel, [klantRij]] = await Promise.all([
        getProfileData(uuid, mail),
        getDb().select({ sizeProfile: customers.sizeProfile }).from(customers).where(eq(customers.id, uuid)).limit(1),
      ]);
      const regel = (l: { title?: string | null; size?: string | null; color?: string | null; qty?: number; quantity?: number; unitPriceCents?: number | null; sku?: string | null; imageUrl?: string }) => ({
        title: String(l.title || ""), size: String(l.size || ""), color: String(l.color || ""),
        qty: Number(l.qty ?? l.quantity) || 1, unitPriceCents: Number(l.unitPriceCents) || 0,
        sku: String(l.sku || ""), imageUrl: String(l.imageUrl || ""),
      });
      const KASSA_ORDER_WEG = ["open", "failed", "expired", "canceled"];
      return NextResponse.json({
        ok: true,
        orders: profiel.onlineOrders
          .filter((o) => !KASSA_ORDER_WEG.includes(String(o.status)))
          .slice(0, lim)
          .map((o) => ({
            orderNumber: o.orderNumber, status: o.status, totalCents: o.totalCents,
            createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : "",
            lines: o.lines.map(regel),
          })),
        sales,
        /* Winkelaankopen = eigen kassabonnen + SRS-import, ontdubbeld op bonnummer
           (de kassa boekt naar SRS; de import haalt dezelfde bon later op). */
        winkelaankopen: profiel.storeBuys.slice(0, lim).map((s) => ({
          id: s.id, storeName: s.storeName, kind: s.kind, receiptRef: s.receiptRef,
          purchasedAt: s.purchasedAt ? new Date(s.purchasedAt).toISOString() : "",
          totalCents: s.totalCents,
          lines: s.lines.map(regel),
        })),
        giftcards: profiel.giftcards
          .filter((g) => g.status === "active" && g.balanceCents > 0)
          .map((g) => ({ code: g.code, balanceCents: g.balanceCents, expiresAt: g.expiresAt ? new Date(g.expiresAt).toISOString() : null })),
        retouren: profiel.returns.slice(0, 10).map((r) => ({
          orderNumber: r.orderNumber, status: r.status, refundType: r.refundType,
          itemsCents: r.itemsCents, refundedCents: r.refundedCents,
          createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : "",
          lines: r.lines,
        })),
        adres: profiel.addresses[0]
          ? {
              street: String(profiel.addresses[0].street || ""), houseNumber: String(profiel.addresses[0].houseNumber || ""),
              postalCode: String(profiel.addresses[0].postalCode || ""), city: String(profiel.addresses[0].city || ""),
            }
          : null,
        maatprofiel: (klantRij?.sizeProfile as Record<string, string> | null) || null,
      });
    }
    return NextResponse.json({ ok: false, error: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
