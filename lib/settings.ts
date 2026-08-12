import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { DEFAULT_SYNONYMS } from "@/lib/search-helpers";

/**
 * Centrale, in de backend instelbare configuratie. Eén bron van waarheid
 * (DB-rij app_settings.global), met defaults als fallback. Alle business-knoppen
 * — verzending, cutoffs, levertijd, express-toeslag, drempels,
 * veiligheidsvoorraad — staan hier en zijn via /account/instellingen te
 * bewerken. Env-vars dienen alleen nog als initiële default.
 *
 * Cache: 30s in-proces, zodat een wijziging snel doorwerkt zonder elke request
 * de DB te raken.
 */

export type Settings = {
  // Verzendkosten
  freeShippingCents: number;
  shippingCents: number;
  expressSurchargeCents: number;
  // Cutoffs (NL-tijd, uur)
  warehouseCutoffHour: number;
  storeCutoffHour: number;
  branchCutoffs: Record<string, number>;
  /** Per-weekdag cutoff (NL-dagnaam → uur); overschrijft het basisuur op die dag.
   *  Bv. magazijn verzendt op vrijdag tot 16:00, winkels tot 17:00. */
  warehouseCutoffByDay: Record<string, number>;
  storeCutoffByDay: Record<string, number>;
  /** Minuten vóór sluitingstijd dat een winkelorder nog dezelfde dag weg kan.
   *  De cutoff van een winkel wordt nooit later dan haar sluitingstijd; deze
   *  marge houdt daarnaast rekening met inpakken + overdracht aan de vervoerder. */
  storeHandoverMinutes: number;
  /** Verzendt er iemand op zondag? Vervoerders halen dan niet op, dus standaard
   *  nee — anders belooft de site "vandaag verzonden" op een dag dat er niets
   *  vertrekt. Zaterdag kan wél (winkels zijn open, vervoerders bezorgen ma-za). */
  dispatchOnSunday: boolean;
  dispatchOnSaturdayStores: boolean;
  /** Filialen die tijdelijk GEEN orders mogen krijgen (verbouwing, vakantie-
   *  sluiting, onderbezetting). Ze blijven bestaan, maar de allocatie slaat ze
   *  over — zonder deploy of env-wijziging. */
  pausedBranchIds: string[];
  /** Extra verzendvrije dagen (yyyy-mm-dd) bovenop de feestdagen: bedrijfssluiting,
   *  personeelsdag, inventarisatie. Geldt voor alle filialen. */
  extraClosureDates: string[];
  // Levertijd (werkdagen)
  standardMinDays: number;
  standardMaxDays: number;
  warehouseTransitDays: number; // magazijn → bezorging
  storeExtraDays: number; // extra dagen als (deels) uit winkel/split
  expressTransitDays: number; // bezorging bij snellere levering
  // Voorraad-bescherming
  retailSafetyStock: number;
  warehouseSafetyStock: number;
  /* Marge voor het WINKEL-kanaal (kassa/winkels onderling). Los van de web-marge:
     de web-marge beschermt tegen verkopen aan een klant die het schap niet ziet;
     een verkoper in de winkel heeft het artikel in z'n handen. Kevin, 6 aug:
     "mag eraf voor winkels onderling". Default 0. */
  storeChannelSafetyStock: number;
  protectUnderstockedRetail: boolean;
  // Doorloop/overstock-routing: verzend bij voorkeur uit een winkel die ruim boven
  // z'n ideaal zit (trage/oude schapvoorraad eerst weg). minSurplus = drempel in
  // stuks waarboven een winkel zelfs vóór het magazijn mag gaan. Default uit.
  routeOverstockFirst: { enabled: boolean; minSurplus: number };
  // Zoeken
  searchSynonyms: string; // één groep per regel, komma-gescheiden
  // Shop-the-look op AI-modelfoto's: de vaste basis-outfit die het canvas-model
  // draagt (wit overhemd, zand pantalon, cognac derby). Per modelfoto wordt het
  // getoonde product hieraan toegevoegd → klikbare, shoppbare outfit op de PDP.
  modelLook: {
    enabled: boolean;
    minStock: number; // drempel "goed op voorraad" voor de slimme look-substitutie
    /**
     * Staan de bijpassende artikelen (broek, schoenen, riem) ook écht op de
     * modelfoto? Nu niet: de foto toont alleen het product zelf op een
     * basismodel, de rest wordt erbij gezocht. Daarom krijgen die geen cijfer
     * in de foto maar een "past hierbij"-rij ernaast. Zodra de modelfoto's
     * opnieuw gegenereerd zijn mét de echte look-artikelen, zet je dit aan en
     * springen de cijfers terug het beeld in.
     */
    hotspotsInBeeld: boolean;
    items: { handle: string; label: string; hoofdgroep: string; x: number; y: number }[];
  };
  // Cadeaubonnen: aan/uit, voorgestelde bedragen, grenzen voor een vrij bedrag,
  // en geldigheidsduur (maanden). Bedragen in centen.
  giftcardConfig: {
    enabled: boolean;
    presetAmountsCents: number[];
    minCents: number;
    maxCents: number;
    validityMonths: number;
  };
  // Staffelkorting: vanaf X artikelen Y% korting op het subtotaal. Default uit.
  tieredDiscount: {
    enabled: boolean;
    minItems: number;
    percentOff: number;
  };
  /**
   * Sale-weergave: hoeveel dagen ná een prijsverlaging we die verlaging nog als
   * sale tonen (doorgestreepte van-prijs + badge). Daarna is de lagere prijs
   * gewoon de normale prijs. Rekenkern: lib/pricing (computeReferencePrices).
   */
  saleAnnouncementDays: number;
  /* Welke betaalprovider de webshop gebruikt. Stond eerder alleen als env-var
     PAYMENT_PROVIDER in Vercel; die blijft als noodrem bestaan en gaat vóór op
     deze instelling (zie lib/payments.ts). Zonder deze knop was omschakelen
     alleen mogelijk met een deploy — en dat is precies hoe de webshop dagenlang
     op een Worldline-sleutel bleef staan die 403 gaf. */
  paymentProvider: "mollie" | "worldline";
  // Retouren: bedenktijd, retourkosten bij geld-terug (DHL-label), en of store
  // credit / omruilen altijd een gratis retour geeft.
  returnConfig: {
    windowDays: number;
    dhlReturnCostCents: number;
    freeOnCredit: boolean;
    // Signaal-drempels: een artikel is een "aandachtspunt" als het ≥ minReturns keer
    // terugkomt, ≥ minRatePct van het verkochte aantal, en gemiddeld ≤ fastDays na bestelling.
    signalMinReturns: number;
    signalMinRatePct: number;
    signalFastDays: number;
  };
  /* PAKBON — de tekst die de klant in de doos vindt. In de tool aanpasbaar
     (Kevin, 6 aug: "wij moeten zelf de pakbon kunnen aanpassen in de portal"),
     want dit is marketingtekst en geen code: een formulering die op de winkel-
     vloer scheef blijkt te staan moet je zonder release kunnen rechtzetten.
     Plaatshouders die de kassa invult: {dagen} {retourkosten} {winkels} {steden}.
     Lege lijst/tekst = die regel valt weg op de pakbon. */
  pakbon: {
    dankTekst: string;
    retourKop: string;
    retourRegels: string[];
    tweedeKop: string;
    tweedeRegels: string[];
    toonSteden: boolean;
  };
  /* FACTUURGEGEVENS — de bedrijfsregels onderaan de klantfactuur. In de tool en
     niet in code, want KvK/btw-nummer en IBAN veranderen zonder release. Leeg =
     die regel valt weg; er wordt nooit een nummer verzonnen. */
  factuur: {
    bedrijfsnaam: string;
    adres: string;
    postcodePlaats: string;
    kvk: string;
    btwNummer: string;
    iban: string;
    /** Btw-tarief in procenten op kleding (NL: 21). */
    btwPercent: number;
  };
  // Spaarpunten: na hoeveel dagen na BETALING verdiende punten besteedbaar worden
  // (vesting). Dekt de retourperiode, zodat een retour binnen het venster geen
  // terugvordering / negatief saldo geeft — de punten staan tot dan "in behandeling".
  loyaltyConfig: {
    vestingDays: number;
    /** Inwisselkoers: centen tegoedbon per punt (5 = 500 punten → € 25). */
    redeemCentsPerPoint: number;
    /** Minimaal in te wisselen punten. */
    redeemMinPoints: number;
    /** Inwisselen per veelvoud (0 = vrij bedrag). */
    redeemStepPoints: number;
    /** Geldigheid van de ingewisselde tegoedbon (dagen). */
    redeemVoucherDays: number;
    /**
     * Hoe ver de zelfherstel-cron terugkijkt naar orders die nooit punten kregen
     * (dagen). Bewust kort: de historie bijboeken is een geld-besluit (2,87 mln
     * punten over 23.476 klanten stond open bij het bouwen), geen bijwerking van
     * een deploy. Zet dit hoog of draai `npm run backfill:punten -- --doen` als je
     * de volledige historie alsnog wilt uitkeren.
     */
    backfillLookbackDays: number;
    /*
     * Eenmalige actie-bonussen die RETOUREN moeten terugdringen. Alle drie zorgen
     * dat we (en de klant zelf) weten wat er past: een bewaard maatprofiel, de
     * spaarpas in Wallet en een compleet profiel. Eén keer per klant, direct
     * besteedbaar — er hangt geen aankoop aan die teruggestuurd kan worden, dus
     * geen vesting. 0 = die bonus staat uit; de taak verdwijnt dan uit de
     * klant-UI (bestaande toekenningen blijven staan).
     */
    bonusPoints: {
      /** Maatprofiel bewaard — via /maatadvies of het tabblad Mijn maten. */
      sizeAdvice: number;
      /** Spaarpas écht toegevoegd aan Apple Wallet (device-registratie). */
      walletPass: number;
      /** Profiel compleet: leeftijd, kleuren, vaste winkel, gelegenheden. */
      profileComplete: number;
    };
  };
  /**
   * Terug-op-voorraad-meldingen: aan/uit + welke kanalen (mail/WhatsApp) mogen
   * versturen, en of + na hoeveel dagen een klant een ALTERNATIEF-op-maat krijgt
   * wanneer zijn maat na die periode nog steeds niet terug is.
   */
  stockNotifyConfig: {
    enabled: boolean;
    emailEnabled: boolean;
    whatsappEnabled: boolean;
    alternativeEnabled: boolean;
    alternativeAfterDays: number;
  };
  /**
   * Niet-leverbaar-afhandeling: krijgt de klant bij een annulering + terugbetaling
   * een bericht, en tonen we daarin alternatieven? Uit = stille terugbetaling
   * (zoals het vóór deze functie ging). In de tool te schakelen, niet in Vercel.
   */
  unfulfillableConfig: {
    /** Annuleringsmail versturen (uit = geen bericht bij een terugbetaling). */
    emailEnabled: boolean;
    /** Alternatieven meesturen/tonen. */
    alternativesEnabled: boolean;
    /** Hoeveel alternatieven maximaal (1-6). */
    alternativesCount: number;
  };
  /**
   * Merchandising-pins: per PLP-context (categorie/collectie) een geordende lijst
   * product-handles die bovenaan de "Aanbevolen"-sort komen. Sleutel = `${kind}:${slug}`
   * (bv. "categorie:pakken", "collection:bruiloft"). Beheerd vanuit de portal.
   */
  merchandisingPins: Record<string, string[]>;
  /**
   * Merchandising-regels: automatische boosts/demotions op productkenmerken
   * ("jaar 2026 omhoog", "NOS omlaag"), optioneel met een looptijd zodat
   * seizoensregels vanzelf aflopen. Vorm + compilatie naar SQL staan in
   * lib/merchandising-regels.ts (type MerchRegel). Beheerd vanuit de portal.
   */
  merchandisingRegels: unknown[];
  /**
   * Notificatie-mailadres per winkel (sleutel = winkelnaam of stad, lowercase,
   * bv. "amsterdam" of "gents amsterdam"). Gebruikt voor o.a. de
   * afspraak-notificatie naar de winkel. In de tool beheerbaar (settings-store);
   * env CONTACT_EMAIL_WEDDING/GENERAL is alleen fallback.
   */
  storeEmails: Record<string, string>;
  /**
   * Wie de interne bewakingsmeldingen krijgt (nu: de nachtelijke kassabon-
   * verificatie, app/api/cron/verify-possales). Meerdere adressen mag. Leeg =
   * niemand krijgt bericht en de melding blijft alleen in de cron-log staan —
   * dus dit hoort gevuld te zijn zolang er bewaking draait.
   * Env OPS_ALERT_EMAIL is alleen de initiële default.
   */
  alertEmails: string[];
};

