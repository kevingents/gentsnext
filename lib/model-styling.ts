import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import type { Look, Hotspot } from "@/lib/looks";
import type { Settings } from "@/lib/settings";

/**
 * Slimme, voorraad- én etiquette-bewuste "Shop de look" rond een AI-modelfoto.
 *
 * Per rol (overhemd / pantalon / colbert / schoenen / riem / das) kiezen we
 * automatisch een product dat (1) ruim op voorraad is, (2) qua kleur matcht met
 * het getoonde item en (3) de herenmode-etiquette volgt:
 *   - smoking/black-tie → zwarte lakschoen + zwarte strik (NOOIT bruin/cognac);
 *   - bruine/cognac schoen bij blauw/grijs/tan, zwart bij antraciet/zwart;
 *   - riem = schoenkleur; das contrasteert met het (witte) overhemd;
 *   - pantalon ≠ exact dezelfde kleur als een los colbert (geen "nep-pak").
 *
 * De admin-defaults (settings.modelLook.items) zijn de voorkeur; raakt zo'n stuk
 * onder de voorraaddrempel of botst het met de etiquette, dan substitueren we
 * automatisch het best passende, goed-op-voorraad alternatief.
 */

type Family =
  | "black" | "charcoal" | "grey" | "navy" | "blue" | "brown" | "tan" | "beige"
  | "white" | "green" | "burgundy" | "pink" | "other";

type Formality = "black-tie" | "business" | "smart-casual" | "casual";

type Role = "shirt" | "trousers" | "jacket" | "shoes" | "belt" | "tie";

type Cand = { handle: string; title: string; fam: Family; patent: boolean; qty: number; hg: string };

// Vaste hotspot-posities (het canvas-model staat altijd in dezelfde pose).
const ROLE_POS: Record<Role, { x: number; y: number; label: string }> = {
  shirt: { x: 46, y: 20, label: "Overhemd" },
  tie: { x: 55, y: 27, label: "Das" },
  jacket: { x: 50, y: 34, label: "Colbert" },
  belt: { x: 56, y: 57, label: "Riem" },
  trousers: { x: 50, y: 70, label: "Pantalon" },
  shoes: { x: 50, y: 93, label: "Schoenen" },
};
const TARGET_Y: Record<string, number> = {
  Overhemden: 22, "Polo-shirts": 30, "T-Shirts": 30, Truien: 33, Vesten: 33,
  Gilets: 36, Colberts: 34, Broeken: 70, Pakken: 40, Jassen: 30,
};

const HG_FOR_ROLE: Record<Role, string[]> = {
  shirt: ["Overhemden"],
  trousers: ["Broeken"],
  jacket: ["Colberts"],
  shoes: ["Schoenen"],
  belt: ["Riemen"],
  tie: ["Stropdassen", "Strikken"], // black-tie → Strikken, anders Stropdassen
};

/** Welke rollen voegen we toe rond een getoond product (excl. het product zelf). */
function rolesFor(hg: string, formality: Formality): Role[] {
  switch (hg) {
    case "Colberts": return ["shirt", "trousers", "tie", "shoes"];
    case "Pakken": return ["shirt", "tie", "shoes"]; // pantalon zit in het pak
    case "Overhemden": return formality === "black-tie" ? ["tie", "trousers", "shoes"] : ["trousers", "shoes", "belt"];
    case "Broeken": return ["shirt", "belt", "shoes"];
    case "Gilets": return ["shirt", "trousers", "shoes"];
    case "Truien":
    case "Vesten": return ["trousers", "shoes"];
    case "Polo-shirts":
    case "T-Shirts": return ["trousers", "shoes"];
    case "Schoenen": return ["shirt", "trousers", "belt"]; // outfit ROND de schoen — geen schoen-bij-schoen
    case "Riemen": return ["shirt", "trousers", "shoes"];
    default: return ["trousers", "shoes"];
  }
}

