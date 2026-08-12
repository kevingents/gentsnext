"use client";

import Image from "next/image";
import Link from "next/link";
import type { ProductCardData } from "@/lib/catalog";
import { formatEuro } from "@/lib/pricing";
import { useT } from "@/components/i18n/locale-provider";
import { WishlistButton } from "@/components/wishlist/wishlist-button";
import { ProductCardBadge } from "@/components/product-card-badge";
import { track } from "@/lib/track-client";

// Brede/kleine accessoires passen niet in de 3:4-tegel met object-cover → heel tonen.
const FIT_CONTAIN = new Set(["Riemen", "Stropdassen", "Strikken", "Manchetknopen", "Pochet", "Bretels", "Sjaals"]);

export function ProductCard({
  product,
  priority = false,
  position,
  listId,
  sort,
  inMyStore,
}: {
  product: ProductCardData;
  priority?: boolean;
  /** Ligt dit artikel in (één van) de winkels van deze klant? Stad of "jouw winkel". */
  inMyStore?: string | null;
  /** 1-gebaseerde plek in de lijst — zonder positie beloont een populariteits-
   *  ranking alleen wat toevallig bovenaan stond (positie-bias). */
  position?: number;
  /** Welke lijst ("categorie:overhemden", "collection:sale"). */
  listId?: string;
  sort?: string;
}) {
  const t = useT();
  const contain = FIT_CONTAIN.has(product.category || "");
  return (
    <Link
      href={`/products/${product.handle}`}
      onClick={() =>
        track("product_click", {
          handle: product.handle,
          props: { ...(position ? { position } : {}), ...(listId ? { listId } : {}), ...(sort ? { sort } : {}) },
        })
      }
      className="group relative flex flex-col gap-3"
    >
      {product.hasSale ? (
        <ProductCardBadge label={t("plp.badge.sale")} tone="sale" />
      ) : product.lowStock ? (
        <ProductCardBadge label={t("plp.badge.lastItems")} tone="sale" />
      ) : product.isNew ? (
        <ProductCardBadge label={t("plp.badge.new")} tone="new" />
      ) : null}
      <WishlistButton handle={product.handle} />
      <div className="relative aspect-[3/4] overflow-hidden rounded-card bg-surface">
        {product.imageUrl ? (
          <Image
            src={product.imageUrl}
            alt={product.imageAlt}
            fill
            // Boven-de-vouw kaarten (eerste rij) niet lazy-loaden → sneller LCP op de PLP.
            priority={priority}
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className={`transition duration-500 ease-brand group-hover:scale-[1.04] ${contain ? "object-contain p-4" : "object-cover"} ${product.hoverImageUrl ? "group-hover:opacity-0" : ""}`}
          />
        ) : (
          <div className="flex h-full items-center justify-center font-sans text-xs text-muted">
            {t("product.noImage")}
          </div>
        )}
        {/* Modelfoto (of sfeerbeeld) faded in bij hover — toont het kledingstuk gedragen.
            Alleen op hover-capable devices renderen: op touch (het gros van het verkeer)
            is er geen hover, dus dat tweede beeld hoeft niet gedownload te worden. De
            display:none-wrapper houdt 'm buiten Next's lazy-loader (geen fetch). */}
        {product.hoverImageUrl ? (
          <span aria-hidden className="absolute inset-0 hidden [@media(hover:hover)]:block">
            <Image
              src={product.hoverImageUrl}
              alt=""
              aria-hidden
              fill
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
              className="object-cover opacity-0 transition-opacity duration-500 ease-brand group-hover:opacity-100"
            />
          </span>
        ) : null}
      </div>
      <div className="flex flex-col gap-0.5">
        {/* "Ligt in jouw winkel" — de vraag die je anders alleen op de
            productpagina beantwoord kreeg. Alleen tonen als de klant een winkel
            heeft; het is een persoonlijk feit, geen algemene claim. */}
        {inMyStore ? (
          <p className="flex items-center gap-1 font-sans text-xs text-success">
            <svg viewBox="0 0 24 24" className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 9l1.5-4.5h15L21 9M3 9v10a1 1 0 001 1h16a1 1 0 001-1V9M3 9h18M9 20v-6h6v6" />
            </svg>
            {t("plp.card.inMyStore", { store: inMyStore })}
          </p>
        ) : null}
        {/* Eigen merk niet op elke kaart herhalen — dat is ruis; alleen externe
            merken (bv. een gastlabel) zijn het vermelden waard. Ook niet tonen
            als de titel al met het merk begint (dubbel "Blumfontain"). */}
        {product.vendor &&
        product.vendor.toUpperCase() !== "GENTS" &&
        !product.title.toLowerCase().startsWith(product.vendor.toLowerCase()) ? (
          <p className="label-brand !text-[0.62rem]">{product.vendor}</p>
        ) : null}
        <h3 className="font-sans text-sm text-ink">{product.title}</h3>
        <p className="font-sans text-sm text-ink-soft">
          {product.hasPriceRange ? `${t("product.from")} ` : ""}
          {/* Doorstreping hangt aan dezelfde vlag als de sale-badge (Omnibus-
              referentieprijs uit lib/pricing) — badge en "van"-prijs kunnen dus
              niet los van elkaar verschijnen, en niet los van de PDP. */}
          <span className={product.hasSale ? "text-danger" : ""}>{formatEuro(product.minPriceCents)}</span>
          {product.hasSale && product.referenceCents ? (
            <span className="ml-2 text-xs text-muted line-through">{formatEuro(product.referenceCents)}</span>
          ) : null}
        </p>
        {product.colorCount && product.colorCount > 1 ? (
          <p className="font-sans text-xs text-muted">{t("product.colorCount", { n: product.colorCount })}</p>
        ) : null}
      </div>
    </Link>
  );
}