const num = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const DEFAULT_SETTINGS: Settings = {
  freeShippingCents: num(process.env.GENTS_FREE_SHIPPING_CENTS, 7500),
  // NL-tarief conform de gepubliceerde DHL-staffel (bezorgpagina); andere
  // landen staan in lib/shipping-zones.
  shippingCents: num(process.env.GENTS_SHIPPING_CENTS, 395),
  expressSurchargeCents: num(process.env.GENTS_EXPRESS_SURCHARGE_CENTS, 150),
  /* Basisuur = het laatste moment dat een pakket nog dezelfde dag aan de
     vervoerder wordt meegegeven. Stond op 23 ("einde dag"), maar dat beloofde
     's avonds same-day-verzending terwijl er niets meer vertrok — op koopavond
     zelfs tot 21:00, want de winkel was dan nog open. 17 is een veilige
     aanname; zet hier het échte ophaalmoment neer (per filiaal kan via
     branchCutoffs, per weekdag via de overrides hieronder). */
  warehouseCutoffHour: num(process.env.GENTS_WAREHOUSE_CUTOFF_HOUR, 17),
  storeCutoffHour: num(process.env.GENTS_STORE_CUTOFF_HOUR, 17),
  branchCutoffs: {},
  warehouseCutoffByDay: { vrijdag: 16 },
  storeCutoffByDay: { vrijdag: 17 },
  storeHandoverMinutes: num(process.env.GENTS_STORE_HANDOVER_MINUTES, 0),
  dispatchOnSunday: false,
  dispatchOnSaturdayStores: true,
  pausedBranchIds: [],
  extraClosureDates: [],
  standardMinDays: num(process.env.GENTS_STANDARD_MIN_DAYS, 2),
  standardMaxDays: num(process.env.GENTS_STANDARD_MAX_DAYS, 3),
  warehouseTransitDays: 1,
  storeExtraDays: 1,
  expressTransitDays: 1,
  retailSafetyStock: num(process.env.GENTS_RETAIL_SAFETY_STOCK, 2),
  warehouseSafetyStock: num(process.env.GENTS_WAREHOUSE_SAFETY_STOCK, 0),
  storeChannelSafetyStock: num(process.env.GENTS_STORE_CHANNEL_SAFETY_STOCK, 0),
  protectUnderstockedRetail: (process.env.GENTS_PROTECT_UNDERSTOCKED ?? "1") !== "0",
  routeOverstockFirst: { enabled: false, minSurplus: 3 },
  searchSynonyms: DEFAULT_SYNONYMS,
  modelLook: {
    enabled: true,
    minStock: 8,
    hotspotsInBeeld: false,
    items: [
      { handle: "overhemd-nos-wit", label: "Overhemd", hoofdgroep: "Overhemden", x: 50, y: 21 },
      { handle: "pantalon-stretchkatoen-zand", label: "Pantalon", hoofdgroep: "Broeken", x: 50, y: 71 },
      { handle: "cognac-cap-toe", label: "Schoenen", hoofdgroep: "Schoenen", x: 50, y: 94 },
    ],
  },
  giftcardConfig: {
    enabled: true,
    presetAmountsCents: [2500, 5000, 10000, 15000],
    minCents: 1000,
    maxCents: 50000,
    validityMonths: 24,
  },
  tieredDiscount: { enabled: false, minItems: 2, percentOff: 10 },
  // 30 = DEFAULT_SALE_ANNOUNCEMENT_DAYS uit lib/pricing. Bewust hier als getal
  // herhaald en niet geïmporteerd: lib/pricing importeert dit bestand al, en een
  // import terug zou een cyclus geven waarbij DEFAULT_SETTINGS bij module-init
  // een half-geladen constante ziet.
  saleAnnouncementDays: num(process.env.GENTS_SALE_ANNOUNCEMENT_DAYS, 30),
  pakbon: {
    dankTekst: "Bedankt voor je bestelling. Hieronder zie je wat er in dit pakket zit, en wat je kunt doen als iets niet klopt of niet past.",
    retourKop: "RUILEN OF RETOURNEREN",
    retourRegels: [
      "Je hebt {dagen} dagen bedenktijd.",
      "Gratis retour met een GENTS-tegoed, of lever het in",
      "bij een van onze {winkels} winkels.",
      "Wil je het bedrag op je rekening terug? Dan houden",
      "we {retourkosten} retourkosten in.",
      "Regel het op gents.nl/retourneren en leg deze",
      "pakbon bij je retourzending.",
    ],
    tweedeKop: "VERMAAKSERVICE",
    tweedeRegels: [
      "Net niet de juiste pasvorm? In onze winkels maken",
      "we mouwen, pijpen en taille passend met onze",
      "vermaakservice. Kom gerust even langs.",
    ],
    toonSteden: true,
  },
  factuur: {
    // Naam + adres staan al zo in de klantmails (lib/email.ts). KvK, btw-nummer en
    // IBAN bewust LEEG: die vul je in de instellingen in. Een verzonnen nummer op
    // een factuur is erger dan een ontbrekende regel — de regel valt gewoon weg.
    bedrijfsnaam: "GENTS B.V.",
    adres: "Lemelerbergweg 15",
    postcodePlaats: "1101 AJ Amsterdam",
    kvk: process.env.GENTS_KVK || "",
    btwNummer: process.env.GENTS_BTW_NUMMER || "",
    iban: process.env.GENTS_IBAN || "",
    btwPercent: num(process.env.GENTS_BTW_PERCENT, 21),
  },
  paymentProvider: "mollie",
  returnConfig: {
    windowDays: num(process.env.GENTS_RETURN_WINDOW_DAYS, 14),
    dhlReturnCostCents: num(process.env.GENTS_RETURN_DHL_COST_CENTS, 499), // S-pakket heenzending, ex toeslagen (eigen DHL-contract)
    freeOnCredit: (process.env.GENTS_RETURN_FREE_ON_CREDIT ?? "1") !== "0",
    signalMinReturns: num(process.env.GENTS_RETURN_SIGNAL_MIN, 3),
    signalMinRatePct: num(process.env.GENTS_RETURN_SIGNAL_RATE, 30),
    signalFastDays: num(process.env.GENTS_RETURN_SIGNAL_FAST_DAYS, 7),
  },
  loyaltyConfig: {
    vestingDays: num(process.env.GENTS_LOYALTY_VESTING_DAYS, 21),
    redeemCentsPerPoint: num(process.env.GENTS_LOYALTY_REDEEM_CENTS_PER_POINT, 5), // 500 punten = € 25
    redeemMinPoints: num(process.env.GENTS_LOYALTY_REDEEM_MIN_POINTS, 500),
    redeemStepPoints: num(process.env.GENTS_LOYALTY_REDEEM_STEP_POINTS, 500),
    redeemVoucherDays: num(process.env.GENTS_LOYALTY_REDEEM_VOUCHER_DAYS, 365),
    backfillLookbackDays: num(process.env.GENTS_LOYALTY_BACKFILL_LOOKBACK_DAYS, 30),
    bonusPoints: {
      sizeAdvice: num(process.env.GENTS_LOYALTY_BONUS_SIZE_ADVICE, 50),
      walletPass: num(process.env.GENTS_LOYALTY_BONUS_WALLET, 50),
      profileComplete: num(process.env.GENTS_LOYALTY_BONUS_PROFILE, 50),
    },
  },
  stockNotifyConfig: {
    enabled: true,
    emailEnabled: true,
    whatsappEnabled: true,
    alternativeEnabled: true,
    alternativeAfterDays: num(process.env.GENTS_STOCK_ALT_DAYS, 14),
  },
  unfulfillableConfig: {
    emailEnabled: true,
    alternativesEnabled: true,
    alternativesCount: 3,
  },
  merchandisingPins: {},
  merchandisingRegels: [],
  storeEmails: {},
  alertEmails: (process.env.OPS_ALERT_EMAIL || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean),
};

