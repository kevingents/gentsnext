/**
 * Tijdelijke "binnenkort"-pagina's voor nav-bestemmingen die nog gebouwd
 * worden (pak-samensteller, maatadvies, winkelwagen, contentpagina's). Houdt
 * de navigatie heel zonder 404's tijdens de bouw.
 */
export default function PlaceholderLayout({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-page px-gutter py-20">{children}</div>;
}
