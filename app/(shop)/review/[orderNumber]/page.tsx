import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getOrderForViewer } from "@/lib/orders";
import { getSessionCustomer } from "@/lib/account";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";
import { WriteReview } from "@/components/reviews/review-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Schrijf een review", robots: { index: false } };

type Props = {
  params: Promise<{ orderNumber: string }>;
  searchParams: Promise<{ t?: string }>;
};

export default async function ReviewOrderPage({ params, searchParams }: Props) {
  const { orderNumber } = await params;
  const { t: token } = await searchParams;
  const locale = await getLocale();
  const t = await getT(locale);
  const customer = await getSessionCustomer();
  const data = await getOrderForViewer(orderNumber, { token, customerId: customer?.id });
  if (!data) notFound();
  const { order, lines } = data;

  // Eén review-blok per uniek product in de order.
  const seen = new Set<string>();
  const items = lines.filter((l) => l.productHandle && !seen.has(l.productHandle) && seen.add(l.productHandle));

  return (
    <div className="mx-auto max-w-2xl px-gutter py-16">
      <p className="label-brand">{t("review.order")} {order.orderNumber}</p>
      <h1 className="mt-2 text-display-md">{t("review.title")}</h1>
      <p className="mt-3 font-sans text-ink-soft">
        {t("review.intro")}
      </p>

      <div className="mt-10 space-y-10">
        {items.map((l) => (
          <div key={l.productHandle} className="border-t border-line pt-8">
            <Link href={`/products/${l.productHandle}`} className="font-display text-lg hover:underline">
              {l.title}
            </Link>
            <div className="mt-4">
              <WriteReview handle={l.productHandle} orderNumber={order.orderNumber} token={token} defaultOpen />
            </div>
          </div>
        ))}
      </div>

      <Link href="/" className="btn-ghost mt-12">
        {t("review.back_home")}
      </Link>
    </div>
  );
}
