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

/**
 * Wat de MODELFOTO al laat zien, per productsoort. Afgeleid uit de prompts
 * waarmee die foto's gemaakt worden (scripts/generate-model-photos.ts): bij een
 * broek staat er letterlijk "with a tucked shirt and shoes", dus die twee staan
 * gegarandeerd op het beeld. Dat script valideert bij het opstarten dat zijn
 * prompt-teksten nog met deze map overeenkomen — loopt de prompt voor, dan
 * faalt de generator hard in plaats van dat de site stilletjes het beeld
 * tegenspreekt.
 *
 * Waarom dit ertoe doet: een suggestie voor iets wat al op de foto staat mag
 * het beeld niet tegenspreken. Het model draagt cognac loafers en ernaast een
 * zwarte derby voorstellen — dan klopt het advies misschien, maar de klant ziet
 * iets anders dan hij leest. De foto-styling is echter DETERMINISTISCH
 * (modelStylePrompt, verderop in dit bestand): altijd een wit kraag-overhemd,
 * schoenen volgens colorPlan-pref[0], broek "matching" of neutraal. Voor een
 * in-beeld-rol vergrendelen we daarom het kleurplan op precies die styling
 * (fotoPlanFor) — de suggestie ís dan wat de klant ziet. Vinden we binnen dat
 * smalle plan niets op voorraad, dan liever géén hotspot dan een tegenspraak.
 * Zie ook Hotspot.inBeeld in lib/looks.ts.
 */
export const AL_IN_BEELD: Record<string, Role[]> = {
  Pakken: ["shirt", "shoes"],
  Colberts: ["shirt", "trousers", "shoes"],
  Gilets: ["shirt", "trousers", "shoes"],
  Jassen: ["trousers", "shoes"],
  Broeken: ["shirt", "shoes"],
  // Sinds de overhemd-zin de berekende styling gebruikt staan de schoenen er
  // ook op ("neatly styled with trousers and <shoes>"), dus mag shop-de-look
  // daar geen andere schoen bij voorstellen.
  Overhemden: ["trousers", "shoes"],
  Truien: ["trousers"],
  Vesten: ["shirt", "trousers"],
  "Polo-shirts": ["trousers"],
  "T-Shirts": ["trousers"],
  Schoenen: ["trousers"],
};

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
  // "rokkostuum" stond er wél in, maar de artikelen heten rokjas, rokvest,
  // rokstrik en broek-rok-smok — die vielen dus door naar smart-casual en
  // kregen cognac bruine schoenen bij een rokkostuum. Idem de lakschoen: de
  // kleurtabel wist allang dat lak zwart lakleer is, de formaliteit niet.
  if (/smoking|tuxedo|vadermoord|pliss|wingtip|wing.?collar|galadui|rokkostuum|\brok|jacquet|lakschoen|lakleer|\blak\b|patent/.test(t)) return "black-tie";
  // Een strik is in deze catalogus per definitie gala — losse dassen zitten in
  // "Stropdassen". Op de hoofdgroep toetsen is preciezer dan op de titel.
  if (hg === "Strikken") return "black-tie";
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

function pick(cands: Cand[], plan: { pref: Family[]; forbid: Family[]; patent?: boolean }, exclude: Set<string>, strikt = false): Cand | null {
  // strikt = foto-vergrendeld: alléén de pref-kleuren zijn toegestaan, want de
  // suggestie moet tonen wat er op de modelfoto staat.
  const usable = cands.filter((c) => !exclude.has(c.handle) && !plan.forbid.includes(c.fam) && (!strikt || plan.pref.includes(c.fam)));
  const rank = (c: Cand) => {
    let i = plan.pref.indexOf(c.fam);
    if (i < 0) i = plan.pref.length + 1;
    if (plan.patent && c.patent) i -= 0.5; // lak heeft voorrang bij black-tie
    return i;
  };
  const sorted = usable.sort((a, b) => rank(a) - rank(b) || b.qty - a.qty);
  if (sorted.length) return sorted[0];
  // Foto-vergrendeld en niets binnen het plan → liever geen suggestie dan een
  // artikel dat vloekt met wat de klant op de foto ziet.
  if (strikt) return null;
  // laatste redmiddel: hoogste voorraad binnen de rol, kleur niet ideaal maar wél leverbaar
  const fallback = cands.filter((c) => !exclude.has(c.handle)).sort((a, b) => b.qty - a.qty);
  return fallback[0] ?? null;
}

