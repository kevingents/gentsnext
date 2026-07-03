import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StoreLocator, type LocatorStore } from "@/components/stores/store-locator";
import { StorePage } from "@/components/stores/store-page";
import { LandingPage } from "@/components/landing-page";
import { ContentPage, heroForPage } from "@/components/content-page";
import { RichArticle } from "@/components/rich-article";
import { EtiquetteHub } from "@/components/etiquette-hub";
import { ZakelijkLanding } from "@/components/landings/zakelijk-landing";
import { StudentsLanding } from "@/components/landings/students-landing";
import { KlantenserviceLanding } from "@/components/landings/klantenservice-landing";
import { HerroepingLanding } from "@/components/landings/herroeping-landing";
import { getStores, getStoreByPageHandle, openStatus } from "@/lib/stores";
import { getMigratedPage } from "@/lib/migrated-pages";
import { getStorePage } from "@/lib/content-pages";
import { PageBody } from "@/components/page-body";
import { getLanding } from "@/lib/landings";
import { getLocalizedLanding } from "@/lib/landings-i18n";
import { getLocale } from "@/lib/locale-server";
import { localeAlternates } from "@/lib/seo";
import { getHighlights, getCollectionByHandle, getCollectionProducts } from "@/lib/catalog";

export const dynamic = "force-dynamic";

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

  const storePage = await getStorePage(handle);
  if (storePage)
    return { title: storePage.title, description: storePage.seoDescription, alternates: await localeAlternates(`/pages/${handle}`) };

  const landing = getLanding(handle);
  if (landing)
    return { title: landing.title, description: landing.seoDescription, alternates: await localeAlternates(`/pages/${handle}`) };

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

  // 2b. Eigen content-pagina (portal-beheerd, content:pages) — wint van Sanity/migrated.
  const storePage = await getStorePage(handle);
  if (storePage) {
    return (
      <ContentPage title={storePage.title} image={storePage.image || heroForPage(handle, storePage.title)}>
        <PageBody body={storePage.body} />
      </ContentPage>
    );
  }

  // 3. Statische storytelling-landing.
  const landing = getLanding(handle);
  if (landing) return <LandingPage landing={await getLocalizedLanding(landing, await getLocale())} />;

  // 4. Overgenomen content-pagina (migrated).
  const mp = getMigratedPage(handle);
  if (mp) {
    // Bespoke structuur-classes (dresscode-/gelegenheidspagina's) → gents-doc-styling
    // (kaarten, kolommen, highlight/tip-boxen) onder een beeld-hero.
    if (/class=["']gents-/.test(mp.html)) {
      return (
        <ContentPage title={mp.title} image={heroForPage(handle, mp.title)}>
          <div className="gents-doc" dangerouslySetInnerHTML={{ __html: mp.html }} />
        </ContentPage>
      );
    }
    // ≥2 koppen → visuele RichArticle (hero + iconen + beeld/tekst-secties + CTA);
    // anders de eenvoudige content-template.
    const h2count = (mp.html.match(/<h2/gi) || []).length;
    if (h2count >= 2) {
      return <RichArticle handle={handle} title={mp.title} html={mp.html} heroImage={heroForPage(handle, mp.title)} />;
    }
    return (
      <ContentPage title={mp.title} image={heroForPage(handle, mp.title)}>
        <div className="prose-gents" dangerouslySetInnerHTML={{ __html: mp.html }} />
      </ContentPage>
    );
  }

  // 4. Onbekende slug (geen vaste pagina én geen CMS-content) → echte 404 i.p.v. een
  // soft-404 (200). Voorkomt dat willekeurige /pages/*-URL's als geldig gelden voor
  // crawlers/linkcheckers en dat typefouten in interne links onopgemerkt blijven.
  notFound();
}
