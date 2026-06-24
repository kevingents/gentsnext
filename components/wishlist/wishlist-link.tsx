"use client";

import Link from "next/link";
import { useWishlist } from "@/components/wishlist/wishlist-context";
import { useT } from "@/components/i18n/locale-provider";

export function WishlistLink() {
  const t = useT();
  const wl = useWishlist();
  return (
    <Link
      href="/favorieten"
      aria-label={`${t("wishlist.link.label")} ${wl.count} ${t("wishlist.link.saved")}`}
      className="relative text-ink-soft transition-colors hover:text-ink"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
        <path d="M12 21s-7-4.35-9.5-9C1 9.5 2.5 6 6 6c2 0 3.5 1.2 4 2.5C10.5 7.2 12 6 14 6c3.5 0 5 3.5 3.5 6-2.5 4.65-9.5 9-9.5 9z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {wl.hydrated && wl.count > 0 ? (
        <span className="absolute -right-2 -top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-ink px-1 text-[0.6rem] text-canvas">
          {wl.count}
        </span>
      ) : null}
    </Link>
  );
}
