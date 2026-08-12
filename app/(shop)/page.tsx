import { UspBar } from "@/components/usp-bar";
import { RecentStrip } from "@/components/recent/recent-strip";
import { ForYouStrip } from "@/components/home/for-you-strip";
import { TrustBlock } from "@/components/home/trust-block";
import { VideoHero } from "@/components/home/video-hero";
import { ProductStrip, OccasionTiles, HomeBanner, CategoryTiles, LookTeaser } from "@/components/home/sections";
import { JsonLd } from "@/components/json-ld";
import { getStores } from "@/lib/stores";
import { getSiteUrl } from "@/lib/site-url";
import { getLocalizedSiteSettings } from "@/lib/site-settings-i18n";
import { getHighlights, getProductsByHandles, type ProductCardData } from "@/lib/catalog";
import { getTrendingHandles } from "@/lib/analytics";
import { getAllLooks } from "@/lib/looks";
import { getOccasions } from "@/lib/occasions-server";
import { getHomeLayout, type HomeSection } from "@/lib/homepage";
import { CATEGORIES } from "@/lib/categories";
import { getCategoryLabels } from "@/lib/nav-i18n";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  // NB: Next merget openGraph NIET diep — dit object VERVANGT de root-layout-openGraph
  // volledig, dus type/siteName moeten hier expliciet mee (anders vallen ze weg).
  return { alternates: await localeAlternates("/"), openGraph: { type: "website", siteName: "GENTS", title: "GENTS — Suits You", url: getSiteUrl() } };
}

/**
 * Vertaalsleutels van de blokken die vanaf het begin op de homepage stonden.
 * Zolang een blok in de portal géén eigen tekst heeft, komt de copy hiervandaan
 * en is hij dus in álle talen goed. Typt iemand wél een eigen tekst, dan wint
 * die — in elke taal, want een eigen tekst hoort te doen wat je typt.
 *
 * Een blok dat je zelf toevoegt staat hier niet in en heeft dus eigen tekst
 * nodig; zonder tekst blijft de kop simpelweg leeg in plaats van een sleutel
 * als "home.foo.title" te tonen.
 */
const STANDAARD_TEKST: Record<string, { eyebrow?: string; titel?: string; tekst?: string; link?: string; knop?: string; knop2?: string }> = {
  gelegenheden: { eyebrow: "home.occasions.eyebrow", titel: "home.occasions.title" },
  populair: { eyebrow: "home.trending.eyebrow", titel: "home.trending.title" },
  pakken: { eyebrow: "home.packs.eyebrow", titel: "home.packs.title", link: "home.packs.link" },
  overhemden: { eyebrow: "home.shirts.eyebrow", titel: "home.shirts.title", link: "home.shirts.link" },
  "pak-samenstellen": {
    eyebrow: "home.customSuit.eyebrow", titel: "home.customSuit.title", tekst: "home.customSuit.description",
    knop: "home.customSuit.startButton", knop2: "home.customSuit.sizeGuideButton",
  },
  etiquette: {
    eyebrow: "home.etiquette.eyebrow", titel: "home.etiquette.title", tekst: "home.etiquette.description",
    knop: "home.etiquette.link",
  },
  categorieen: { eyebrow: "home.categories.eyebrow", titel: "home.categories.title", link: "home.categories.link" },
  look: { eyebrow: "home.look.eyebrow", titel: "home.look.title", tekst: "home.look.description", link: "home.look.link" },
};

