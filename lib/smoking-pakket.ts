import { asc, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { products, productVariants, productImages } from "@/db/schema";
import { stockForSkus } from "@/lib/stock";
import { sortSizes } from "@/lib/sizing";
import { BRANCH_CITY } from "@/lib/fulfillment-config";
import { pickupInfoByCity } from "@/lib/stores";
import { SMOKING_ROLES, SMOKING_ROLE_LABEL, type SmokingRole } from "@/lib/smoking-korting";

/**
 * "Smoking compleet" — de klant stelt zelf jas, pantalon, overhemd en strik
 * samen, elk in zijn eigen maat, tegen één VASTE pakketprijs per niveau.
 *
 * Twee dingen wijken bewust af van pak-samenstellen (lib/suit-pairing.ts):
 *
 *   MEERDERE KEUZES PER ROL. Bij een pak volgt de broek uit de stijlcode van
 *   het colbert — één combinatie. Bij een smoking kiest de klant zelf punt- of
 *   shawlkraag, welk overhemd en welke strik. De koppeling kan dus niet uit de
 *   artikel_id komen; ze staat in de portal-config.
 *
 *   PRIJS UIT DE CONFIG, NIET UIT DE SOM. De pakketprijs is een belofte over
 *   elke combinatie binnen dat niveau. Het verschil met de losse som wordt
 *   server-side verrekend bij het afrekenen (zie smokingPakketKorting), nooit
 *   alleen in de weergave — anders zou de klant een prijs zien die de order
 *   niet kent.
 *
 * De samenstelling en de prijzen komen uit de portal (Instellingen → "Smoking
 * compleet"), dezelfde bron die gents.nl gebruikt. Zo hoeft Kevin het maar op
 * één plek te onderhouden en kunnen beide sites niet uit elkaar lopen.
 */

const CONFIG_URL =
  process.env.SMOKING_DEAL_URL || "https://storegents.vercel.app/api/storefront/smoking-deal";

/* De rol-constanten en de rekenkant staan in lib/smoking-korting.ts: die is
   pure rekenkunde en moet testbaar blijven zonder database en zonder fetch. */
export {
  SMOKING_ROLES,
  SMOKING_ROLE_LABEL,
  SMOKING_GROUP_PREFIX,
  smokingGroupId,
  smokingPakketKorting,
} from "@/lib/smoking-korting";
export type { SmokingRole } from "@/lib/smoking-korting";

export type SmokingConfigNiveau = {
  id: string;
  naam: string;
  subtitel: string;
  badge: string;
  /** Vaste pakketprijs in euro's, zoals ingesteld in de portal. */
  prijs: number;
  rollen: { rol: SmokingRole; label: string; handles: string[] }[];
};

export type SmokingConfig = {
  enabled: boolean;
  heading: string;
  intro: string;
  knoptekst: string;
  niveaus: SmokingConfigNiveau[];
  extras: { handle: string; label: string; omschrijving: string; kleur: string }[];
};

const LEEG: SmokingConfig = {
  enabled: false,
  heading: "",
  intro: "",
  knoptekst: "",
  niveaus: [],
  extras: [],
};

/**
 * Config ophalen bij de portal. Bewust met revalidate en niet met force-dynamic:
 * de samenstelling wijzigt een paar keer per seizoen, en als de portal even
 * onbereikbaar is mag de smoking-pagina daar niet in meegaan — dan tonen we
 * gewoon de laatst bekende versie.
 */
export async function getSmokingConfig(): Promise<SmokingConfig> {
  try {
    const res = await fetch(CONFIG_URL, { next: { revalidate: 300 } });
    if (!res.ok) return LEEG;
    const data = (await res.json()) as Partial<SmokingConfig> & { success?: boolean };
    if (!data?.success || !data.enabled) return LEEG;
    return {
      enabled: true,
      heading: String(data.heading ?? ""),
      intro: String(data.intro ?? ""),
      knoptekst: String(data.knoptekst ?? ""),
      niveaus: (data.niveaus ?? []) as SmokingConfigNiveau[],
      extras: (data.extras ?? []) as SmokingConfig["extras"],
    };
  } catch {
    return LEEG;
  }
}

export type SmokingOptie = {
  handle: string;
  title: string;
  image: string;
  /** FASHN-modelfoto (product-to-model) — ONS artikel op een model, al gemaakt
      door de Modellen-studio. Daardoor kan de samensteller een echt beeld tonen
      dat meeverandert met de keuze, zonder er iets voor te genereren. */
  modelImage: string;
  modelAlt: string;
  /** Kleur waarop we vastpinnen als het artikel er meerdere heeft (bv. schoenen). */
  kleur: string;
  sizes: {
    sizeLabel: string;
    size: string;
    sku: string;
    priceCents: number;
    qty: number;
    known: boolean;
    branches: { store: string; qty: number; openNow: boolean; openLabel: string }[];
  }[];
};

export type SmokingNiveau = {
  id: string;
  naam: string;
  subtitel: string;
  badge: string;
  prijsCents: number;
  rollen: { rol: SmokingRole; label: string; opties: SmokingOptie[] }[];
};

export type SmokingPakket = {
  heading: string;
  intro: string;
  knoptekst: string;
  niveaus: SmokingNiveau[];
  extras: (SmokingOptie & { label: string; omschrijving: string })[];
};

type RawProduct = { id: string; handle: string; title: string; image: string; modelImage: string; modelAlt: string };

/** Producten + hun varianten/voorraad ophalen voor een set handles. */
async function laadOpties(handles: string[]): Promise<Map<string, SmokingOptie>> {
  const uniek = [...new Set(handles.map((h) => h.trim().toLowerCase()).filter(Boolean))];
  if (!uniek.length) return new Map();

  const db = getDb();
  const rows = await db.execute<{
    id: string; handle: string; title: string;
    image: string | null; model_image_url: string | null; model_image_alt: string | null;
  }>(sql`
    select p.id, p.handle, p.title, p.model_image_url, p.model_image_alt,
           (select url from ${productImages} pi where pi.product_id = p.id order by position limit 1) as image
    from ${products} p
    where p.status = 'active' and lower(p.handle) in ${uniek}
  `);

  const gevonden: RawProduct[] = rows.rows.map((r) => ({
    id: r.id,
    handle: r.handle,
    title: r.title,
    image: r.image || "",
    modelImage: r.model_image_url || "",
    modelAlt: r.model_image_alt || "",
  }));
  if (!gevonden.length) return new Map();

  const varianten = await db
    .select({
      productId: productVariants.productId,
      size: productVariants.size,
      sizeLabel: productVariants.sizeLabel,
      sku: productVariants.sku,
      priceCents: productVariants.priceCents,
      color: productVariants.color,
      position: productVariants.position,
    })
    .from(productVariants)
    .where(
      inArray(
        productVariants.productId,
        gevonden.map((p) => p.id)
      )
    )
    .orderBy(asc(productVariants.position));

  const stockMap = await stockForSkus(varianten.map((v) => v.sku).filter(Boolean));
  const hasStock = stockMap.size > 0;

  const perProduct = new Map<string, typeof varianten>();
  for (const v of varianten) {
    if (!v.size) continue;
    const lijst = perProduct.get(v.productId) ?? [];
    lijst.push(v);
    perProduct.set(v.productId, lijst);
  }

  const uit = new Map<string, SmokingOptie>();
  for (const p of gevonden) {
    const alle = perProduct.get(p.id) ?? [];
    uit.set(p.handle.toLowerCase(), {
      handle: p.handle,
      title: p.title,
      image: p.image,
      modelImage: p.modelImage,
      modelAlt: p.modelAlt,
      kleur: "",
      sizes: sortSizes(
        alle.map((v) => {
          const st = v.sku ? stockMap.get(v.sku) : undefined;
          return {
            sizeLabel: v.sizeLabel,
            size: v.size as string,
            sku: v.sku,
            priceCents: v.priceCents,
            kleur: String(v.color ?? ""),
            qty: st?.online ?? 0,
            known: hasStock && Boolean(v.sku),
            branches:
              st?.byBranch
                .filter((b) => Boolean(BRANCH_CITY[b.branchId]))
                .map((b) => {
                  const city = BRANCH_CITY[b.branchId];
                  const info = pickupInfoByCity(city);
                  return {
                    store: b.store,
                    qty: b.qty,
                    openNow: info?.openNow ?? false,
                    openLabel: info?.label ?? "",
                  };
                })
                .sort((a, b) => Number(b.openNow) - Number(a.openNow) || b.qty - a.qty) ?? [],
          };
        })
      ) as SmokingOptie["sizes"] & { kleur?: string }[],
    });
  }
  return uit;
}

/**
 * Eén kleur vastpinnen als het artikel er meerdere heeft.
 *
 * "Leder classic" bestaat in cognac én zwart met dezelfde maatnummers. Zonder
 * deze stap wint de eerste variant in de lijst en krijgt een smoking-klant
 * stilzwijgend cognac schoenen. Voorkeur uit de config; anders de eerste kleur
 * die nog voorraad heeft.
 */
function pinKleur(optie: SmokingOptie, voorkeur: string): SmokingOptie {
  const metKleur = optie.sizes as (SmokingOptie["sizes"][number] & { kleur?: string })[];
  const kleuren = [...new Set(metKleur.map((s) => (s.kleur ?? "").trim()).filter(Boolean))];
  if (kleuren.length <= 1) return { ...optie, kleur: kleuren[0] ?? "" };

  const wens = voorkeur.trim().toLowerCase();
  const gekozen =
    kleuren.find((k) => k.toLowerCase() === wens) ??
    kleuren.find((k) => metKleur.some((s) => (s.kleur ?? "") === k && (!s.known || s.qty > 0))) ??
    kleuren[0];

  return {
    ...optie,
    kleur: gekozen,
    sizes: metKleur.filter((s) => (s.kleur ?? "") === gekozen),
  };
}

/** Een optie is bruikbaar zodra er één maat leverbaar is. */
function heeftVoorraad(optie: SmokingOptie): boolean {
  return optie.sizes.some((s) => !s.known || s.qty > 0);
}

/** Volledig smoking-pakket (config + producten + maten + voorraad) voor de samensteller. */
export async function getSmokingPakket(): Promise<SmokingPakket | null> {
  const config = await getSmokingConfig();
  if (!config.enabled || !config.niveaus.length) return null;

  const alleHandles = [
    ...config.niveaus.flatMap((n) => n.rollen.flatMap((r) => r.handles)),
    ...config.extras.map((e) => e.handle),
  ];
  const opties = await laadOpties(alleHandles);

  const niveaus: SmokingNiveau[] = [];
  for (const n of config.niveaus) {
    const rollen = n.rollen.map((r) => ({
      rol: r.rol,
      label: r.label || SMOKING_ROLE_LABEL[r.rol],
      opties: r.handles
        .map((h) => opties.get(h.toLowerCase()))
        .filter((o): o is SmokingOptie => Boolean(o))
        .map((o) => pinKleur(o, ""))
        .filter(heeftVoorraad),
    }));
    /* Een niveau waarvan één rol niets leverbaars heeft, kán de klant niet
       compleet maken. Verbergen is eerlijker dan een stap tonen die vastloopt. */
    if (rollen.length !== SMOKING_ROLES.length || rollen.some((r) => !r.opties.length)) continue;
    niveaus.push({
      id: n.id,
      naam: n.naam,
      subtitel: n.subtitel,
      badge: n.badge,
      prijsCents: Math.round(Number(n.prijs) * 100),
      rollen,
    });
  }
  if (!niveaus.length) return null;

  const extras = config.extras
    .map((e) => {
      const o = opties.get(e.handle.toLowerCase());
      if (!o) return null;
      const gepind = pinKleur(o, e.kleur);
      if (!heeftVoorraad(gepind)) return null;
      return { ...gepind, label: e.label || gepind.title, omschrijving: e.omschrijving };
    })
    .filter(Boolean) as SmokingPakket["extras"];

  return {
    heading: config.heading,
    intro: config.intro,
    knoptekst: config.knoptekst,
    niveaus,
    extras,
  };
}