/**
 * Het kleurplan voor een rol die AL OP DE MODELFOTO staat: precies de styling
 * waarmee die foto gegenereerd is (spiegel van modelStylePrompt + de
 * STYLE-prompts in scripts/generate-model-photos.ts). Wordt strikt toegepast:
 * buiten dit plan kiezen zou de foto tegenspreken.
 */
function fotoPlanFor(role: Role, hoofdgroep: string, formality: Formality, targetFam: Family): { pref: Family[]; forbid: Family[]; patent?: boolean } | null {
  switch (role) {
    case "shirt":
      // De prompt zegt altijd "a crisp white collared dress shirt".
      return { pref: ["white"], forbid: [] };
    case "shoes": {
      // Zelfde beslisregel als modelStylePrompt: black-tie → zwarte lak, anders
      // pref[0] van het gewone schoenenplan (cognac/bruin bij warme kleuren, zwart bij koel).
      if (formality === "black-tie") return { pref: ["black"], forbid: [], patent: true };
      const top = colorPlan("shoes", formality, targetFam).pref[0];
      return top === "brown" || top === "tan" ? { pref: ["brown", "tan"], forbid: [] } : { pref: ["black"], forbid: [] };
    }
    case "trousers":
      // Bij black-tie zegt de prompt "black tuxedo trousers" — dan mag de
      // suggestie geen beige pantalon zijn.
      if (formality === "black-tie") return { pref: ["black", "charcoal"], forbid: [] };
      // Colberts/Gilets-prompt zegt "with matching trousers" → de kleur van het
      // kledingstuk zelf. Overige prompts ("neat/well-fitted trousers") tonen een
      // neutrale nette broek — grijs/navy/antraciet/beige.
      return hoofdgroep === "Colberts" || hoofdgroep === "Gilets"
        ? { pref: [targetFam], forbid: [] }
        : { pref: ["grey", "navy", "charcoal", "beige"], forbid: [] };
    default:
      // Rol staat op de foto maar zonder vaste stijl in de prompt → gewone plan.
      return null;
  }
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
): { shirt: string; shoes: string; neckwear: string; trousers: string; blackTie: boolean } {
  const formality = formalityOf(hg, title, handle);
  const fam = famOf(colorLabel, title, handle);
  const topShoe = colorPlan("shoes", formality, fam).pref[0];
  const blackTie = formality === "black-tie";
  const shoes = blackTie
    ? "black patent leather formal shoes"
    : topShoe === "brown" || topShoe === "tan"
      ? "cognac brown leather shoes"
      : "black leather shoes";
  const shirt = blackTie ? "a crisp white formal dress shirt" : "a crisp white collared dress shirt";
  // Bij black-tie hoort een strik. Die stond nergens in de prompt, dus vroeg het
  // team er per product handmatig om — bij een smokingoverhemd zelfs meerdere
  // keren, want er was geen enkele plek waar neckwear genoemd werd.
  const neckwear = blackTie ? "a black bow tie" : "";
  const trousers = blackTie ? "black tuxedo trousers" : "matching trousers";
  return { shirt, shoes, neckwear, trousers, blackTie };
}

export type Styling = ReturnType<typeof modelStylePrompt>;

/** Is dit een gala-artikel? Voor generators die geen volledige styling nodig hebben. */
export function isBlackTie(hg: string, title: string, handle: string): boolean {
  return formalityOf(hg, title, handle) === "black-tie";
}

/**
 * De zin die het kledingstuk beschrijft — DE bron voor alle modelfoto-prompts:
 * de hergenerator (lib/model-photo.ts), de bulk-generator en de tweede pose.
 *
 * Stond eerder drie keer los gekopieerd, en dat liep uiteen: de hergenerator
 * kende geen Schoenen, de bulk-generator geen strik, en bij Overhemden gooiden
 * ze allebei de berekende styling weg zodat een smokingoverhemd als los overhemd
 * werd beschreven. Eén plek, één waarheid.
 */
