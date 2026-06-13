import "@/lib/load-env";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "next-sanity";
import { projectId, dataset, apiVersion } from "@/sanity/env";
import { LANDINGS } from "@/lib/landings";

/**
 * Eenmalige import van de huidige content in Sanity, zodat marketeers met de
 * echte pagina's beginnen. Vereist NEXT_PUBLIC_SANITY_PROJECT_ID + een
 * schrijf-token SANITY_API_TOKEN (Editor/Deploy). Idempotent (createOrReplace).
 *   npm run sanity:seed
 */
const token = process.env.SANITY_API_KEY || process.env.SANITY_API_TOKEN;
if (!projectId || !token) {
  console.error("Zet NEXT_PUBLIC_SANITY_PROJECT_ID en SANITY_API_KEY voordat je seedt.");
  process.exit(1);
}

const client = createClient({ projectId, dataset, apiVersion, token, useCdn: false });

const assetCache = new Map<string, string>();
async function uploadImage(publicPath: string): Promise<any | undefined> {
  if (!publicPath) return undefined;
  if (assetCache.has(publicPath)) return imageRef(assetCache.get(publicPath)!);
  try {
    const buf = readFileSync(join(process.cwd(), "public", publicPath.replace(/^\//, "")));
    const asset = await client.assets.upload("image", buf, { filename: publicPath.split("/").pop() });
    assetCache.set(publicPath, asset._id);
    return imageRef(asset._id);
  } catch (e) {
    console.warn(`  afbeelding overslaan (${publicPath}): ${(e as Error).message}`);
    return undefined;
  }
}
function imageRef(id: string) {
  return { _type: "image", asset: { _type: "reference", _ref: id } };
}
const key = () => Math.random().toString(36).slice(2, 10);

async function main() {
  // Landings
  for (const l of Object.values(LANDINGS)) {
    const hero = await uploadImage(l.heroImage);
    const sections = [];
    for (const s of l.sections) {
      sections.push({ _key: key(), _type: "section", title: s.title, body: s.body, image: s.image ? await uploadImage(s.image) : undefined });
    }
    await client.createOrReplace({
      _id: `landing.${l.handle}`,
      _type: "landing",
      title: l.title,
      slug: { _type: "slug", current: l.handle },
      eyebrow: l.eyebrow,
      intro: l.intro,
      heroImage: hero,
      sections,
      shop: l.shop.map((x) => ({ _key: key(), _type: "link", label: x.label, href: x.href })),
      ctaLabel: l.cta.label,
      ctaHref: l.cta.href,
      seoDescription: l.seoDescription,
    });
    console.log(`landing: ${l.handle}`);
  }

  // Gemigreerde pagina's → page-docs met legacyHtml
  const migrated = JSON.parse(readFileSync(join(process.cwd(), "content", "migrated-pages.json"), "utf8")) as Record<
    string,
    { title: string; html: string }
  >;
  for (const [handle, p] of Object.entries(migrated)) {
    await client.createOrReplace({
      _id: `page.${handle}`,
      _type: "page",
      title: p.title,
      slug: { _type: "slug", current: handle },
      legacyHtml: p.html,
    });
    console.log(`page: ${handle}`);
  }

  console.log("\nKlaar. Open /studio om de content te beheren.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