const COLOR_WORDS: [RegExp, Family][] = [
  [/lakschoen|lak\b|patent/, "black"],
  [/zwart|black/, "black"],
  [/antraciet|charcoal|leisteen/, "charcoal"],
  [/grijs|grey|gray|stone|graphite/, "grey"],
  [/navy|marine|donkerblauw/, "navy"],
  [/blauw|blue|jeans|denim|kobalt|aqua/, "blue"],
  [/cognac|camel|tabak|tabacco|tan\b|caramel/, "tan"],
  [/bruin|brown|chocolade|mokka|whisky|roodbruin/, "brown"],
  [/beige|zand|sand|ecru|creme|crème|cream|kaki|khaki|taupe|naturel/, "beige"],
  [/bordeaux|wijnrood|burgundy|wine|cherry|kers/, "burgundy"],
  [/terracotta|terra\b|roest|rust|steenrood|baksteen|brique/, "brown"],
  [/groen|green|olijf|olive|mos|moss|salie|sage|jade|loden/, "green"],
  [/roze|pink|rose|koraal|coral|zalm|salmon|mauve|lila|lilac|poeder/, "pink"],
  [/wit|white|optisch/, "white"],
];

function famOf(...parts: (string | null | undefined)[]): Family {
  const t = parts.filter(Boolean).join(" ").toLowerCase();
  for (const [re, fam] of COLOR_WORDS) if (re.test(t)) return fam;
  return "other";
}

function formalityOf(hg: string, title: string, handle: string): Formality {
  const t = `${title} ${handle}`.toLowerCase();
  if (/smoking|tuxedo|vadermoord|pliss|wingtip|wing.?collar|galadui|rokkostuum/.test(t)) return "black-tie";
  if (/jeans|denim|t-?shirt|sweat|hoodie|sneaker|cargo|short|bermuda/.test(t)) return "casual";
  if (hg === "Pakken" || hg === "Colberts") return "business";
  if (hg === "Overhemden") return /casual|flanel|oxford.*casual|linnen/.test(t) ? "smart-casual" : "business";
  if (hg === "Broeken") return /pantalon/.test(t) ? "business" : "smart-casual";
  if (hg === "Polo-shirts" || hg === "T-Shirts") return "casual";
  return "smart-casual";
}

/** Voorkeurs-kleurvolgorde + verboden kleuren per rol, gegeven doel-formaliteit/-kleur. */
function colorPlan(role: Role, formality: Formality, targetFam: Family): { pref: Family[]; forbid: Family[]; patent?: boolean } {
  const blackTie = formality === "black-tie";
  switch (role) {
    case "shirt":
      return { pref: ["white", "blue"], forbid: blackTie ? ["blue", "grey", "navy", "black", "brown", "tan", "beige", "green", "burgundy", "pink"] : [] };
    case "tie":
      return blackTie
        ? { pref: ["black"], forbid: [] }
        : { pref: ["burgundy", "navy", "blue", "green", "grey"], forbid: ["white"] }; // das moet contrasteren met wit overhemd
    case "jacket":
      // los colbert bij een broek: blauw/grijs klassiek, niet exact de broekkleur
      return { pref: ["navy", "blue", "grey", "charcoal"].filter((f) => f !== targetFam) as Family[], forbid: [targetFam] };
    case "trousers": {
      // pantalon contrasteert met (los) colbert; vermijd identieke kleur
      const map: Partial<Record<Family, Family[]>> = {
        navy: ["beige", "grey", "charcoal", "white"],
        blue: ["beige", "grey", "charcoal"],
        grey: ["navy", "charcoal", "beige"],
        charcoal: ["grey", "navy", "beige"],
        black: ["grey", "charcoal"],
        brown: ["beige", "navy", "grey"],
        tan: ["navy", "brown", "grey"],
        beige: ["navy", "brown", "grey"],
        green: ["beige", "grey", "navy"],
        burgundy: ["grey", "navy", "beige"],
      };
      if (blackTie) return { pref: ["black", "charcoal"], forbid: ["beige", "tan", "brown", "white", "green", "pink"] };
      return { pref: (map[targetFam] ?? ["navy", "beige", "grey"]), forbid: [targetFam] };
    }
    case "shoes": {
      if (blackTie) return { pref: ["black"], forbid: ["brown", "tan", "beige", "white", "green", "burgundy", "pink"], patent: true };
      // zwart alléén bij antraciet/zwart pak
      const darkSuit = targetFam === "black" || targetFam === "charcoal";
      if (darkSuit) return { pref: ["black"], forbid: ["tan", "beige"] };
      // Warme/gekleurde pakken (tan, beige, bruin, roze, bordeaux, groen of onbekend)
      // → ALTIJD onze bruine/cognac schoenen, NOOIT zwart.
      const warm = (["tan", "beige", "brown", "pink", "burgundy", "green", "other"] as Family[]).includes(targetFam);
      if (warm) return { pref: ["brown", "tan"], forbid: ["black", "white", "pink"] };
      // navy/grijs/blauw: bruin voorop, zwart mag als alternatief
      return { pref: ["brown", "tan", "black"], forbid: ["white", "pink"] };
    }
    case "belt":
      // riem volgt schoenkleur; wordt na de schoenkeuze bijgesteld
      return { pref: ["brown", "tan", "black"], forbid: ["white", "pink"] };
  }
}

