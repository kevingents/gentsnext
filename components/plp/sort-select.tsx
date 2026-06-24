"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import type { ProductSort } from "@/lib/catalog";
import { SORT_LABELS } from "@/lib/plp-params";
import { useT } from "@/components/i18n/locale-provider";

export function SortSelect({ value }: { value: ProductSort }) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, startTransition] = useTransition();

  function onChange(next: string) {
    const params = new URLSearchParams(sp.toString());
    if (next === "nieuw") params.delete("sort");
    else params.set("sort", next);
    params.delete("page");
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  return (
    <label className="flex items-center gap-2 font-sans text-sm">
      <span className="text-muted">{t("plp.sort.label")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none"
      >
        {(Object.keys(SORT_LABELS) as ProductSort[]).map((k) => (
          <option key={k} value={k}>
            {SORT_LABELS[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
