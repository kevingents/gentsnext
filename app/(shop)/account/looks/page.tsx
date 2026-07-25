import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { getManagedLooks, getLookBuyData, getLookGallery, getLook } from "@/lib/looks";
import { getProductsByHandles } from "@/lib/catalog";
import { BackofficeShell } from "@/components/account/report-ui";
import { LooksManager, type AdminLook, type ProductHealth } from "@/components/account/looks-manager";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Looks", robots: { index: false, follow: false } };

/**
 * Site-studio → Looks. Beheert de "Shop the look"-outfits (lib/looks): titel,
 * verhaal, status (gepubliceerd/concept) en de gekoppelde producten (hotspots).
 *
 * Extra t.o.v. de portal-versie: per look wordt gecontroleerd of élk gekoppeld
 * product nog actief én netto op voorraad is. Een look met een uitverkocht
 * product is een stille fout — de klant klikt op een hotspot en loopt vast.
 */

/** getProductsByHandles kapt af op 60 handles; in blokken opvragen zodat een grote
 *  lookbook geen valse "niet actief"-meldingen oplevert. */
async function activeProductTitles(handles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < handles.length; i += 50) {
    const cards = await getProductsByHandles(handles.slice(i, i + 50));
    for (const c of cards) out.set(c.handle, c.title);
  }
  return out;
}

export default async function LooksAdminPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");

  if (!customer.isAdmin) {
    return (
      <div className="mx-auto max-w-page px-gutter py-16">
        <h1 className="text-display-md">Geen toegang</h1>
        <p className="mt-3 font-sans text-ink-soft">Deze pagina is alleen voor beheerders.</p>
        <Link href="/account" className="mt-6 inline-block font-sans text-sm text-ink underline">← Terug naar mijn account</Link>
      </div>
    );
  }

  const stored = await getManagedLooks();
  const handles = [...new Set(stored.flatMap((l) => l.hotspots.map((h) => h.handle)).filter(Boolean))];

  // Voorraad uit dezelfde bron als de PDP-buy-box (netto online, na reserveringen),
  // zodat de beheerder ziet wat de klant ziet — niet het bruto SRS-totaal.
  // getLookBuyData geeft zelf {} terug bij een lege lijst — geen extra tak nodig.
  const [titles, buy] = await Promise.all([activeProductTitles(handles), getLookBuyData(handles)]);

  const health: Record<string, ProductHealth> = {};
  for (const handle of handles) {
    const title = titles.get(handle);
    if (!title) {
      health[handle] = { state: "missing", title: "" };
      continue;
    }
    const data = buy[handle];
    if (!data || !data.sizes.length) {
      health[handle] = { state: "no-sizes", title };
      continue;
    }
    const soldOut = data.sizes.every((s) => s.known && s.qty <= 0);
    health[handle] = { state: soldOut ? "sold-out" : "ok", title };
  }

  // Wat er NU op /looks/<slug> staat: dezelfde galerij-opbouw als de site
  // (sfeerbeelden van de producten + de lookSfeer-store). Puur ter informatie —
  // zie de opmerking bij images[] hieronder.
  const siteImages = await Promise.all(
    stored.map(async (l) => {
      try {
        const { hero, gallery } = await getLookGallery(l);
        return [hero, ...gallery.map((g) => g.url)].filter(Boolean);
      } catch {
        return [l.image].filter(Boolean);
      }
    }),
  );

  const looks: AdminLook[] = stored.map((l, i) => ({
    slug: l.slug,
    title: l.title,
    subtitle: l.subtitle || "",
    occasion: l.occasion || "",
    theme: l.theme || "",
    image: l.image || "",
    // Alleen de door de beheerder ECHT ingestelde foto's. Vullen we dit met de
    // studio-modelfoto, dan slaat de editor die bij het eerste 'Opslaan' op als
    // expliciete override en wint hij in getLookGallery altijd — waarmee de hele
    // sfeerbeeld-galerij van de live look verdwijnt.
    images: l.images ?? [],
    siteImages: siteImages[i],
    // getManagedLooks levert de ruwe LOOKS af; het verhaal van de ingebouwde looks
    // wordt pas bij het renderen toegevoegd (withStory). getLook() past dat wél toe,
    // dus zo toont het formulier de tekst die de klant nu echt ziet.
    story: l.story || getLook(l.slug)?.story || "",
    defaultStory: getLook(l.slug)?.story || "",
    status: l.status,
    updatedAt: l.updatedAt || "",
    hotspots: l.hotspots.map((h) => ({ handle: h.handle, label: h.label || "", x: h.x, y: h.y })),
  }));

  return (
    <BackofficeShell active="/account/looks" title="Looks">
      <p className="font-sans text-sm text-pslate">
        De gecureerde outfits op /looks. Concepten staan niet op de site. Per look controleren we of elk gekoppeld
        product nog actief en op voorraad is — een uitverkocht product in een look is een stille fout.
      </p>
      <LooksManager looks={looks} health={health} />
    </BackofficeShell>
  );
}