export function garmentSentence(hg: string, s: Styling): string {
  const das = s.neckwear ? ` with ${s.neckwear}` : "";
  switch (hg) {
    case "Pakken": return `Male model wearing THIS suit, complete with ${s.shirt}${das} and ${s.shoes}.`;
    case "Colberts": return `Male model wearing THIS blazer over ${s.shirt}${das}, with ${s.trousers} and ${s.shoes}.`;
    case "Gilets": return `Male model wearing THIS waistcoat over ${s.shirt}${das}, with ${s.trousers} and ${s.shoes}. The lowest button of the waistcoat is left open.`;
    case "Broeken": return `Male model wearing THESE trousers with ${s.shirt} tucked in${s.neckwear ? `, wearing ${s.neckwear}` : ""}, and ${s.shoes}.`;
    case "Overhemden": return `Male model wearing THIS shirt${das}, neatly styled with ${s.blackTie ? "black tuxedo trousers" : "trousers"} and ${s.shoes}.`;
    case "Truien": return "Male model wearing THIS knitwear, styled with neat trousers.";
    case "Vesten": return "Male model wearing THIS cardigan/vest over a shirt, styled with neat trousers.";
    case "Polo-shirts": return "Male model wearing THIS polo shirt, styled with neat trousers.";
    case "T-Shirts": return "Male model wearing THIS t-shirt, styled casually with neat trousers.";
    case "Jassen": return "Male model wearing THIS coat over neat menswear, with trousers and leather shoes.";
    case "Schoenen": return `Male model wearing THESE shoes with ${s.blackTie ? "black tuxedo trousers and dark dress socks" : "well-fitted trousers"}.`;
    case "Riemen": return `Male model wearing THIS belt with well-fitted trousers, ${s.shirt} tucked in, and ${s.shoes}.`;
    case "Stropdassen": return `Male model wearing THIS tie with ${s.shirt} and a classic jacket.`;
    case "Strikken": return `Male model wearing THIS bow tie with ${s.shirt} and a black tuxedo jacket.`;
    default: return "Male model wearing THIS item, neatly styled with classic menswear.";
  }
}

export type Frame = "full" | "upper" | "lower";

/** Hoe strak we inzoomen. Kleine artikelen vanaf het middel, bovenkleding vanaf de knie. */
export function frameFor(hg: string): Frame {
  switch (hg) {
    case "Schoenen": case "Riemen": return "lower";
    case "Overhemden": case "Truien": case "Vesten": case "Polo-shirts": case "T-Shirts":
    case "Stropdassen": case "Strikken": return "upper";
    default: return "full";
  }
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
  // Rollen die al op de modelfoto staan worden NIET geschrapt maar kleur-
  // vergrendeld op de foto-styling (fotoPlanFor) — schrappen liet de hele
  // sectie verdwijnen op jassen/gilets en maakte pakken afhankelijk van één
  // dassen-voorraadje. Zie het commentaar bij AL_IN_BEELD.
  const inBeeld = AL_IN_BEELD[target.hoofdgroep] ?? [];

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
  // Alleen DIT product staat echt op de modelfoto (de FASHN-pipeline zet het op
  // een basismodel). Alles wat hieronder wordt bijgezocht is styling-advies, geen
  // weergave van het beeld — vandaar inBeeld: false, tenzij de foto's opnieuw
  // gegenereerd zijn mét de echte look-artikelen (instelling hotspotsInBeeld).
  const echtInBeeld = modelLook.hotspotsInBeeld === true;
  const hotspots: Hotspot[] = [
    { x: 50, y: TARGET_Y[target.hoofdgroep] ?? 36, handle: target.handle, label: "Dit item", inBeeld: true },
  ];
  let shoeFam: Family | null = null;

  for (const role of roles) {
    const hg = role === "tie" ? (formality === "black-tie" ? ["Strikken"] : ["Stropdassen"]) : HG_FOR_ROLE[role];
    const pool = byHg(hg);
    let plan = colorPlan(role, formality, targetFam);
    if (role === "belt" && shoeFam) plan = { pref: [shoeFam, "brown", "black"], forbid: ["white", "pink"] };
    // Staat deze rol al op de modelfoto? Dan het plan vergrendelen op de
    // foto-styling — behálve als de foto's opnieuw gegenereerd zijn mét de
    // echte look-artikelen (hotspotsInBeeld): dan tonen de admin-items het
    // beeld al en zou de vergrendeling ze juist wegdrukken.
    const fotoLock = !echtInBeeld && inBeeld.includes(role) ? fotoPlanFor(role, target.hoofdgroep, formality, targetFam) : null;
    if (fotoLock) plan = fotoLock;

    // Admin-voorkeur respecteren als die ruim op voorraad is én binnen het plan valt.
    const prefHandle = prefByHg.get(hg[0]);
    const pref = prefHandle
      ? pool.find((c) => c.handle === prefHandle && !plan.forbid.includes(c.fam) && (!fotoLock || plan.pref.includes(c.fam)))
      : undefined;
    const chosen = pref ?? pick(pool, plan, exclude, !!fotoLock);
    if (!chosen) continue;
    exclude.add(chosen.handle);
    if (role === "shoes") shoeFam = chosen.fam;
    const pos = ROLE_POS[role];
    hotspots.push({ x: pos.x, y: pos.y, handle: chosen.handle, label: pos.label, inBeeld: echtInBeeld });
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
