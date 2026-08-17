/**
 * lib/sandbox-anonimiseren.ts — haalt de persoonsgegevens uit een verse kopie
 * van productie.
 *
 * WAAROM DIT BESTAAT
 * De sandbox wordt 's nachts ververst vanaf productie, zodat je met echte
 * volumes en echte randgevallen test. Maar de sandbox is bewust laagdrempelig:
 * iedereen die kan inloggen mag rondkijken, en de grenzen zijn er losser dan in
 * productie. Een onbewerkte kopie zet daarmee het hele klantenbestand in een
 * omgeving met minder bescherming — een AVG-verwerking die je niet wilt hoeven
 * verantwoorden.
 *
 * Deze stap draait dus DIRECT na de branch-reset, vóór iemand erbij kan.
 *
 * WAT ER OVERBLIJFT
 * De structuur en de aantallen. Hoeveel orders, hoe oud, welke statussen, welke
 * artikelen, welke rare combinaties uit tien jaar historie — dat blijft allemaal
 * staan. Alleen: niet meer herleidbaar tot een persoon.
 *
 * DRIE SOORTEN WERK
 *  1. Kolommen overschrijven (namen, adressen, mailadressen, telefoonnummers).
 *  2. Rijen weggooien die niet alleen gegevens zijn maar TOEGANG geven —
 *     sessies, magic-links, pushtokens. Die horen sowieso niet in een kopie.
 *  3. JSON-velden schonen. Dat is het lastigste deel: `pos_sales.data` bevat de
 *     complete verkoop zoals de kassa hem bouwt, en de vorm daarvan verandert
 *     mee met de kassa. Losse sleutels opsommen zou stilletjes verouderen, dus
 *     doen we het met een recursieve functie die op VORM herkent (ziet iets
 *     eruit als een mailadres, of heet een sleutel "naam"?) in plaats van op een
 *     vaste lijst. Nieuwe velden worden zo automatisch meegenomen.
 *
 * Idempotent: twee keer draaien geeft hetzelfde resultaat. Unieke sleutels
 * blijven uniek doordat overal het rij-id in de vervangende waarde zit.
 */

/**
 * Recursieve JSON-schoonmaker als databasefunctie. Loopt door objecten en
 * lijsten heen en vervangt op twee manieren:
 *  - op SLEUTELNAAM: alles wat "naam", "adres", "notitie" en dergelijke heet;
 *  - op VORM: elke tekst die eruitziet als een mailadres, waar hij ook staat.
 *
 * Die tweede regel is de vangnetregel — daarmee blijft de schoonmaak werken als
 * de kassa er morgen een veld bij krijgt dat niemand hier heeft ingevuld.
 */
const JSON_SCHOONMAKER = `
CREATE OR REPLACE FUNCTION sandbox_schoon_json(waarde jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  uit jsonb;
  sleutel text;
  onderdeel jsonb;
  tekst text;
BEGIN
  IF waarde IS NULL THEN RETURN NULL; END IF;

  IF jsonb_typeof(waarde) = 'object' THEN
    uit := '{}'::jsonb;
    FOR sleutel, onderdeel IN SELECT * FROM jsonb_each(waarde) LOOP
      IF sleutel ~* '^(e[-_]?mail|mail(adres)?)$' THEN
        uit := uit || jsonb_build_object(sleutel, 'weg@sandbox.invalid');
      ELSIF sleutel ~* '^(phone|telefoon|tel|mobiel|mobile|gsm)([-_]?(nr|nummer|number))?$' THEN
        uit := uit || jsonb_build_object(sleutel, '0600000000');
      ELSIF sleutel ~* '^((first|last|full|customer|klant|contact|voor|achter)[-_]?)?(name|naam)$' THEN
        uit := uit || jsonb_build_object(sleutel, 'Sandbox Klant');
      ELSIF sleutel ~* '^(street|straat|address|adres|house[-_]?number|huisnummer|postal[-_]?code|postcode|zip|city|stad|plaats|note|notes|notitie|opmerking|message|bericht|iban)$' THEN
        uit := uit || jsonb_build_object(sleutel, '');
      ELSE
        uit := uit || jsonb_build_object(sleutel, sandbox_schoon_json(onderdeel));
      END IF;
    END LOOP;
    RETURN uit;
  END IF;

  IF jsonb_typeof(waarde) = 'array' THEN
    RETURN COALESCE(
      (SELECT jsonb_agg(sandbox_schoon_json(el)) FROM jsonb_array_elements(waarde) el),
      '[]'::jsonb
    );
  END IF;

  IF jsonb_typeof(waarde) = 'string' THEN
    tekst := waarde #>> '{}';
    IF tekst ~* '^[^@[:space:]]+@[^@[:space:]]+\\.[a-z]{2,}$' THEN
      RETURN to_jsonb('weg@sandbox.invalid'::text);
    END IF;
    RETURN waarde;
  END IF;

  RETURN waarde;
END;
$fn$;
`;

