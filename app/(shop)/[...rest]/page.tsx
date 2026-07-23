import { notFound } from "next/navigation";

/**
 * Catch-all binnen de (shop)-groep: onbekende URL's renderen zo de nette
 * 404-pagina MÉT site-header en footer (de root-not-found stond buiten de
 * shop-layout en toonde een kale pagina zonder navigatie).
 */
export default function CatchAll() {
  notFound();
}