function pick(cands: Cand[], plan: { pref: Family[]; forbid: Family[]; patent?: boolean }, exclude: Set<string>): Cand | null {
  const usable = cands.filter((c) => !exclude.has(c.handle) && !plan.forbid.includes(c.fam));
  const rank = (c: Cand) => {
    let i = plan.pref.indexOf(c.fam);
    if (i < 0) i = plan.pref.length + 1;
    if (plan.patent && c.patent) i -= 0.5; // lak heeft voorrang bij black-tie
    return i;
  };
  const sorted = usable.sort((a, b) => rank(a) - rank(b) || b.qty - a.qty);
  if (sorted.length) return sorted[0];
  // laatste redmiddel: hoogste voorraad binnen de rol, kleur niet ideaal maar wél leverbaar
  const fallback = cands.filter((c) => !exclude.has(c.handle)).sort((a, b) => b.qty - a.qty);
  return fallback[0] ?? null;
}

/**
 * Natuurlijke-taal styling voor de modelfoto-/look-generator (FASHN-prompt),
 * volgens de GENTS-stijlregels: warme/gekleurde pakken (zand, koraal, groen,
 * bordeaux, bruin…) → cognac/bruine schoenen; zwart alléén bij antraciet/zwart
 * of black-tie (dan zwarte lak); altijd een net WIT overhemd met kraag.
 * Hergebruikt dezelfde kleur-/formaliteitslogica als smartModelLook.
 */
export function modelStylePrompt(
  hg: string,
  colorLabel: string | null | undefined,
  title: string,
  handle: string,
): { shirt: string; shoes: string } {
  const formality = formalityOf(hg, title, handle);
  const fam = famOf(colorLabel, title, handle);
  const topShoe = colorPlan("shoes", formality, fam).pref[0];
  const shoes =
    formality === "black-tie"
      ? "black patent leather formal shoes"
      : topShoe === "brown" || topShoe === "tan"
        ? "cognac brown leather shoes"
        : "black leather shoes";
  const shirt =
    formality === "black-tie"
      ? "a crisp white formal dress shirt"
      : "a crisp white collared dress shirt";
  return { shirt, shoes };
}

/**
 * Bouwt een slimme, voorraad-/etiquette-correcte Look rond de modelfoto.
 * Retourneert null als de feature uit staat of het product geen modelfoto heeft.
 */
