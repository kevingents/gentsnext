import Link from "next/link";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

const ITEMS = [
  {
    titleKey: "home.trustBlock.storesTitle",
    bodyKey: "home.trustBlock.storesDesc",
    href: "/pages/winkels",
    labelKey: "home.trustBlock.storesLink",
  },
  {
    titleKey: "home.trustBlock.returnTitle",
    bodyKey: "home.trustBlock.returnDesc",
    href: "/pages/retourneren",
    labelKey: "home.trustBlock.returnLink",
  },
  {
    titleKey: "home.trustBlock.dresscodeTitle",
    bodyKey: "home.trustBlock.dresscodeDesc",
    href: "/pages/etiquette",
    labelKey: "home.trustBlock.dresscodeLink",
  },
];

export async function TrustBlock() {
  const locale = await getLocale();
  return (
    <section className="bg-surface">
      <div className="mx-auto grid max-w-page gap-8 px-gutter py-14 md:grid-cols-3">
        {ITEMS.map((i) => (
          <div key={i.titleKey} className="border-l border-line pl-6">
            <h3 className="font-display text-xl font-light">{t(i.titleKey, locale)}</h3>
            <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{t(i.bodyKey, locale)}</p>
            <Link href={i.href} className="mt-3 inline-block font-sans text-sm text-ink underline underline-offset-4">
              {t(i.labelKey, locale)} →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
