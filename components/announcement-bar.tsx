import Link from "next/link";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

/** Smalle merkbalk boven de header — campagnes, USP's, of een seizoens-call. */
export async function AnnouncementBar() {
  const locale = await getLocale();
  return (
    <div className="bg-ink text-canvas">
      <div className="mx-auto flex max-w-page items-center justify-center gap-2 px-gutter py-2 font-sans text-xs">
        <span className="hidden sm:inline">{t("delivery.free", locale)}</span>
        <span aria-hidden className="hidden text-canvas/40 sm:inline">·</span>
        <span>Persoonlijk advies in onze 19 winkels —</span>
        <Link href="/pages/winkels" className="underline underline-offset-4">{t("common.findStore", locale)}</Link>
      </div>
    </div>
  );
}
