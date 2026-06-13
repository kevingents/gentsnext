import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

export async function UspBar() {
  const locale = await getLocale();
  const usps = [
    t("usp.specialist", locale),
    t("usp.luxury", locale),
    t("usp.returns", locale),
    t("usp.advice", locale),
  ];
  return (
    <div className="border-y border-line bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-10 gap-y-2 px-gutter py-3">
        {usps.map((usp) => (
          <span key={usp} className="label-brand !text-ink-soft">
            {usp}
          </span>
        ))}
      </div>
    </div>
  );
}
