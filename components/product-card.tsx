import Image from "next/image";
import Link from "next/link";
import type { ProductCardData } from "@/lib/catalog";
import { formatEuro } from "@/lib/pricing";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { ProductCardBadge } from "@/components/product-card-badge";

// Brede/kleine accessoires passen niet in de 3:4-tegel met object-cover → heel tonen.
const FIT_CONTAIN = new Set(["Riemen", "Stropdassen", "Strikken", "Manchetknopen", "Pochet", "Bretels", "Sjaals"]);

export function ProductCard({ product }: { product: ProductCardData }) {
  const contain = FIT_CONTAIN.has(product.category || "");
  return (
    <Link href={`/products/${product.handle}`} className="group relative flex flex-col gap-3">
      {product.hasSale ? (
        <ProductCardBadge label="Sale" tone="sale" />
      ) : product.lowStock ? (
        <ProductCardBadge label="Laatste exemplaren" tone="sale" />
      ) : product.isNew ? (
        <ProductCardBadge label="Nieuw" tone="new" />
      ) : null}
      <WishlistButton handle={product.handle} />
      <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-surface">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.imageAlt}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`transition duration-500 ease-brand group-hover:scale-[1.04] ${contain ? "object-contain p-4" : "object-cover"} ${product.hoverImageUrl ? "group-hover:opacity-0" : ""}`}
          />
        ) : (
          <div className="flex h-full items-center justify-center font-sans text-xs text-muted">
            Geen afbeelding
          </div>
        )}
        {/* Modelfoto (of sfeerbeeld) faded in bij hover — toont het kledingstuk gedragen. */}
        {product.hoverImageUrl ? (
          <Image
            src={product.hoverImageUrl}
            alt=""
            aria-hidden
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="absolute inset-0 object-cover opacity-0 transition-opacity duration-500 ease-brand group-hover:opacity-100"
          />
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        {product.vendor ? (
          <p className="label-brand !text-[0.62rem]">{product.vendor}</p>
        ) : null}
        <h3 className="font-sans text-sm text-ink">{product.title}</h3>
        <p className="font-sans text-sm text-ink-soft">
          {product.hasPriceRange ? "vanaf " : ""}
          <span className={product.compareAtCents ? "text-danger" : ""}>{formatEuro(product.minPriceCents)}</span>
          {product.compareAtCents ? (
            <span className="ml-2 text-xs text-muted line-through">{formatEuro(product.compareAtCents)}</span>
          ) : null}
        </p>
        {product.colorCount && product.colorCount > 1 ? (
          <p className="font-sans text-xs text-muted">In {product.colorCount} kleuren</p>
        ) : null}
      </div>
    </Link>
  );
}
