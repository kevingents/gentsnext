import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

/**
 * De USP-strip onder de hero. De teksten komen uit de site-instellingen (portal
 * → Instellingen), vertaald via de site-vertaalrail. Tot deze wijziging bouwde
 * dit component zijn eigen lijstje uit vaste sleutels en werd `settings.usps`
 * nooit gelezen: je kon in de portal typen wat je wilde en er veranderde niets.
 *
 * Zonder ingestelde USP's valt hij terug op de ingebouwde vier, zodat een leeg
 * document geen lege balk oplevert.
 */
export async function UspBar({ usps }: { usps?: string[] }) {
  const locale = await getLocale();
  const eigen = (usps || []).map((u) => u.trim()).filter(Boolean);
  const lijst = eigen.length
    ? eigen
    : [t("usp.specialist", locale), t("usp.luxury", locale), t("usp.returns", locale), t("usp.advice", locale)];
  return (
    <div className="border-y border-line bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-10 gap-y-2 px-gutter py-3">
        {lijst.map((usp) => (
          <span key={usp} className="label-brand !text-ink-soft">
            {usp}
          </span>
        ))}
      </div>
    </div>
  );
}