/**
 * De stappen, op volgorde. Elk apart uitgevoerd zodat je in het logboek precies
 * ziet wélke stap klapte als er iets misgaat — een enkele grote transactie zou
 * bij een schemawijziging alleen "mislukt" zeggen.
 */
export type Stap = { naam: string; sql: string };

export const ANONIMISEER_STAPPEN: Stap[] = [
  { naam: "JSON-schoonmaker aanmaken", sql: JSON_SCHOONMAKER },

  /* ── 1. Toegang weggooien ────────────────────────────────────────────────
     Dit zijn geen gegevens maar sleutels. Een geldige magic-link uit de kopie
     zou in de sandbox gewoon werken, en een Apple-pushtoken wijst naar de
     telefoon van een echte klant. Weg ermee, niet maskeren. */
  { naam: "Klantsessies en magic-links verwijderen", sql: `DELETE FROM customer_sessions;` },
  { naam: "Apple Wallet-registraties verwijderen", sql: `DELETE FROM wallet_apple_registrations;` },

  /* ── 2. Klanten ──────────────────────────────────────────────────────────
     Het id in het mailadres houdt de unieke index heel én maakt een klant
     herkenbaar tussen tabellen door, zodat gekoppelde gegevens blijven kloppen. */
  {
    naam: "Klanten anonimiseren",
    sql: `
      UPDATE customers SET
        email = 'klant-' || id || '@sandbox.invalid',
        first_name = 'Klant',
        last_name = substr(id::text, 1, 8),
        phone = '0600000000',
        password_hash = NULL,
        profile_completion_token_hash = NULL,
        srs_customer_id = NULL,
        preferences = sandbox_schoon_json(preferences);
    `,
  },
  {
    naam: "Klantadressen anonimiseren",
    sql: `
      UPDATE customer_addresses SET
        first_name = 'Klant',
        last_name = substr(id::text, 1, 8),
        street = 'Teststraat',
        house_number = '1',
        postal_code = '1000 AA',
        city = 'Sandbox';
    `,
  },

  /* ── 3. Bestellingen ─────────────────────────────────────────────────────
     access_token is de sleutel achter de "volg je bestelling"-link uit de
     bevestigingsmail. Een echte token in de sandbox betekent dat een tester de
     orderstatuspagina van een échte klant kan openen — op productie. Daarom
     krijgt elke order een nieuwe. Ook de Mollie- en couponcodes gaan eruit:
     die zijn buiten de sandbox bruikbaar. */
  {
    naam: "Bestellingen anonimiseren",
    sql: `
      UPDATE orders SET
        email = 'order-' || id || '@sandbox.invalid',
        first_name = 'Klant',
        last_name = substr(id::text, 1, 8),
        phone = '0600000000',
        street = 'Teststraat',
        house_number = '1',
        postal_code = '1000 AA',
        city = 'Sandbox',
        company_name = CASE WHEN company_name <> '' THEN 'Sandbox BV' ELSE '' END,
        vat_number = CASE WHEN vat_number <> '' THEN 'NL000000000B01' ELSE '' END,
        access_token = CASE WHEN access_token IS NULL THEN NULL ELSE 'sb-' || md5(random()::text || id::text) END,
        mollie_payment_id = NULL,
        voucher_code = CASE WHEN voucher_code <> '' THEN 'SB-VOUCHER' ELSE '' END,
        giftcard_code = CASE WHEN giftcard_code <> '' THEN 'SB-CADEAUBON' ELSE '' END,
        fulfillment_plan = sandbox_schoon_json(fulfillment_plan);
    `,
  },

  /* ── 4. Kassa ────────────────────────────────────────────────────────────
     pos_sales.data is de volledige verkoop zoals de kassa hem bouwt; de vorm
     verandert mee met de kassa, dus hier doet de recursieve schoonmaker het
     werk in plaats van een lijst met veldnamen. */
  {
    naam: "Kassaverkopen anonimiseren",
    sql: `UPDATE pos_sales SET customer_id = '', data = sandbox_schoon_json(data);`,
  },
  {
    naam: "Dagafsluitingen anonimiseren",
    sql: `UPDATE pos_closings SET note = '', actor = sandbox_schoon_json(actor);`,
  },
  {
    naam: "Winkelaankopen anonimiseren",
    sql: `
      UPDATE store_purchases SET
        email = 'winkel-' || id || '@sandbox.invalid',
        lines = sandbox_schoon_json(lines);
    `,
  },

  /* ── 4b. Het 360-profiel (CDP) ───────────────────────────────────────────
     customer_profiles is de leescopie waar elke doelgroepregel op draait: een
     tweede exemplaar van de klantidentiteit, náást `customers`. Zonder deze stap
     stond het hele klantenbestand alsnog in de sandbox, ook al waren de klanten
     zelf netjes geschoond.

     De _sha256-velden verdienen aparte aandacht. Dat is precies wat er naar Meta
     en Google Ads gaat, en een hash van een echt mailadres is gewoon herleidbaar
     (hash je een bekend adres, dan match je de klant). Ze blijven dus niet staan
     en worden ook niet leeggemaakt, maar OPNIEUW BEREKEND over de nepwaarden —
     dan blijft de uitlevering in de sandbox testbaar met hashes die buiten de
     sandbox niemand aanwijzen. Het mailadres volgt exact de vorm uit stap 2,
     zodat profiel en klant aan elkaar gekoppeld blijven. */
  {
    naam: "360-profielen anonimiseren",
    sql: `
      UPDATE customer_profiles SET
        email = 'klant-' || customer_id || '@sandbox.invalid',
        email_sha256 = encode(sha256(convert_to('klant-' || customer_id || '@sandbox.invalid', 'UTF8')), 'hex'),
        phone_e164 = '+31600000000',
        phone_sha256 = encode(sha256(convert_to('+31600000000', 'UTF8')), 'hex'),
        voornaam_sha256 = encode(sha256(convert_to('klant', 'UTF8')), 'hex'),
        achternaam_sha256 = encode(sha256(convert_to(substr(customer_id::text, 1, 8), 'UTF8')), 'hex'),
        postcode = '1000 AA',
        plaats = 'Sandbox',
        srs_customer_id = '';
    `,
  },
  {
    /* De doelgroep zelf is geen persoonsgegeven — naam en definitie blijven dus
       staan, anders test je met lege doelgroepen. Alleen wie hem aanmaakte is
       een persoon (een medewerker), en een sync-fout kan een klantadres in de
       tekst hebben staan. */
    naam: "Doelgroepen ontdoen van namen",
    sql: `
      UPDATE audiences SET aangemaakt_door = '' WHERE aangemaakt_door <> '';
      UPDATE audience_syncs SET fout = '' WHERE fout <> '';
    `,
  },

  /* ── 4c. Wat van buiten binnenkomt ───────────────────────────────────────
     Bol-orders, Returnista-retouren en de Spotler-mailstatistiek. Allemaal met
     échte adressen erin, inclusief de rauwe payload in `regels`/`data` — die
     gaat door dezelfde recursieve JSON-schoonmaker als de kassabonnen.

     externe_orders en externe_retouren koppelen aan een klant via customer_id,
     niet via het adres; daar mag het mailadres dus gewoon vervangen worden
     zonder dat het 360-profiel z'n koppeling kwijtraakt. */
  {
    naam: "Externe orders en retouren anonimiseren",
    sql: `
      UPDATE externe_orders SET
        email = 'extern-' || id || '@sandbox.invalid',
        telefoon = '',
        postcode = '1000 AA',
        plaats = 'Sandbox',
        regels = sandbox_schoon_json(regels),
        data = sandbox_schoon_json(data);
      UPDATE externe_retouren SET
        email = 'retour-' || id || '@sandbox.invalid',
        regels = sandbox_schoon_json(regels),
        data = sandbox_schoon_json(data);
    `,
  },
  {
    /* E-mailflows. De definities zelf bevatten geen klantgegevens, maar
       `aangemaakt_door` is de naam of het mailadres van een medewerker — óók een
       persoonsgegeven, en precies het soort veld dat je vergeet omdat het niet
       over klanten gaat.

       De loop-toestand (email_flow_leden, email_flow_stappen) hangt aan
       customer_id en niet aan een adres, dus die volgt vanzelf met de
       geanonimiseerde klanten mee.

       Wél alle flows UITZETTEN. Een sandbox met een actieve flow en een
       werkende mailsleutel stuurt echte mails naar sandbox.invalid-adressen —
       en bij een verkeerd gezette sleutel naar echte mensen. Dit is de goedkope
       verzekering tegen het duurste ongeluk dat deze motor kan veroorzaken. */
    naam: "E-mailflows uitzetten en medewerkersnamen wissen",
    sql: `
      UPDATE email_flows SET actief = false, aangemaakt_door = 'sandbox';
      UPDATE email_flow_leden SET status = 'gestopt', reden_uitstap = 'sandbox'
        WHERE status = 'loopt';
    `,
  },
  {
    /* Wat Resend terugmeldde over onze mails. Het mailadres staat er ook in —
       dubbelop met email_flow_leden, maar hier los bruikbaar omdat ook
       transactionele mails hierdoorheen komen.

       Ook de URL gaat leeg: een kliklink kan een token dragen (bevestiging,
       retourportaal, magic link) en dat is in een sandbox een sleutel die je
       niet wilt uitdelen. */
    naam: "Mailgebeurtenissen ontdoen van adressen en kliklinks",
    sql: `
      UPDATE mail_gebeurtenissen SET
        email = CASE WHEN customer_id IS NULL THEN '' ELSE 'klant-' || left(customer_id::text, 8) || '@sandbox.invalid' END,
        url = '',
        bericht_id = '';
    `,
  },
  {
    /* mail_engagement is het buitenbeentje: het MAILADRES is de primaire sleutel
       én de manier waarop customer-360 deze cijfers aan een profiel hangt. Puur
       overschrijven zou dus twee dingen slopen — de unieke sleutel en de join.
       Daarom krijgt een rij mét customer_id exact hetzelfde nepadres als de klant
       zelf ('klant-<id>@sandbox.invalid'), zodat de koppeling in de sandbox
       blijft werken. Twee rijen op één klant (twee adressen, één persoon) zouden
       dan botsen op de primaire sleutel; het rangnummer vangt dat af. De rest —
       adressen die geen klant zijn, bv. alleen-nieuwsbrief — wordt doorgenummerd,
       zonder hash: een md5 van een echt adres is gewoon terug te zoeken. */
    naam: "Mailstatistiek anonimiseren",
    sql: `
      UPDATE mail_engagement m SET email = CASE
          WHEN s.rn = 1 THEN 'klant-' || m.customer_id || '@sandbox.invalid'
          ELSE 'klant-' || m.customer_id || '-' || s.rn || '@sandbox.invalid'
        END
      FROM (
        SELECT email, row_number() OVER (PARTITION BY customer_id ORDER BY email) rn
        FROM mail_engagement WHERE customer_id IS NOT NULL
      ) s
      WHERE s.email = m.email AND m.customer_id IS NOT NULL;

      UPDATE mail_engagement m SET email = 'mail-' || s.rn || '@sandbox.invalid'
      FROM (
        SELECT email, row_number() OVER (ORDER BY email) rn
        FROM mail_engagement WHERE customer_id IS NULL
      ) s
      WHERE s.email = m.email AND m.customer_id IS NULL;
    `,
  },

  /* ── 5. Alles wat een klant kan bereiken of aanwijzen ────────────────── */
  {
    naam: "Nieuwsbrief-inschrijvingen anonimiseren",
    sql: `UPDATE newsletter_subscribers SET email = 'nieuwsbrief-' || id || '@sandbox.invalid', phone = '';`,
  },
  {
    naam: "Voorraadmeldingen anonimiseren",
    sql: `UPDATE stock_notifications SET email = 'melding-' || id || '@sandbox.invalid', phone = '';`,
  },
  {
    naam: "Supporttickets anonimiseren",
    sql: `UPDATE support_tickets SET email = 'ticket-' || id || '@sandbox.invalid';`,
  },
  {
    naam: "Retouren anonimiseren",
    sql: `UPDATE returns SET email = 'retour-' || id || '@sandbox.invalid';`,
  },
  {
    naam: "Afspraken anonimiseren",
    sql: `
      UPDATE appointments SET
        name = 'Sandbox Klant',
        email = 'afspraak-' || id || '@sandbox.invalid',
        phone = '0600000000';
    `,
  },
  {
    naam: "Reserveringen anonimiseren",
    sql: `UPDATE reservations SET customer_name = 'Sandbox Klant', note = '', lines = sandbox_schoon_json(lines);`,
  },
  {
    // Spaarpunten-grootboek: de naam is de enige echte persoonsinfo; het
    // customer_id blijft staan omdat saldo-lookups in de sandbox anders nergens
    // meer op aansluiten (zelfde afweging als bij pos_sales-koppelingen).
    naam: "Loyalty-accounts anonimiseren",
    sql: `UPDATE loyalty_accounts SET name = 'Sandbox Klant ' || substr(md5(customer_id), 1, 6);`,
  },

  /* Recensies: de tekst zelf is persoonlijk geschreven en kan van alles
     bevatten. Sterren en datums houden we, de tekst gaat eruit. */
  {
    naam: "Recensies anonimiseren",
    sql: `UPDATE reviews SET email = 'review-' || id || '@sandbox.invalid', body = 'Sandbox-recensietekst.';`,
  },

  /* ── 6. Waardepapieren ───────────────────────────────────────────────────
     Een echte cadeaubon- of vouchercode uit de kopie is buiten de sandbox in
     te wisselen. Dat is niet alleen privacy maar geld. */
  {
    naam: "Cadeaubonnen anonimiseren",
    sql: `
      UPDATE giftcards SET
        code = 'SB-' || replace(id::text, '-', ''),
        recipient_name = 'Sandbox Ontvanger',
        recipient_email = 'cadeau-' || id || '@sandbox.invalid',
        sender_name = 'Sandbox Afzender',
        message = '';
    `,
  },
  {
    naam: "Vouchers anonimiseren",
    sql: `
      UPDATE vouchers SET
        code = 'SB-' || replace(id::text, '-', ''),
        email = CASE WHEN email IS NULL OR email = '' THEN email ELSE 'voucher-' || id || '@sandbox.invalid' END;
    `,
  },

  /* ── 7. Studenten en vrije notities ─────────────────────────────────── */
  {
    naam: "Studentleden anonimiseren",
    sql: `
      UPDATE student_leden SET
        klant_email = 'student-' || id || '@sandbox.invalid',
        klant_naam = 'Sandbox Student',
        klant_id = '';
    `,
  },
  { naam: "Studentacties anonimiseren", sql: `UPDATE student_acties SET naam = 'Sandbox-actie ' || substr(id::text, 1, 8);` },
  {
    /* Deze was ik in eerste instantie vergeten; de dekkingstest in
       test/sandbox-verversen.test.js vond hem. Precies waarvoor die test er is. */
    naam: "Studentactie-verkopen anonimiseren",
    sql: `
      UPDATE student_actie_verkopen SET
        klant_naam = 'Sandbox Student',
        klant_email = 'studentverkoop-' || id || '@sandbox.invalid',
        klant_id = '',
        kassier = 'Sandbox',
        regels = sandbox_schoon_json(regels);
    `,
  },
  { naam: "Vrije notities legen", sql: `UPDATE inventory_sessions SET note = '';` },
  { naam: "Notities bij displayartikelen legen", sql: `UPDATE display_items SET note = '';` },
  { naam: "Notities bij inkomende zendingen legen", sql: `UPDATE inbound_shipments SET note = '';` },
  { naam: "Notities bij ontvangstverschillen legen", sql: `UPDATE receiving_discrepancies SET note = '';` },

  /* ── 8. Beheerdersrechten ────────────────────────────────────────────────
     Bewust ná het anonimiseren: in de kopie staat wie beheerder is, en dat
     recht hoort niet mee te verhuizen naar een omgeving waar meer mensen
     kunnen inloggen. */
  { naam: "Beheerdersvlaggen wissen", sql: `UPDATE customers SET is_admin = false WHERE is_admin = true;` },
];

/**
 * Snelle controle achteraf: staat er nog ergens een adres dat op een echt
 * mailadres lijkt? Bewijst niet alles, maar vangt wel de fout die je in de
 * praktijk maakt — een tabel vergeten na een schemawijziging.
 */
export const CONTROLE_SQL = `
  SELECT
    (SELECT count(*) FROM customers WHERE email NOT LIKE '%@sandbox.invalid') AS klanten,
    (SELECT count(*) FROM orders WHERE email NOT LIKE '%@sandbox.invalid') AS orders,
    (SELECT count(*) FROM newsletter_subscribers WHERE email NOT LIKE '%@sandbox.invalid') AS nieuwsbrief,
    (SELECT count(*) FROM customer_profiles WHERE email NOT LIKE '%@sandbox.invalid') AS profielen,
    (SELECT count(*) FROM mail_engagement WHERE email NOT LIKE '%@sandbox.invalid') AS mailstatistiek,
    (SELECT count(*) FROM externe_orders WHERE email NOT LIKE '%@sandbox.invalid') AS externe_orders,
    (SELECT count(*) FROM customer_sessions) AS sessies,
    (SELECT count(*) FROM wallet_apple_registrations) AS pushtokens
`;
