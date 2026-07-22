import Link from "next/link";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

/** Smalle merkbalk boven de header — campagnes, USP's, of een seizoens-call. */
export async function AnnouncementBar() {
  const locale = await getLocale();
  // getT i.p.v. de statische t: leest óók de cron-vertaalstore, zodat de balk
  // in ALLE talen meekomt (statische dicts dekten alleen NL/EN → mixed-language).
  const t = await getT(locale);
  return (
    <div className="bg-ink text-canvas">
      <div className="mx-auto flex max-w-page items-center justify-center gap-2 px-gutter py-2 font-sans text-xs">
        <span className="hidden sm:inline">{t("delivery.free")}</span>
        <span aria-hidden className="hidden text-canvas/40 sm:inline">·</span>
        <span>{t("announcement.personalAdvice")} —</span>
        <Link href="/pages/winkels" className="underline underline-offset-4">{t("common.findStore")}</Link>
      </div>
    </div>
  );
}
