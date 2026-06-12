import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SuitBuilder } from "@/components/pak/suit-builder";
import { getSuitByColbertHandle } from "@/lib/suit-pairing";

export const dynamic = "force-dynamic";

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

  return (
    <div className="mx-auto max-w-page px-gutter py-8 pb-20">
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/" className="hover:text-ink">
          Home
        </Link>
        {" / "}
        <Link href="/pak-samenstellen" className="hover:text-ink">
          Pak samenstellen
        </Link>
      </nav>
      <div className="mt-6">
        <SuitBuilder suit={suit} />
      </div>
    </div>
  );
}