let _cache: Settings | null = null;
let _at = 0;
const TTL = 30_000;

export async function getSettings(): Promise<Settings> {
  if (_cache && Date.now() - _at < TTL) return _cache;
  try {
    const db = getDb();
    const rows = await db.select().from(appSettings).where(eq(appSettings.id, "global")).limit(1);
    const stored = (rows[0]?.data ?? {}) as Partial<Settings>;
    _cache = {
      ...DEFAULT_SETTINGS,
      ...stored,
      branchCutoffs: { ...DEFAULT_SETTINGS.branchCutoffs, ...(stored.branchCutoffs || {}) },
      warehouseCutoffByDay: { ...DEFAULT_SETTINGS.warehouseCutoffByDay, ...(stored.warehouseCutoffByDay || {}) },
      storeCutoffByDay: { ...DEFAULT_SETTINGS.storeCutoffByDay, ...(stored.storeCutoffByDay || {}) },
      modelLook: { ...DEFAULT_SETTINGS.modelLook, ...(stored.modelLook || {}) },
      giftcardConfig: { ...DEFAULT_SETTINGS.giftcardConfig, ...(stored.giftcardConfig || {}) },
      tieredDiscount: { ...DEFAULT_SETTINGS.tieredDiscount, ...(stored.tieredDiscount || {}) },
      returnConfig: { ...DEFAULT_SETTINGS.returnConfig, ...(stored.returnConfig || {}) },
      /* Twee niveaus diep: een opgeslagen loyaltyConfig van vóór de actie-bonussen
         heeft nog geen `bonusPoints`, en een ondiepe merge zou die dan op undefined
         zetten — een klant kreeg dan stil 0 punten voor z'n maatprofiel. */
      loyaltyConfig: {
        ...DEFAULT_SETTINGS.loyaltyConfig,
        ...(stored.loyaltyConfig || {}),
        bonusPoints: { ...DEFAULT_SETTINGS.loyaltyConfig.bonusPoints, ...(stored.loyaltyConfig?.bonusPoints || {}) },
      },
      routeOverstockFirst: { ...DEFAULT_SETTINGS.routeOverstockFirst, ...(stored.routeOverstockFirst || {}) },
      stockNotifyConfig: { ...DEFAULT_SETTINGS.stockNotifyConfig, ...(stored.stockNotifyConfig || {}) },
      unfulfillableConfig: { ...DEFAULT_SETTINGS.unfulfillableConfig, ...(stored.unfulfillableConfig || {}) },
      storeEmails: { ...DEFAULT_SETTINGS.storeEmails, ...(stored.storeEmails || {}) },
      /* Lijsten: opgeslagen waarde wint volledig (geen merge — anders kun je een
         gepauzeerd filiaal nooit meer weghalen), maar wel altijd een array. */
      pausedBranchIds: Array.isArray(stored.pausedBranchIds) ? stored.pausedBranchIds.map(String) : [],
      extraClosureDates: Array.isArray(stored.extraClosureDates) ? stored.extraClosureDates.map(String) : [],
      /* Een leeg opgeslagen lijstje is een bewuste keuze ("stuur niemand iets")
         en mag dus niet stil terugvallen op de env-default; alleen als het veld
         nooit gezet is telt die default nog. */
      alertEmails: Array.isArray(stored.alertEmails) ? stored.alertEmails : DEFAULT_SETTINGS.alertEmails,
    };
  } catch {
    _cache = DEFAULT_SETTINGS;
  }
  _at = Date.now();
  return _cache;
}

/** Werkt een deelverzameling instellingen bij (admin) en leegt de cache. */
export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const db = getDb();
  const current = await getSettings();
  const next: Settings = { ...current, ...patch };
  await db
    .insert(appSettings)
    .values({ id: "global", data: next, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: next, updatedAt: sql`now()` } });
  _cache = next;
  _at = Date.now();
  return next;
}

export function clearSettingsCache() {
  _cache = null;
  _at = 0;
}
