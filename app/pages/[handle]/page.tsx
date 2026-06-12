import type { Metadata } from "next";
import Link from "next/link";
import { StoreLocator, type LocatorStore } from "@/components/stores/store-locator";
import { StorePage } from "@/components/stores/store-page";
import { getStores, getStoreByPageHandle, openStatus } from "@/lib/stores";
import { getMigratedPage } from "@/lib/migrated-pages";

export const dynamic = "force-dynamic";

const KNOWN_TITLES: Record<string, string> = {
  winkels: "Onze winkels",
  "trouw-afspraak": "Trouwafspraak maken",
  students: "Voor studenten & verenigingen",
  zakelijk: "GENTS Zakelijk",
  uitvaartkleding: "Uitvaartkleding",
  "werken-bij-gents": "Werken bij GENTS",
};

function fallbackTitle(handle: string): string {
  return KNOWN_TITLES[handle] || handle.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const store = getStoreByPageHandle(handle);
  if (store) return { title: `GENTS ${store.city} — herenmode & pakken`, alternates: { canonical: `/pages/${handle}` } };
  const mp = getMigratedPage(handle);
  if (mp) return { title: mp.title, alternates: { canonical: `/pages/${handle}` } };
  return { title: fallbackTitle(handle), robots: { index: false } };
}

export default async function GenericPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;

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

  // 3. Gemigreerde content (service, etiquette, juridisch, over-gents, …)
  const mp = getMigratedPage(handle);
  if (mp) {
    return (
      <article className="mx-auto max-w-3xl px-gutter py-12">
        <h1 className="text-display-md">{mp.title}</h1>
        <div className="prose-gents mt-8" dangerouslySetInnerHTML={{ __html: mp.html }} />
      </article>
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
