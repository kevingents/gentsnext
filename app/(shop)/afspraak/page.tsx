import type { Metadata } from "next";
import { AfspraakForm } from "@/components/appointments/afspraak-form";
import { localeAlternates } from "@/lib/seo";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { getStores } from "@/lib/stores";

export const dynamic = "force-dynamic";

/**
 * Boekingspagina klantafspraken — trouwconsult voorop. Vervangt de oude
 * Shopify-pagina /pages/trouw-afspraak (redirect wijst hierheen). De winkellijst
 * komt uit dezelfde bron als de winkels-/click-collect-pagina's (lib/stores).
 */

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "Afspraak maken — trouwconsult, pasafspraak of personal shopping",
    description:
      "Plan een persoonlijk adviesmoment in één van onze 19 winkels. Trouwconsult voor je trouwpak, een pasafspraak of personal shopping — kies je winkel, dag en dagdeel.",
    alternates: await localeAlternates("/afspraak"),
  };
}

export default async function AfspraakPage({ searchParams }: { searchParams: Promise<{ winkel?: string }> }) {
  const { winkel } = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const stores = getStores().map((s) => s.title);

  // Prefill vanaf een winkelpagina (?winkel=GENTS Amsterdam) — ook een stad mag.
  const raw = String(winkel || "").trim().toLowerCase();
  const initialStore = getStores().find((s) => s.title.toLowerCase() === raw || s.city.toLowerCase() === raw)?.title || "";

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      <div className="mx-auto max-w-2xl">
        <p className="label-brand">{t("afspraak.eyebrow")}</p>
        <h1 className="mt-2 text-display-md">{t("afspraak.title")}</h1>
        <p className="mt-3 font-sans text-ink-soft">{t("afspraak.intro")}</p>
        <div className="mt-8">
          <AfspraakForm stores={stores} initialStore={initialStore} />
        </div>
      </div>
    </div>
  );
}
