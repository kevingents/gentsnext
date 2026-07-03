import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import {
  getKpis,
  retentionReport,
  revenueByCategory,
  funnel,
  reviewStats,
  voucherGiftcardImpact,
  newsletterStats,
} from "@/lib/reports";

/**
 * AI-klantinzichten voor de portal. Verzamelt GEAGGREGEERDE statistieken (geen
 * PII) en laat Claude er een strategisch narratief van maken: kansen, risico's
 * en concrete acties. Stats worden live berekend; het narratief wordt gecachet
 * (app_settings.aiInsights) en alleen op verzoek opnieuw gegenereerd.
 */

export type InsightStats = {
  period: string;
  revenueEuro: number;
  orders: number;
  aovEuro: number;
  newCustomers: number;
  itemsSold: number;
  refundOrders: number;
  revenueTrendPct: number | null;
  ordersTrendPct: number | null;
  retention: { customers: number; repeatPct: number; avgOrders: number };
  topCategories: { category: string; revenueEuro: number; qty: number }[];
  funnel: { productView: number; addToCart: number; checkoutStart: number; purchase: number; viewToCartPct: number; checkoutToPurchasePct: number };
  reviews: { published: number; avg: number; pending: number };
  loyalty: { voucherDiscountEuro: number; giftcardsSold: number; giftcardRedeemedEuro: number };
  newsletter: { email: number; whatsapp: number };
};

export type InsightNarrative = {
  headline: string;
  opportunities: string[];
  risks: string[];
  actions: string[];
};

// Hele euro's voor prompt-stats (géén formatter — naam voorkomt verwarring met formatEuro).
const toWholeEuros = (cents: number) => Math.round((Number(cents) || 0) / 100);
const euro = toWholeEuros;
const pctChange = (cur: number, prev: number): number | null => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);

export async function gatherInsightStats(now: Date): Promise<InsightStats> {
  const day = 86400000;
  const last30 = { from: new Date(now.getTime() - 30 * day), to: now };
  const prev30 = { from: new Date(now.getTime() - 60 * day), to: new Date(now.getTime() - 30 * day) };

  const [kpi, kpiPrev, ret, cats, fun, rev, vg, nl] = await Promise.all([
    getKpis(last30),
    getKpis(prev30),
    retentionReport(),
    revenueByCategory(last30),
    funnel(30),
    reviewStats(),
    voucherGiftcardImpact(last30),
    newsletterStats(),
  ]);

  return {
    period: "laatste 30 dagen",
    revenueEuro: euro(kpi.revenueCents),
    orders: kpi.orders,
    aovEuro: euro(kpi.aovCents),
    newCustomers: kpi.newCustomers,
    itemsSold: kpi.itemsSold,
    refundOrders: kpi.refundOrders,
    revenueTrendPct: pctChange(kpi.revenueCents, kpiPrev.revenueCents),
    ordersTrendPct: pctChange(kpi.orders, kpiPrev.orders),
    retention: { customers: ret.overall.customers, repeatPct: ret.overall.repeatPct, avgOrders: ret.overall.avgOrders },
    topCategories: cats.slice(0, 5).map((c) => ({ category: c.category, revenueEuro: euro(c.revenueCents), qty: c.qty })),
    funnel: {
      productView: fun.productView,
      addToCart: fun.addToCart,
      checkoutStart: fun.checkoutStart,
      purchase: fun.purchase,
      viewToCartPct: ratio(fun.addToCart, fun.productView),
      checkoutToPurchasePct: ratio(fun.purchase, fun.checkoutStart),
    },
    reviews: rev,
    loyalty: {
      voucherDiscountEuro: euro(vg.discountCents),
      giftcardsSold: vg.giftcardsSold,
      giftcardRedeemedEuro: euro(vg.giftcardRedeemedCents),
    },
    newsletter: nl,
  };
}

async function generateNarrative(stats: InsightStats): Promise<InsightNarrative | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const system = `Je bent een nuchtere retail-analist voor GENTS Herenmode (premium menswear, NL). Je krijgt GEAGGREGEERDE webshop-statistieken (geen persoonsgegevens). Geef bondige, concrete inzichten in het Nederlands, gebaseerd UITSLUITEND op de cijfers — verzin niets en wees eerlijk over onzekerheid bij lage aantallen. Antwoord ALLEEN met JSON:
{"headline":"1 zin met de belangrijkste observatie","opportunities":["kort, concreet"],"risks":["kort, concreet"],"actions":["concrete, uitvoerbare actie"]}
Max 4 items per lijst, elk max ~14 woorden. Acties moeten praktisch zijn voor een webshop-team (marketing/merchandising/retentie).`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.CONTENT_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 800,
        system,
        messages: [{ role: "user", content: JSON.stringify(stats) }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = j?.content?.[0]?.text || "";
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const p = JSON.parse(m[0]);
    const arr = (x: unknown) => (Array.isArray(x) ? x.map((s) => String(s).slice(0, 160)).filter(Boolean).slice(0, 4) : []);
    if (typeof p.headline !== "string") return null;
    return { headline: String(p.headline).slice(0, 240), opportunities: arr(p.opportunities), risks: arr(p.risks), actions: arr(p.actions) };
  } catch {
    return null;
  }
}

export type InsightsResult = { stats: InsightStats; narrative: InsightNarrative | null; generatedAt: string | null };

export async function getInsights(now: Date, opts: { regenerate?: boolean } = {}): Promise<InsightsResult> {
  const stats = await gatherInsightStats(now);
  const db = getDb();

  let narrative: InsightNarrative | null = null;
  let generatedAt: string | null = null;

  if (!opts.regenerate) {
    try {
      const rows = await db.select().from(appSettings).where(eq(appSettings.id, "aiInsights")).limit(1);
      const cached = rows[0]?.data as { narrative?: InsightNarrative; generatedAt?: string } | undefined;
      if (cached?.narrative) {
        narrative = cached.narrative;
        generatedAt = cached.generatedAt ?? null;
      }
    } catch {
      /* geen cache */
    }
  }

  if (opts.regenerate || !narrative) {
    const fresh = await generateNarrative(stats);
    if (fresh) {
      narrative = fresh;
      generatedAt = now.toISOString();
      try {
        const data = { narrative: fresh, generatedAt };
        await db
          .insert(appSettings)
          .values({ id: "aiInsights", data, updatedAt: sql`now()` })
          .onConflictDoUpdate({ target: appSettings.id, set: { data, updatedAt: sql`now()` } });
      } catch {
        /* cache-schrijven mag niet breken */
      }
    }
  }

  return { stats, narrative, generatedAt };
}
