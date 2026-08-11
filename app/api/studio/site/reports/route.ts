import { NextResponse } from "next/server";
import { adminOrToken, rangeFromQuery } from "@/lib/studio-token";
import {
  getKpis, topProducts, revenueByCategory, statusDistribution,
  voucherGiftcardImpact, newsletterStats, reviewStats, returnsReport, topCustomers,
} from "@/lib/reports";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/studio/site/reports?from&to&customers=1 — de cijfers die de portal-
 * rapportagepagina toont: KPI's, top-producten, omzet per categorie,
 * statusverdeling, voucher-/cadeaubon-impact, nieuwsbrief, reviews, retouren.
 *
 * Vult het gat naast /api/studio/site/analytics: dat endpoint levert de
 * grafieken (omzet per dag, categorieën, retentie, funnel), dit levert de
 * tabellen en tegels. Samen dekken ze wat de Site-studio onder "Meten" had.
 *
 * De top-50 klanten zit ACHTER ?customers=1 en niet standaard in het antwoord:
 * dat zijn namen, e-mailadressen en wat iemand persoonlijk besteed heeft. In de
 * Site-studio hing die sectie aan een eigen recht ("klanten"); hier kan de
 * portal dezelfde scheiding maken door de vlag alleen mee te sturen als de
 * medewerker klantgegevens mag zien. Zonder vlag halen we ze niet eens op.
 *
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  const url = new URL(req.url);
  const range = rangeFromQuery(url, 30);
  const magKlanten = url.searchParams.get("customers") === "1";

  try {
    const [kpis, products, categories, statuses, promo, newsletter, reviews, returns, customers] =
      await Promise.all([
        getKpis(range),
        topProducts(range, 50),
        revenueByCategory(range),
        statusDistribution(range),
        voucherGiftcardImpact(range),
        newsletterStats(),
        reviewStats(),
        returnsReport(range),
        magKlanten ? topCustomers(50) : Promise.resolve([]),
      ]);

    return NextResponse.json({
      ok: true,
      range: { from: range.from.toISOString(), to: range.to.toISOString() },
      kpis,
      products,
      categories,
      statuses,
      promo,
      newsletter,
      reviews,
      returns,
      customers,
      customersIncluded: magKlanten,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
