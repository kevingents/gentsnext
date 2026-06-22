import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getLookBySlug, getAllLooks, resolveLook, getLookBuyData, getLookGallery, getLookColorOptions } from "@/lib/looks";
import { LookDetail } from "@/components/looks/look-detail";
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
  const baseHandles = resolved.products.map((p) => p.handle);
  const [{ hero, gallery }, colorOptions] = await Promise.all([getLookGallery(look), getLookColorOptions(baseHandles)]);
  // Koopdata voor basis-producten én alle kleurvarianten (zodat de switcher maten heeft).
  const allHandles = [...new Set([...baseHandles, ...Object.values(colorOptions).flat().map((o) => o.handle)])];
  const [buy, others] = await Promise.all([getLookBuyData(allHandles), getAllLooks()]);
  const more = others.filter((l) => l.slug !== slug).slice(0, 6);

  return (
    <div className="mx-auto max-w-page px-gutter py-10">
      <nav className="font-sans text-sm text-muted" aria-label="Kruimelpad">
        <Link href="/looks" className="hover:text-ink">Shop the look</Link>
        {" / "}
        <span className="text-ink">{look.title}</span>
      </nav>

      <div className="mt-6">
        <LookDetail look={resolved} hero={hero} gallery={gallery} colorOptions={colorOptions} buy={buy} />
      </div>

      {more.length ? (
        <section className="mt-20">
          <p className="label-brand mb-4">Meer looks</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            {more.map((l) => (
              <Link key={l.slug} href={`/looks/${l.slug}`} className="group block">
                <div className="relative aspect-[4/5] overflow-hidden rounded-card bg-surface">
                  <Image src={l.image} alt={l.title} fill sizes="(max-width:640px) 50vw, 16vw" className="object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                </div>
                <p className="mt-2 font-sans text-xs font-medium text-ink group-hover:underline">{l.title}</p>
                <p className="font-sans text-[0.7rem] text-muted">{l.occasion}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
