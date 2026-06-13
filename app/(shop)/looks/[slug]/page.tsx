import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLookBySlug, getAllLooks, resolveLook, getLookBuyData } from "@/lib/looks";
import { ShopTheLook } from "@/components/looks/shop-the-look";
import { localeAlternates } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const look = await getLookBySlug(slug);
  if (!look) return {};
  return { title: `${look.title} — Shop the look`, description: look.subtitle, alternates: await localeAlternates(`/looks/${slug}`) };
}

export default async function LookPage({ params }: Props) {
  const { slug } = await params;
  const look = await getLookBySlug(slug);
  if (!look) notFound();
  const resolved = await resolveLook(look);
  const buy = await getLookBuyData(resolved.products.map((p) => p.handle));
  const others = (await getAllLooks()).filter((l) => l.slug !== slug);

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/looks" className="hover:text-ink">Shop the look</Link>
        {" / "}
        <span className="text-ink">{look.title}</span>
      </nav>

      <div className="mt-6">
        <ShopTheLook look={resolved} buy={buy} />
      </div>

      {others.length ? (
        <section className="mt-16">
          <p className="label-brand mb-4">Meer looks</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {others.map((l) => (
              <Link key={l.slug} href={`/looks/${l.slug}`} className="font-sans text-sm text-ink underline underline-offset-4">
                {l.title} →
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
