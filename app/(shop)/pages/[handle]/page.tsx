import type { Metadata } from "next";
import Link from "next/link";
import { StoreLocator, type LocatorStore } from "@/components/stores/store-locator";
import { StorePage } from "@/components/stores/store-page";
import { LandingPage } from "@/components/landing-page";
import { ContentPage, heroForPage } from "@/components/content-page";
import { EtiquetteHub } from "@/components/etiquette-hub";
import { ZakelijkLanding } from "@/components/landings/zakelijk-landing";
import { StudentsLanding } from "@/components/landings/students-landing";
import { KlantenserviceLanding } from "@/components/landings/klantenservice-landing";
import { HerroepingLanding } from "@/components/landings/herroeping-landing";
import { PortableContent } from "@/components/sanity/portable";
import { getStores, getStoreByPageHandle, openStatus } from "@/lib/stores";
import { getMigratedPage } from "@/lib/migrated-pages";
import { getLanding, type Landing } from "@/lib/landings";
import { localeAlternates } from "@/lib/seo";
import { getSanityLanding, getSanityPage, urlForImage, type SanityLanding } from "@/lib/sanity";
import { getHighlights, getCollectionByHandle, getCollectionProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Sanity-landing → component-vorm (afbeeldingen via Sanity-CDN). */
function toLanding(s: SanityLanding): Landing {
  return {
    handle: s.slug,
    eyebrow: s.eyebrow || "",
    title: s.title,
    intro: s.intro || "",
    heroImage: urlForImage(s.heroImage, 1600) || "/brand/brand-impression-interview.jpg",
    sections: (s.sections || []).map((x) => ({
      title: x.title || "",
      body: x.body || "",
      image: x.image ? urlForImage(x.image, 1000) : undefined,
    })),
    shop: (s.shop || []).filter((x) => x.label && x.href).map((x) => ({ label: x.label!, href: x.href! })),
    cta: { label: s.ctaLabel || "Bekijk de collectie", href: s.ctaHref || "/collections" },
    seoDescription: s.seoDescription || "",
  };
}

const KNOWN_TITLES: Record<string, string> = {
  winkels: "Onze winkels",
  "trouw-afspraak": "Trouwafspraak maken",
  students: "Voor studenten & verenigingen",
  zakelijk: "GENTS Zakelijk",
  uitvaartkleding: "Uitvaartkleding",
  "werken-bij-gents": "Werken bij GENTS",
};

async function getCollectionProductsSafe(handle: string, limit: number) {
  try {
    const c = await getCollectionByHandle(handle);
    if (!c) return [];
    const { items } = await getCollectionProducts(c.id, 1, limit);
    return items;
  } catch {
    return [];
  }
}

function fallbackTitle(handle: string): string {
  return KNOWN_TITLES[handle] || handle.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  if (handle === "klantenservice" || handle === "service")
    return {
      title: "Klantenservice — we staan voor je klaar",
      description: "Vragen over je bestelling, maat of retour? De GENTS-klantenservice helpt je snel en persoonlijk — via de assistent, per mail of in één van onze 19 winkels.",
      alternates: await localeAlternates(`/pages/${handle}`),
    };
  if (handle === "herroepingsformulier")
    return {
      title: "Modelformulier voor herroeping",
      description: "Het wettelijke modelformulier voor herroeping van je GENTS-bestelling — 14 dagen bedenktijd.",
      alternates: await localeAlternates(`/pages/${handle}`),
    };
  const store = getStoreByPageHandle(handle);
  if (store) return { title: `GENTS ${store.city} — herenmode & pakken`, alternates: await localeAlternates(`/pages/${handle}`) };

  const sanityLanding = await getSanityLanding(handle);
  const landing = sanityLanding ? toLanding(sanityLanding) : getLanding(handle);
  if (landing)
    return { title: landing.title, description: landing.seoDescription, alternates: await localeAlternates(`/pages/${handle}`) };

  const sanityPage = await getSanityPage(handle);
  if (sanityPage)
    return { title: sanityPage.title, description: sanityPage.seoDescription, alternates: await localeAlternates(`/pages/${handle}`) };
  const mp = getMigratedPage(handle);
  if (mp) return { title: mp.title, alternates: await localeAlternates(`/pages/${handle}`) };
  return { title: fallbackTitle(handle), robots: { index: false } };
}

export default async function GenericPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

  // 0. Etiquette-hub — speciale overzichtspagina
  if (handle === "etiquette") return <EtiquetteHub />;

  // 0a. Klantenservice — rijke servicepagina (AI-assistent + contact + FAQ)
  if (handle === "klantenservice" || handle === "service") return <KlantenserviceLanding />;

  // 0a2. Wettelijk modelformulier voor herroeping
  if (handle === "herroepingsformulier") return <HerroepingLanding />;

  // 0b. Zakelijk / Students — rijke landings met productstrips + contactformulier
  if (handle === "zakelijk") {
    const [businessSuits, businessShirts] = await Promise.all([
      getCollectionProductsSafe("mix-match-pakken", 4),
      getCollectionProductsSafe("business-overhemden", 4),
    ]);
    return <ZakelijkLanding businessSuits={businessSuits} businessShirts={businessShirts} />;
  }
  if (handle === "students") {
    const highlights = await getCollectionProductsSafe("gala", 8);
    return <StudentsLanding highlights={highlights} />;
  }

  // 1. Winkeloverzicht
  if (handle === "winkels") {
    const stores: LocatorStore[] = getStores().map((s) => {
      const st = openStatus(s);
      return {
        pageHandle: s.pageHandle,
        title: s.title,
        city: s.city,
        address: s.address,
        phone: s.phone,
        open: st.open,
        todayRange: st.todayRange,
      };
    });
    return (
      <div className="mx-auto max-w-page px-gutter py-12">
        <p className="label-brand">Bezoek ons</p>
        <h1 className="mt-2 text-display-lg">Onze winkels</h1>
        <p className="mt-4 max-w-2xl font-sans text-ink-soft">
          Persoonlijk advies, pasvorm-expertise en het complete assortiment —
          kom langs in één van onze {getStores().length} winkels in Nederland en
          België.
        </p>
        <div className="mt-10">
          <StoreLocator stores={stores} />
        </div>
      </div>
    );
  }

  // 2. Individuele winkelpagina
  const store = getStoreByPageHandle(handle);
  if (store) return <StorePage store={store} />;

  // 3. Storytelling-landing — Sanity wint van de statische versie
  const sanityLanding = await getSanityLanding(handle);
  const landing = sanityLanding ? toLanding(sanityLanding) : getLanding(handle);
  if (landing) return <LandingPage landing={landing} />;

  // 4. Content-pagina — Sanity (Portable Text of overgenomen HTML) wint van migrated
  const sanityPage = await getSanityPage(handle);
  if (sanityPage) {
    return (
      <ContentPage title={sanityPage.title} image={heroForPage(handle, sanityPage.title)}>
        {sanityPage.body?.length ? (
          <PortableContent value={sanityPage.body} />
        ) : sanityPage.legacyHtml ? (
          <div className="prose-gents" dangerouslySetInnerHTML={{ __html: sanityPage.legacyHtml }} />
        ) : null}
      </ContentPage>
    );
  }
  const mp = getMigratedPage(handle);
  if (mp) {
    return (
      <ContentPage title={mp.title} image={heroForPage(handle, mp.title)}>
        <div className="prose-gents" dangerouslySetInnerHTML={{ __html: mp.html }} />
      </ContentPage>
    );
  }

  // 4. Nog te bouwen
  return (
    <div className="mx-auto max-w-page px-gutter py-20">
      <div className="max-w-xl">
        <p className="label-brand">Binnenkort</p>
        <h1 className="mt-2 text-display-md">{fallbackTitle(handle)}</h1>
        <p className="mt-4 font-sans text-ink-soft">
          Deze pagina wordt binnenkort toegevoegd. Bekijk ondertussen ons
          assortiment of vraag onze stylisten om advies.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/collections/pakken" className="btn-primary">Shop pakken</Link>
          <Link href="/" className="btn-ghost">Naar home</Link>
        </div>
      </div>
    </div>
  );
}
