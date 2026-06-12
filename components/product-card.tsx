import Image from "next/image";
import Link from "next/link";
import type { ProductCardData } from "@/lib/catalog";
import { formatEuro } from "@/lib/pricing";

export function ProductCard({ product }: { product: ProductCardData }) {
  return (
    <Link
      href={`/products/${product.handle}`}
      className="group flex flex-col gap-3 rounded-lg bg-white p-3 shadow-card transition hover:shadow-md"
    >
      <div className="relative aspect-[3/4] overflow-hidden rounded-md bg-cream">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.imageAlt}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-slate">
            Geen afbeelding
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1">
        {product.vendor ? (
          <p className="text-xs uppercase tracking-wider text-slate">{product.vendor}</p>
        ) : null}
        <h3 className="text-sm font-medium text-navy">{product.title}</h3>
        <p className="text-sm text-navy">
          {product.hasPriceRange ? "vanaf " : ""}
          {formatEuro(product.minPriceCents)}
        </p>
      </div>
    </Link>
  );
}
