import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SuitBuilder } from "@/components/pak/suit-builder";
import { getSuitByColbertHandle, type SuitPieceDetail } from "@/lib/suit-pairing";
import { estimateDelivery } from "@/lib/fulfillment";
import { getSettings } from "@/lib/settings";
import { getLocale } from "@/lib/locale-server";
import { getT } from "@/lib/t-server";

export const dynamic = "force-dynamic";

/** Best-op-voorraad SKU van een onderdeel voor de bezorgschatting. */
function representativeSku(piece: SuitPieceDetail): string {
  let best = "";
  let bestQty = 0;
  for (const s of piece.sizes) {
    if (s.sku && s.qty > bestQty) {
      bestQty = s.qty;
      best = s.sku;
    }
  }
  return best;
}

type Props = { params: Promise<{ handle: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const suit = await getSuitByColbertHandle(handle);
  const colbert = suit?.pieces.find((p) => p.role === "colbert");
  if (!colbert) return {};
  return {
    title: `Pak samenstellen — ${colbert.title}`,
    alternates: { canonical: `/pak-samenstellen/${handle}` },
  };
}

export default async function SuitBuilderPage({ params }: Props) {
  const { handle } = await params;
  const suit = await getSuitByColbertHandle(handle);
  if (!suit) notFound();

  const locale = await getLocale();
  const t = await getT(locale);

  // Bezorgbelofte (server-accuraat) voor het 2-delige basispak — net als de PDP.
  const baseLines = suit.pieces
    .filter((p) => p.role === "colbert" || p.role === "broek")
    .map(representativeSku)
    .filter(Boolean)
    .map((sku) => ({ sku, qty: 1 }));
  const [delivery, settings] = await Promise.all([
    baseLines.length ? estimateDelivery(baseLines) : Promise.resolve(null),
    getSettings(),
  ]);

  return (
    <div className="mx-auto max-w-page px-gutter py-8 pb-20">
      <nav className="font-sans text-sm text-muted" aria-label={t("common.breadcrumb")}>
        <Link href="/" className="hover:text-ink">
          {t("common.home")}
        </Link>
        {" / "}
        <Link href="/pak-samenstellen" className="hover:text-ink">
          {t("nav.customizeSuit")}
        </Link>
      </nav>
      <div className="mt-6">
        <SuitBuilder
          suit={suit}
          deliveryPromise={delivery?.promise ?? null}
          deliveryNote={delivery?.note ?? null}
          cutoffHour={settings.warehouseCutoffHour}
        />
      </div>
    </div>
  );
}
