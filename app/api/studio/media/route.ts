import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { getSessionCustomer } from "@/lib/account";
import { getSiteUrl } from "@/lib/site-url";
import { newCollectionCond } from "@/lib/new-collection";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/studio/media — "GENTS-studio" beeldbank-bron.
 *
 * Geeft álle AI-gegenereerde media terug die de generators maken (modelfoto's,
 * sfeerbeelden, detailcrops en video's), per product gegroepeerd. Bedoeld om in
 * de portal-beeldbank (andere repo) als tweede bron getoond + gedownload te
 * worden — die beelden staan namelijk in gentsnext (Neon + Vercel Blob), niet in
 * de Shopify-product-cache waar de bestaande beeldbank uit leest.
 *
 * Auth: gentsnext-admin-sessie (getSessionCustomer().isAdmin) OF een server-to-
 * server token (Authorization: Bearer <STUDIO_API_TOKEN> / x-studio-token), zodat
 * de portal het headless kan ophalen. Zonder token én zonder admin → 403.
 *
 * Query:
 *   type        packshot | ai-packshot | model | sfeer | detail | video
 *   hoofdgroep  exacte hoofdgroep-omschrijving
 *   new         '1' = alleen nieuwe collectie
 *   website     '1' = alleen producten die NU op de website staan, '0' = alleen
 *               producten die er niet op staan, leeg = allebei
 *   q           vrije zoekterm (titel / handle / hoofdgroep)
 */

type AssetType = "packshot" | "ai-packshot" | "model" | "sfeer" | "detail" | "video";
const TYPE_LABEL: Record<AssetType, string> = {
  packshot: "Productfoto",
  "ai-packshot": "AI-packshot",
  model: "Modelfoto",
  sfeer: "Sfeerbeeld",
  detail: "Detailfoto",
  video: "Video",
};

function tokenOk(req: Request): boolean {
  const want = (process.env.STUDIO_API_TOKEN || "").trim();
  if (!want) return false;
  const got = (req.headers.get("authorization") || req.headers.get("x-studio-token") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  return !!got && got === want;
}

/** Knip de cache-bust-query eraf voor een nette bestandsnaam-bron. */
function bareUrl(u: string): string {
  return String(u || "").split("?")[0];
}

export async function GET(req: Request) {
  const customer = await getSessionCustomer().catch(() => null);
  if (!customer?.isAdmin && !tokenOk(req)) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }

  const sp = new URL(req.url).searchParams;
  const fType = (sp.get("type") || "").trim() as AssetType | "";
  const fHg = (sp.get("hoofdgroep") || "").trim();
  const onlyNew = sp.get("new") === "1";
  // "Staat dit product nu op de website?" — dat is méér dan status='active': de
  // winkel eist ook een foto, voorraad en dat het de groeps-primaire is. Een
  // product kan dus actief zijn en toch nergens te vinden.
  const fWebsite = (sp.get("website") || "").trim(); // "1" | "0" | ""
  const q = (sp.get("q") || "").trim().toLowerCase();

  const newColl = onlyNew ? sql`and ${newCollectionCond}` : sql``;

  const db = getDb();
  const rows = (
    await db.execute<{
      handle: string;
      title: string;
      hoofdgroep: string | null;
      seizoen: string | null;
      m1: string;
      m2: string;
      l1: string;
      l2: string;
      l3: string;
      det: string;
      vid: string;
      packshot: string;
      packshot_ai: boolean;
      op_website: boolean;
    }>(sql`
      select p.handle, p.title,
        p.attributes->>'hoofdgroep_omschrijving' hoofdgroep,
        p.attributes->>'seizoen' seizoen,
        p.model_image_url m1, p.model_image_url2 m2,
        p.lifestyle_image_url l1, p.lifestyle_image_url2 l2, p.lifestyle_image_url3 l3,
        p.detail_image_url det, p.model_video_url vid,
        (select url from product_images pi where pi.product_id=p.id order by position limit 1) packshot,
        -- Is de eerste productfoto door AI verzonnen? Dan is het geen echte
        -- productfoto en moet je 'm apart kunnen vinden (en weghalen).
        coalesce((select pi.source='ai-packshot' from product_images pi
                  where pi.product_id=p.id order by pi.position limit 1), false) packshot_ai,
        -- Exact de voorwaarden die de winkel zelf stelt (zie lib/catalog.ts).
        (p.status='active' and p.has_image and p.in_stock and p.is_group_primary) op_website
      from products p
      where p.status='active' and p.is_group_primary
        and (p.model_image_url<>'' or p.model_image_url2<>'' or p.lifestyle_image_url<>''
          or p.lifestyle_image_url2<>'' or p.lifestyle_image_url3<>''
          or p.detail_image_url<>'' or p.model_video_url<>''
          -- Ook producten wier énige beeld een AI-packshot is: die stonden hier
          -- niet in, terwijl dat juist het beeld is dat je wilt kunnen vinden.
          or exists (select 1 from product_images pi
                     where pi.product_id=p.id and pi.source='ai-packshot'))
        ${newColl}
      order by p.stock_qty desc nulls last, p.title`)
  ).rows;

  const base = getSiteUrl();
  const counts: Record<AssetType, number> = { packshot: 0, "ai-packshot": 0, model: 0, sfeer: 0, detail: 0, video: 0 };
  // Hoeveel van de getoonde producten staan wel/niet op de website.
  let opWebsiteWel = 0;
  let opWebsiteNiet = 0;
  const hgMap = new Map<string, number>();
  const items: Array<{
    productId: string;
    handle: string;
    title: string;
    hoofdgroep: string;
    seizoen: string;
    /** Staat dit product nu daadwerkelijk op de website? (actief + foto + voorraad + primair) */
    opWebsite: boolean;
    url: string;
    image: string;
    assets: { type: AssetType; url: string; label: string }[];
    imagesCount: number;
    videoCount: number;
  }> = [];

  for (const r of rows) {
    const hoofdgroep = (r.hoofdgroep || "").trim();

    // Bouw de asset-lijst: packshot (echte productfoto) + AI: model 1/2, sfeer 1/2/3, detail, video.
    let assets: { type: AssetType; url: string; label: string }[] = [];
    const push = (type: AssetType, url: string, label: string) => {
      if (url && url.trim()) assets.push({ type, url, label });
    };
    push(r.packshot_ai ? "ai-packshot" : "packshot", r.packshot, r.packshot_ai ? "AI-packshot (geen echte foto)" : "Productfoto");
    push("model", r.m1, "Modelfoto");
    push("model", r.m2, "Modelfoto 2");
    push("sfeer", r.l1, "Sfeerbeeld 1");
    push("sfeer", r.l2, "Sfeerbeeld 2");
    push("sfeer", r.l3, "Sfeerbeeld 3");
    push("detail", r.det, "Detailfoto");
    push("video", r.vid, "Video");

    if (fType) assets = assets.filter((a) => a.type === fType);
    if (!assets.length) continue;

    if (fWebsite === "1" && !r.op_website) continue;
    if (fWebsite === "0" && r.op_website) continue;
    if (fHg && hoofdgroep !== fHg) continue;
    if (q) {
      const hay = `${r.title} ${r.handle} ${hoofdgroep}`.toLowerCase();
      if (!hay.includes(q)) continue;
    }

    for (const a of assets) counts[a.type]++;
    if (hoofdgroep) hgMap.set(hoofdgroep, (hgMap.get(hoofdgroep) || 0) + 1);

    // Thumbnail: liefst een modelfoto, anders sfeer, anders packshot, anders detail.
    const thumb =
      assets.find((a) => a.type === "model")?.url ||
      assets.find((a) => a.type === "sfeer")?.url ||
      assets.find((a) => a.type === "packshot")?.url ||
      assets.find((a) => a.type === "detail")?.url ||
      "";

    if (r.op_website) opWebsiteWel++; else opWebsiteNiet++;
    items.push({
      productId: r.handle,
      handle: r.handle,
      title: (r.title || "").trim() || r.handle,
      hoofdgroep,
      seizoen: (r.seizoen || "").trim(),
      /** Staat dit product nu daadwerkelijk op de website? (actief + foto + voorraad + primair) */
      opWebsite: r.op_website,
      url: `${base}/products/${r.handle}`,
      image: thumb,
      assets,
      imagesCount: assets.filter((a) => a.type !== "video").length,
      videoCount: assets.filter((a) => a.type === "video").length,
    });
  }

  const hoofdgroepen = [...hgMap.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "nl"));

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    total: items.length,
    assetsTotal: counts.packshot + counts["ai-packshot"] + counts.model + counts.sfeer + counts.detail + counts.video,
    counts,
    /** Verdeling van de getoonde producten over wel/niet op de website — zodat de
     *  beeldbank kan laten zien hoeveel er achter het filter zitten. */
    website: { opWebsite: opWebsiteWel, nietOpWebsite: opWebsiteNiet },
    hoofdgroepen,
    items,
    // Handige platte lijst van álle (gefilterde) URL's — voor "download alles als ZIP".
    allUrls: items.flatMap((it) => it.assets.map((a) => bareUrl(a.url))),
  });
}
