import { Link } from "@/components/i18n/link";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { getLocalizedSiteSettings } from "@/lib/site-settings-i18n";
import { resolveAb } from "@/lib/experiments";
import { TrackAb } from "@/components/analytics/track-ab";

/**
 * Smalle merkbalk boven de header — campagnes, USP's, of een seizoens-call.
 *
 * De tekst komt uit de site-instellingen (portal → Instellingen → Aankondigings-
 * balk), vertaald via de site-vertaalrail. Tot deze wijziging toonde de balk
 * vaste vertaalsleutels en werd `settings.announcement` nooit gelezen — de kaart
 * in de portal beloofde "de balk bovenaan de site" en deed niets.
 *
 * Zonder ingestelde tekst valt hij terug op de oude, vertaalde standaardregel.
 */
export async function AnnouncementBar() {
  const locale = await getLocale();
  // getT i.p.v. de statische t: leest óók de cron-vertaalstore, zodat de balk
  // in ALLE talen meekomt (statische dicts dekten alleen NL/EN → mixed-language).
  const t = await getT(locale);
  const settings = await getLocalizedSiteSettings(locale).catch(() => null);

  // A/B: de balk staat op elke pagina, dus een balk-experiment logt zijn
  // exposure hier (site-breed) — niet op de homepage.
  const ab = await resolveAb();
  // Geforceerde previews (?ab=…) tellen niet mee in de meting.
  const balkAb = ab.assignments.filter((a) => !a.forced && a.overrides?.announcement);

  const tekst = (ab.overrides.announcement?.text || settings?.announcement?.text)?.trim();
  const linkLabel = (ab.overrides.announcement?.linkLabel || settings?.announcement?.linkLabel)?.trim();
  const linkHref = (ab.overrides.announcement?.linkHref || settings?.announcement?.linkHref)?.trim();

  return (
    <div className="bg-ink text-canvas">
      {balkAb.length > 0 && <TrackAb assignments={balkAb.map(({ id, variant }) => ({ id, variant }))} />}
      <div className="mx-auto flex max-w-page items-center justify-center gap-2 px-gutter py-2 font-sans text-xs">
        {tekst ? (
          <span>{tekst}</span>
        ) : (
          <>
            <span className="hidden sm:inline">{t("delivery.free")}</span>
            <span aria-hidden className="hidden text-canvas/40 sm:inline">·</span>
            <span>{t("announcement.personalAdvice")} —</span>
          </>
        )}
        {linkLabel && linkHref ? (
          <Link href={linkHref} className="underline underline-offset-4">{linkLabel}</Link>
        ) : tekst ? null : (
          <Link href="/pages/winkels" className="underline underline-offset-4">{t("common.findStore")}</Link>
        )}
      </div>
    </div>
  );
}
