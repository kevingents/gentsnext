import { getContentDoc, setContentDoc } from "@/lib/content-store";

/**
 * Eigen content-pagina's (content:pages) — vervangt Sanity-pages. Body is
 * lichte Markdown (zie components/page-body). Beheerbaar in de GENTS-portal.
 */
export type StorePage = {
  slug: string;
  title: string;
  body: string;
  seoDescription?: string;
  image?: string;
  updatedAt?: string;
};

export async function getStorePages(): Promise<StorePage[]> {
  const doc = await getContentDoc<{ pages: StorePage[] }>("pages");
  return Array.isArray(doc?.pages) ? doc.pages : [];
}

export async function getStorePage(slug: string): Promise<StorePage | null> {
  const s = String(slug || "").trim().toLowerCase();
  return (await getStorePages()).find((p) => p.slug === s) || null;
}

export async function saveStorePages(pages: StorePage[]): Promise<void> {
  await setContentDoc("pages", { pages });
}