export async function smartModelLook(
  target: { handle: string; hoofdgroep: string; title: string; colorLabel?: string | null; modelImageUrl?: string | null },
  modelLook: Settings["modelLook"],
  minStock = 8,
): Promise<Look | null> {
  if (!modelLook?.enabled || !target.modelImageUrl) return null;

  const formality = formalityOf(target.hoofdgroep, target.title, target.handle);
  const targetFam = famOf(target.colorLabel, target.title, target.handle);
  let roles = rolesFor(target.hoofdgroep, formality);
  // Nooit de eigen categorie aanbevelen (geen schoen-bij-schoen, broek-bij-broek, …).
  const ownRoles = (Object.keys(HG_FOR_ROLE) as Role[]).filter((r) => HG_FOR_ROLE[r].includes(target.hoofdgroep));
  roles = roles.filter((r) => !ownRoles.includes(r));
  if (!roles.length) return null;

  // Eén query: alle in-aanmerking-komende hoofdgroepen, ruim op voorraad.
  const hgs = [...new Set(roles.flatMap((r) => HG_FOR_ROLE[r]))];
  const db = getDb();
  const rows = await db.execute<{ handle: string; title: string; vcl: string | null; hg: string; qty: number }>(sql`
    select handle, title, variant_color_label vcl, attributes->>'hoofdgroep_omschrijving' hg, stock_qty qty
    from products
    where status='active' and has_image and in_stock and is_group_primary and stock_qty >= ${minStock}
      and attributes->>'hoofdgroep_omschrijving' in (${sql.join(hgs.map((h) => sql`${h}`), sql`, `)})
  `);
  const cands: Cand[] = rows.rows.map((r) => ({
    handle: r.handle,
    title: r.title,
    hg: r.hg,
    qty: Number(r.qty) || 0,
    fam: famOf(r.vcl, r.title, r.handle),
    patent: /lak|patent/.test(`${r.title} ${r.handle}`.toLowerCase()),
  }));
  const byHg = (hg: string[]) => cands.filter((c) => hg.includes(c.hg));

  // Voorkeur-handles uit de admin-config, per hoofdgroep.
  const prefByHg = new Map<string, string>();
  for (const it of modelLook.items || []) if (it.handle) prefByHg.set(it.hoofdgroep, it.handle);

  const exclude = new Set<string>([target.handle]);
  const hotspots: Hotspot[] = [{ x: 50, y: TARGET_Y[target.hoofdgroep] ?? 36, handle: target.handle, label: "Dit item" }];
  let shoeFam: Family | null = null;

  for (const role of roles) {
    const hg = role === "tie" ? (formality === "black-tie" ? ["Strikken"] : ["Stropdassen"]) : HG_FOR_ROLE[role];
    const pool = byHg(hg);
    let plan = colorPlan(role, formality, targetFam);
    if (role === "belt" && shoeFam) plan = { pref: [shoeFam, "brown", "black"], forbid: ["white", "pink"] };
    // Schoen-PDP: de studiofoto toont een neutrale grijze broek → kies die ook,
    // niet een van de schoenkleur afgeleide zand-broek (anders ≠ het model).
    if (target.hoofdgroep === "Schoenen" && role === "trousers") plan = { pref: ["grey", "navy", "charcoal", "beige"], forbid: [] };

    // Admin-voorkeur respecteren als die ruim op voorraad is én niet verboden.
    const prefHandle = prefByHg.get(hg[0]);
    const pref = prefHandle ? pool.find((c) => c.handle === prefHandle && !plan.forbid.includes(c.fam)) : undefined;
    const chosen = pref ?? pick(pool, plan, exclude);
    if (!chosen) continue;
    exclude.add(chosen.handle);
    if (role === "shoes") shoeFam = chosen.fam;
    const pos = ROLE_POS[role];
    hotspots.push({ x: pos.x, y: pos.y, handle: chosen.handle, label: pos.label });
  }

  if (hotspots.length < 2) return null;
  return {
    slug: target.handle,
    title: "Compleet de look",
    subtitle: "Slim samengesteld — alles ruim op voorraad en volgens de stijlregels.",
    occasion: "Shop de look",
    image: target.modelImageUrl,
    hotspots,
  };
}
