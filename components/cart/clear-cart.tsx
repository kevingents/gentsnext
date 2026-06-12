"use client";

import { useEffect } from "react";
import { useCart } from "@/components/cart/cart-context";

/** Leegt de winkelwagen (na een geslaagde bestelling). */
export function ClearCart() {
  const cart = useCart();
  useEffect(() => {
    cart.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