export default async function Home() {
  const locale = await getLocale();
  const t = await getT(locale);
  const { secties } = await getHomeLayout();
  const zichtbaar = secties.filter((s) => s.aan);
  const heeft = (type: HomeSection["type"]) => zichtbaar.some((s) => s.type === type);

  /** Tekst van een blok: eigen invoer wint, anders de ingebouwde vertaling. */
  const tekstVan = (sec: HomeSection, veld: keyof (typeof STANDAARD_TEKST)[string], eigen?: string): string => {
    if (eigen) return eigen;
    const sleutel = STANDAARD_TEKST[sec.id]?.[veld];
    return sleutel ? t(sleutel) : "";
  };

  // "Populair nu" is een eigen 2-staps-keten (analytics → producten) die niet op
  // de andere reads hoeft te wachten; start 'm concurrent. Alleen als het blok
  // aan staat — anders betaal je voor een strip die niemand ziet.
  const trendingPromise: Promise<ProductCardData[]> = heeft("populair")
    ? (async () => {
        try {
          const handles = await getTrendingHandles(14, 8);
          if (handles.length >= 4) return (await getProductsByHandles(handles)).slice(0, 4);
        } catch {
          /* analytics nog leeg */
        }
        return [];
      })()
    : Promise.resolve([]);

  // Elke productstrip haalt zijn eigen hoofdgroep op. Ruim (8) ophalen: na de
  // trending-await filteren we overlap weg, anders staat hetzelfde nieuwe pak
  // in "Populair nu" én in de strip eronder.
  const stripSecties = zichtbaar.filter((s) => s.type === "producten" && s.hoofdgroep);
  const [settings, occasions, looks, catLabels, ...stripsRuw] = await Promise.all([
    getLocalizedSiteSettings(locale),
    heeft("gelegenheden") ? getOccasions().catch(() => []) : Promise.resolve([]),
    heeft("look") ? getAllLooks().catch(() => []) : Promise.resolve([]),
    heeft("categorieen") ? getCategoryLabels(locale) : Promise.resolve(new Map<string, string>()),
    ...stripSecties.map((s) => getHighlights(s.hoofdgroep!, 8).catch(() => [] as ProductCardData[])),
  ]);

  const trending = await trendingPromise;
  const trendingHandles = new Set(trending.map((p) => p.handle));
  const stripProducten = new Map<string, ProductCardData[]>(
    stripSecties.map((s, i) => [
      s.id,
      (stripsRuw[i] ?? []).filter((p) => !trendingHandles.has(p.handle)).slice(0, 4),
    ]),
  );

  const siteUrl = getSiteUrl();
  const stores = getStores();
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "ClothingStore",
    name: "GENTS Herenmode",
    url: siteUrl,
    logo: `${siteUrl}/brand/brand-logo-zwart.png`,
    image: `${siteUrl}/brand/brand-model-charcoal.jpg`,
    slogan: "Suits You",
    description: "GENTS — dé specialist voor je formele momenten. Pakken, overhemden, smoking en accessoires.",
    department: stores.slice(0, 20).map((s) => ({
      "@type": "ClothingStore",
      name: `GENTS ${s.city}`,
      url: `${siteUrl}/pages/${s.pageHandle}`,
      address: { "@type": "PostalAddress", streetAddress: s.address, addressLocality: s.city, addressCountry: "NL" },
      telephone: s.phone || undefined,
    })),
  };

  function blok(sec: HomeSection) {
    const eyebrow = tekstVan(sec, "eyebrow", sec.eyebrow);
    const titel = tekstVan(sec, "titel", sec.titel);

    switch (sec.type) {
      case "hero":
        return (
          <VideoHero
            videoUrl={settings.hero.videoUrl || ""}
            videoUrlMobile={settings.hero.videoUrlMobile}
            posterUrl={settings.hero.posterUrl}
            eyebrow={settings.hero.eyebrow}
            title={settings.hero.title}
            subtitle={settings.hero.subtitle}
            primary={settings.hero.primary}
            secondary={settings.hero.secondary}
          />
        );

      case "usps":
        return <UspBar usps={settings.usps} />;

      case "voor-jou":
        return <ForYouStrip />;

      case "gelegenheden":
        return (
          <OccasionTiles
            eyebrow={eyebrow}
            titel={titel}
            // Beeld, titel én bestemming komen uit het gelegenheden-document dat
            // de portal al beheert. Vroeger stond hier een losse kopie met een
            // fuzzy zoekopdracht op collectie-namen; "Uitvaart" had geen zoekwoord
            // en landde daardoor altijd op /collections.
            tegels={occasions.map((o) => ({ label: o.title, img: o.image, href: o.ctaHref || "/gelegenheden" }))}
          />
        );

      case "populair":
        return <ProductStrip eyebrow={eyebrow} titel={titel} producten={trending} />;

      case "producten":
        return (
          <ProductStrip
            eyebrow={eyebrow}
            titel={titel}
            linkLabel={tekstVan(sec, "link", sec.linkLabel)}
            linkHref={sec.linkHref}
            producten={stripProducten.get(sec.id) ?? []}
          />
        );

      case "banner":
        return (
          <HomeBanner
            stijl={sec.stijl === "donker" ? "donker" : "licht"}
            afbeelding={sec.afbeelding || ""}
            afbeeldingAlt={sec.afbeeldingAlt || ""}
            eyebrow={eyebrow}
            titel={titel}
            tekst={tekstVan(sec, "tekst", sec.tekst)}
            knopLabel={tekstVan(sec, "knop", sec.knopLabel)}
            knopHref={sec.knopHref}
            knop2Label={tekstVan(sec, "knop2", sec.knop2Label)}
            knop2Href={sec.knop2Href}
          />
        );

      case "categorieen":
        return (
          <CategoryTiles
            eyebrow={eyebrow}
            titel={titel}
            linkLabel={tekstVan(sec, "link")}
            categorieen={CATEGORIES.slice(0, sec.aantal ?? 8).map((c) => ({
              slug: c.slug,
              label: catLabels.get(c.slug) ?? c.label,
            }))}
          />
        );

      case "look": {
        // Een gekozen look die niet (meer) bestaat mag het blok niet laten
        // verdwijnen zonder uitleg — dan valt 'ie terug op de eerste.
        const look = (sec.lookSlug && looks.find((l) => l.slug === sec.lookSlug)) || looks[0] || null;
        return (
          <LookTeaser
            eyebrow={eyebrow}
            titel={titel}
            tekst={tekstVan(sec, "tekst", sec.tekst)}
            linkLabel={tekstVan(sec, "link")}
            look={look}
          />
        );
      }

      case "recent":
        return <RecentStrip />;

      case "vertrouwen":
        return <TrustBlock />;

      default:
        return null;
    }
  }

  return (
    <>
      <JsonLd data={orgJsonLd} />
      {zichtbaar.map((sec) => (
        <div key={sec.id}>{blok(sec)}</div>
      ))}
    </>
  );
}
