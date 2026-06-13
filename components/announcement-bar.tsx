import Link from "next/link";

/** Smalle merkbalk boven de header — campagnes, USP's, of een seizoens-call. */
export function AnnouncementBar() {
  return (
    <div className="bg-ink text-canvas">
      <div className="mx-auto flex max-w-page items-center justify-center gap-2 px-gutter py-2 font-sans text-xs">
        <span className="hidden sm:inline">Gratis verzending vanaf € 75</span>
        <span aria-hidden className="hidden text-canvas/40 sm:inline">·</span>
        <span>Persoonlijk advies in onze 19 winkels —</span>
        <Link href="/pages/winkels" className="underline underline-offset-4">vind een winkel</Link>
      </div>
    </div>
  );
}
