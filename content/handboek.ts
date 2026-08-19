/**
 * Het GENTS-platformhandboek — de VERHAALKANT.
 *
 * Eén bron voor drie afnemers: de pagina /handboek (in de portal ingebed), het
 * JSON-endpoint /api/studio/handboek en de losse HTML-uitdraai
 * (npm run handboek:html). Wat je hier schrijft staat overal tegelijk.
 *
 * DRIE SOORTEN INHOUD, BEWUST GESCHEIDEN:
 *
 *  1. Verhaal (dit bestand) — hoe iets werkt en WAAROM. Dat kan geen enkel
 *     script uit de code afleiden; het is de kennis die anders in iemands hoofd
 *     of in een oude presentatie blijft zitten.
 *  2. Getallen — NOOIT hier uitgeschreven. Gebruik een plaatshouder als
 *     {{knop.retailSafetyStock}}; lib/handboek vult die bij het opvragen uit de
 *     échte instellingen. Een handboek dat een ander bedrag noemt dan de site
 *     rekent is erger dan geen handboek.
 *  3. Lijsten die met de code meegroeien (modules, endpoints, cronjobs,
 *     instellingen, tabellen) — die schrijf je niet op maar markeer je met
 *     `auto`. Ze worden bij elke build opnieuw afgeleid, dus een nieuwe functie
 *     staat er vanzelf in.
 *
 * De html-velden zijn ontwikkelaarstekst uit deze repo (geen invoer van buiten)
 * en worden als HTML gerenderd. Houd je aan de klassen die de pagina kent:
 * ul.lijst, .kv, .let(.waarschuwing|.gunstig|.gevaar), .tabel-wrap + table,
 * .stroom + .stap, .chips + .chip, h4, code.
 */

export type AutoBron = "crons" | "instellingen" | "modules" | "endpoints" | "tabellen" | "winkels";

export type Hoofdstuk = {
  /** Nummer zoals het in beeld staat, bv. "3.4". */
  nr: string;
  titel: string;
  /** Vaste tekst (mag plaatshouders bevatten). */
  html?: string;
  /** Automatisch afgeleide inhoud, aangevuld ná de vaste tekst. */
  auto?: AutoBron;
};

export type Deel = {
  id: string;
  rom: string;
  titel: string;
  intro: string;
  hoofdstukken: Hoofdstuk[];
};

export const HANDBOEK: Deel[] = [
  {
    id: "fundament",
    rom: "Deel I",
    titel: "Het fundament",
    intro:
      "Waar alles op staat: drie eigen systemen, één database, vier toegangspoorten en een handvol huisregels die overal terugkomen.",
    hoofdstukken: [
      {
        nr: "1.1",
        titel: "Drie systemen, één database",
        html: `
<p>Het platform bestaat uit drie eigen onderdelen die allemaal naar dezelfde database schrijven. Er is geen los eiland en geen tussenbestand: wat het ene systeem vastlegt, ziet het andere direct.</p>
<div class="kv">
  <div><b>gentsnext</b><span>De webshop gents.nl én de gedeelde kern: voorraad, orders, klanten, catalogus. Levert ook de API's waar de portal en de kassa op draaien.</span></div>
  <div><b>storeportal_next</b><span>Het medewerkersportal: beheerschermen en de kassa-interface. Praat als tussenlaag met de andere twee.</span></div>
  <div><b>storegents</b><span>De backend-API's: kassa-endpoints, SRS-koppeling, filialen, mail en bestandsopslag.</span></div>
</div>
<h4>Externe systemen</h4>
<ul class="lijst">
  <li><strong>SRS</strong> — het magazijnsysteem (WMS) en de bron van de fysieke voorraad. Alleen-lezen voor ons; er gaat geen weborder naartoe.</li>
  <li><strong>Mollie</strong> — online betalingen én de pinbetaling op de fysieke terminal. <strong>Worldline</strong> ligt er als alternatief naast.</li>
  <li><strong>Resend</strong> voor alle transactionele e-mail, <strong>Meta WhatsApp</strong> voor berichten waar dat mag.</li>
  <li><strong>DHL</strong> voor verzending en retourlabels, <strong>Exact Online</strong> voor de boekhouding.</li>
  <li><strong>Shopify</strong> — wordt uitgefaseerd; levert tijdens de overgang nog orders en productfoto's aan.</li>
</ul>
<div class="let">
  <p><strong>Mentaal model in één zin.</strong> SRS levert de magazijnvoorraad, de eigen kern legt daar realtime elke winkel- en webmutatie overheen, kassa en webshop rekenen met exact hetzelfde getal, en de portal is de plek waar het team aan de knoppen zit.</p>
</div>`,
      },
      {
        nr: "1.2",
        titel: "De architectuur in lagen",
        html: `
<p>Van onder naar boven zijn er vier lagen. Elke laag praat alleen met de laag eronder — dat is wat voorkomt dat er twee waarheden ontstaan.</p>
<div class="stroom">
  <div class="stap"><b>1. Bronnen</b><span>SRS-voorraad, Shopify-historie, leveranciers</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>2. De kern</b><span>Neon Postgres: catalogus, orders, klanten, voorraad-grootboek</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>3. Kanalen</b><span>Website, kassa, handscanner</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>4. Beheer</b><span>Portal: werklijsten, dashboards, instellingen</span></div>
</div>
<h4>Waar het draait</h4>
<ul class="lijst">
  <li><strong>Vercel</strong> — de drie projecten draaien serverless in regio Frankfurt. Elke aanroep is een eigen proces; er is geen gedeeld geheugen tussen aanroepen.</li>
  <li><strong>Neon Postgres</strong> — de database, met vertakkingen voor sandbox en preview.</li>
  <li><strong>Vercel Blob</strong> — bestandsopslag voor beeld, exports en een paar configuratiekaarten.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Serverless betekent: geen geheugen tussen twee aanroepen.</strong> Een teller in een bestand of in het werkgeheugen loopt daardoor gegarandeerd een keer mis. In augustus gaf zo'n teller twee keer hetzelfde bonnummer uit en negeerde SRS stil een verkoop van € 249,90. Sindsdien is de regel: alles wat uniek of atomair moet zijn, gebeurt in één SQL-statement.</p>
</div>`,
      },
      {
        nr: "1.3",
        titel: "De database in vogelvlucht",
        html: `
<p>Ruwweg negen families. Je hoeft de tabellen niet te kennen, maar het helpt te weten waar iets leeft als je een vraag stelt.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Familie</th><th scope="col">Wat erin zit</th></tr></thead>
    <tbody>
      <tr><td>Catalogus</td><td>producten, varianten, beelden, collecties, vertalingen, prijshistorie, maatmedia</td></tr>
      <tr><td>Voorraad</td><td>SRS-baseline (plus schaduwtabel voor de 5-minuten-delta), het mutatie-grootboek, reserveringstellers en holds</td></tr>
      <tr><td>Orders</td><td>orders, orderregels, pick-meldingen per winkel, logboek, niet-leverbaar-meldingen, retouren</td></tr>
      <tr><td>Klanten</td><td>klanten, adressen, sessies, identiteiten, profielen, winkelaankopen uit SRS</td></tr>
      <tr><td>Loyalty</td><td>puntengrootboek, servicetoekenningen, wallet-registraties, kassa-saldo's</td></tr>
      <tr><td>Kassa</td><td>verkopen, dagafsluitingen, kasopeningen, kasmutaties, geparkeerde bonnen, printopdrachten</td></tr>
      <tr><td>Keten</td><td>inkomende zendingen, teluitslagen, ontvangstafwijkingen, inventarisatiesessies, reserveringen, paspop</td></tr>
      <tr><td>Marketing</td><td>doelgroepen, e-mailflows, mailgebeurtenissen, nieuwsbrief, vouchers, cadeaubonnen, reviews</td></tr>
      <tr><td>Meten</td><td>events, attributie, heatmap (ruw + dagtotalen), portalgebruik, maatadvies-log</td></tr>
    </tbody>
  </table>
</div>
<h4>Twee tabellen die je vaker hoort noemen</h4>
<ul class="lijst">
  <li><code>app_settings</code> — de instellingen én de content. Eén rij <code>global</code> met alle bedrijfsknoppen, één rij <code>site</code> met de homepage-content, en per contentdocument een rij (<code>content:menu</code>, <code>content:footer</code>, <code>content:pages</code>).</li>
  <li><code>store_stock_movements</code> — het voorraad-grootboek. Alleen toevoegen, nooit wijzigen; elke regel is te herleiden tot een bon, een order of een telling.</li>
</ul>
<div class="let">
  <p><strong>Migraties gaan altijd via een script:</strong> eerst genereren uit het schema, dan uitvoeren. Rechtstreeks doorduwen is verboden — dat omzeilt de historie, en dan weet niemand meer welke versie er op productie staat.</p>
</div>`,
        auto: "tabellen",
      },
      {
        nr: "1.4",
        titel: "Vier poorten: wie mag wat",
        html: `
<p>Alles wat binnenkomt gaat door precies één van vier poorten. Elke poort heeft zijn eigen sleutel en zijn eigen bereik.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Poort</th><th scope="col">Wie</th><th scope="col">Waarvoor</th></tr></thead>
    <tbody>
      <tr><td>Klantsessie</td><td>De ingelogde klant (magic link, geen wachtwoord)</td><td>Eigen account, bestellingen, punten, adressen, retouren</td></tr>
      <tr><td>Studio-token</td><td>De portal, of een ingelogde beheerder</td><td>Alle beheer-API's: producten, orders, instellingen, content, rapportage</td></tr>
      <tr><td>Core-token</td><td>De kassa en de handscanner (via de backend)</td><td>Voorraad, verkopen, klanten, cadeaubonnen, ontvangst, inventarisatie</td></tr>
      <tr><td>Cron-geheim</td><td>De geplande taken van Vercel</td><td>Alle nachtelijke en periodieke klussen</td></tr>
    </tbody>
  </table>
</div>
<h4>Wat er omheen zit</h4>
<ul class="lijst">
  <li><strong>Vergelijken in constante tijd.</strong> Tokens worden nooit met een gewone vergelijking getoetst, maar met één die evenveel tijd kost bij een goede en een foute sleutel — anders is de gok af te leiden uit de reactietijd.</li>
  <li><strong>Snelheidsbegrenzing.</strong> Endpoints die klantgegevens teruggeven hebben een rem per IP, plus een spoor in het logboek zonder ruwe persoonsgegevens: een ongebruikelijke bulk-bevraging valt zo op.</li>
  <li><strong>Geen enumeratie.</strong> Een verkeerd ordernummer en een verkeerde postcode geven exact hetzelfde antwoord, zodat niemand kan aftasten wat wél bestaat.</li>
  <li><strong>Ondertekende links.</strong> Bonnen, tickets, retouren, profiel-afronden en de wallet-pas werken zonder login, met een link die een handtekening draagt over precies dat ene ding.</li>
</ul>`,
      },
      {
        nr: "1.5",
        titel: "Instellingen horen in de tool, niet in code",
        html: `
<p>Dit is de belangrijkste afspraak van het platform. Alles wat een commerciële of operationele keuze is, staat in de portal. In de serverconfiguratie staan alleen geheimen en platformzaken.</p>
<div class="kv">
  <div><b>In de portal</b><span>Verzendkosten, cutoffs, levertijden, veiligheidsvoorraad, retourvoorwaarden, puntenkoers, steekproefdrempels, ritten, betaalmethodenvolgorde, pakbontekst, factuurgegevens, meldingsadressen.</span></div>
  <div><b>In de omgeving</b><span>Sleutels van Mollie, Resend, DHL, SRS en de AI-diensten. Plus de grote schakelaars: mag Google indexeren, staat de betaling in test of live.</span></div>
</div>
<div class="let">
  <p><strong>Waarom zo streng.</strong> Een knop die alleen met een release te verzetten is, blijft in de praktijk maanden verkeerd staan. Dat is letterlijk gebeurd: de webshop stond dagenlang op een betaalsleutel die fouten gaf, omdat omschakelen een deploy vereiste.</p>
</div>
<p>Een wijziging is binnen een halve minuut actief; dat is de cacheduur van de instellingen. De losse configuratiekaarten (ontvangst, ritten, reservering) draaien op een minuut.</p>`,
      },
      {
        nr: "1.6",
        titel: "Huisregels",
        html: `
<p>Terugkerende afspraken die overal in de code gelden. Ze verklaren waarom dingen soms omslachtiger lijken dan nodig.</p>
<ul class="lijst">
  <li><strong>Geld in centen.</strong> Nooit kommagetallen — die tellen niet betrouwbaar op. Aan de kassa wordt in euro's gerekend met expliciete afronding.</li>
  <li><strong>Prijzen komen van de server.</strong> Wat de browser meestuurt is een hint; de order rekent altijd opnieuw uit de database. Dat geldt ook voor kortingen en cadeaubonnen.</li>
  <li><strong>Idempotent boeken.</strong> Elke mutatie draagt een sleutel (bon, order, telling). Dezelfde handeling twee keer aanbieden verandert niets — cruciaal voor een kassa die na een storing alsnog synchroniseert.</li>
  <li><strong>Eén bron per gegeven.</strong> Staat iets op twee plekken, dan lopen ze uit elkaar. Vandaar dat de pakbon de winkelgegevens van de site leest en de footer de betaalmethoden van de checkout.</li>
  <li><strong>SVG-iconen, nooit emoji.</strong> Emoji renderen per apparaat anders en zijn geen merkuiting.</li>
  <li><strong>Fail-soft waar het mag, fail-closed waar het moet.</strong> Een mislukte meting mag nooit een bestelling breken; een mislukte toegangscontrole weigert altijd.</li>
  <li><strong>De rekenkern staat onder test.</strong> Alles waar geld of voorraad doorheen gaat — veiligheidsvoorraad, retourbedragen, puntenacties, kortingen, A/B-verdeling — zit in losse, testbare bestanden.</li>
</ul>`,
      },
      {
        nr: "1.7",
        titel: "Talen, domein en routering",
        html: `
<p>De site draait in vijf talen: Nederlands, Engels, Duits, Frans en Spaans. Nederlands heeft geen voorvoegsel in de URL, de rest wel (<code>/en/…</code>, <code>/de/…</code>).</p>
<ul class="lijst">
  <li>Elk verzoek passeert eerst de middleware. Die bepaalt de taal, past beheerde omleidingen toe, zet oude Shopify-URL's om naar de nieuwe vorm en geeft het taalloze pad door aan de pagina.</li>
  <li>Omleidingen zijn in de portal te beheren en worden een halve minuut gecachet. Op kern-routes (inloggen, afrekenen, winkelwagen, API) wordt een omleiding altijd genegeerd — daar is er per definitie een fout gemaakt.</li>
  <li>Een omleiding op een pad dat de winkel zelf al bedient, verbergt een werkende pagina. De portal waarschuwt daarvoor tijdens het typen.</li>
</ul>`,
      },
    ],
  },

  {
    id: "catalogus",
    rom: "Deel II",
    titel: "De catalogus",
    intro: "Producten, varianten, prijzen, beeld en maten — de basis waar de site, de kassa en de scanner allemaal uit lezen.",
    hoofdstukken: [
      {
        nr: "2.1",
        titel: "Wat een artikel is",
        html: `
<p>Een <strong>product</strong> is een artikelnummer plus een kleur, met de hele maatboog eronder. Elke maat is een <strong>variant</strong> met een eigen sku en meestal een eigen barcode.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Sleutel</th><th scope="col">Wie gebruikt hem</th><th scope="col">Let op</th></tr></thead>
    <tbody>
      <tr><td>sku</td><td>De voorraadbaseline, de webshop, alle reserveringen</td><td>De sleutel waar SRS op matcht. Eén sku hoort bij precies één variant.</td></tr>
      <tr><td>barcode / EAN</td><td>De scanner en de kassa</td><td>Bij ongeveer de helft van de catalogus is dit de leveranciers-EAN en dus niet gelijk aan de sku.</td></tr>
      <tr><td>SRS-artikelnummer</td><td>De koppeling met het magazijnsysteem</td><td>Staat op product- én variantniveau; sommige labels dragen alleen deze code.</td></tr>
    </tbody>
  </table>
</div>
<div class="let waarschuwing">
  <p><strong>Dubbele sku's zijn een echt risico.</strong> Delen twee varianten dezelfde sku, dan is niet te zeggen welke van de twee de voorraad heeft — en boekt de kassa mogelijk op de verkeerde. Er staat een werklijst in de portal om ze in SRS op te schonen; daarom staat er nog geen harde uniciteitsregel op de kolom.</p>
</div>
<p>Omdat de sleutels uit verschillende hoeken komen, vertaalt een aparte laag elke binnenkomende vorm (sku, barcode, leveranciers-EAN) naar hetzelfde artikel. Zonder die vertaling kreeg een scanner op een EAN "systeem 0" terug terwijl de voorraad gewoon klopte.</p>`,
      },
      {
        nr: "2.2",
        titel: "De catalogus-vlaggen",
        html: `
<p>Drie afgeleide velden sturen de hele winkel aan: staat er een foto bij, is er voorraad, en hoeveel. Ze bepalen wat er in de lijsten verschijnt, welke maatfilters bestaan en hoe producten gerangschikt worden.</p>
<ul class="lijst">
  <li>De vlaggen rekenen met het <strong>netto</strong> getal — dus ná kassaverkopen, webreserveringen, apart gelegde stuks en veiligheidsvoorraad, en alleen uit locaties die mogen leveren.</li>
  <li>Ze worden periodiek ververst door een geplande taak. Daarvóór draaide dat alleen als iemand er met de hand aan dacht; op een gemeten moment stonden ze vijftien dagen stil.</li>
</ul>
<div class="let">
  <p><strong>De les erachter.</strong> Een product zonder foto is onvindbaar, want de zichtbaarheidsvlag eist beeld. Zodra Shopify sluit, vallen artikelen waarvan élke foto op de Shopify-CDN staat niet alleen op zwart — ze verdwijnen uit de listings. Daar bestaat een aparte werklijst voor, gesorteerd op voorraadwaarde.</p>
</div>`,
      },
      {
        nr: "2.3",
        titel: "Prijzen en de van-prijs",
        html: `
<p>Elke prijswijziging wordt bewaard. Dat is geen luxe maar een wettelijke eis: een doorgestreepte van-prijs mag alleen de laagste prijs zijn die in de dertig dagen vóór de actie gold.</p>
<ul class="lijst">
  <li>Een vergelijkprijs wordt <strong>uitsluitend</strong> uit de eigen prijshistorie berekend. Er is geen vrij invulbaar kortingsveld — dat is met opzet.</li>
  <li>Na een prijsverlaging tonen we die {{knop.saleAnnouncementDays}} dagen als sale. Daarna is de lagere prijs gewoon de normale prijs.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Waarom hier geen ruimte zit.</strong> De toezichthouder handhaaft hier actief en heeft er meerdere grote ketens op beboet. Een marketeer die zelf een van-prijs kan intypen is een boete die op een dag binnenkomt.</p>
</div>`,
      },
      {
        nr: "2.4",
        titel: "Het PIM: productgegevens op orde",
        html: `
<p>Losse artikelen bewerken kan iedereen. Het PIM bestaat voor de andere vraag: welke veertig artikelen missen een pasvorm, en hoe kom ik daar in één beweging vanaf?</p>
<ul class="lijst">
  <li><strong>Compleetheidsscore</strong> per artikel, met de lijst van wat ontbreekt. Filteren op één falende check leidt direct naar de werklijst.</li>
  <li><strong>Handmatige velden worden vergrendeld.</strong> Wat een medewerker zelf invult mag een import niet overschrijven. Die kolom bestond jaren zonder dat iemand hem las — elke import wiste de verrijking. Er staat nu een test op die situatie.</li>
  <li><strong>Bulkbewerking</strong> vanuit de selectie, met een telling terug ("3 mislukt, 197 gelukt") in plaats van één harde fout.</li>
  <li><strong>Export naar CSV</strong> met exact hetzelfde filter als het scherm — een export die net iets anders selecteert dan de lijst waar je op stond, is een valkuil.</li>
  <li><strong>Wijzigingen worden gelogd</strong>, zodat te zien is wie wat aanpaste.</li>
</ul>`,
      },
      {
        nr: "2.5",
        titel: "Beeld: packshots, modellen en sfeer",
        html: `
<p>Er zijn vier soorten beeld, en de huisregel is hard: <strong>wat je ziet is wat we verkopen</strong>. Geen stockfotografie, geen door AI verzonnen kleding op een banner die over een product gaat.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Soort</th><th scope="col">Hoe het ontstaat</th><th scope="col">Waarvoor</th></tr></thead>
    <tbody>
      <tr><td>Packshot</td><td>Echte studiofoto, of een AI-packshot voor artikelen zonder bronfoto</td><td>Productkaart en galerij</td></tr>
      <tr><td>Modelfoto</td><td>Het échte artikel op een vast merkmodel</td><td>Leidt de galerij; basis voor shop-the-look</td></tr>
      <tr><td>Sfeerbeeld</td><td>Het échte artikel in een scène (thema × camerastijl)</td><td>Banners, landingspagina's, tegels</td></tr>
      <tr><td>Video</td><td>Bewegend beeld bij een deel van de artikelen</td><td>Leidt de galerij als hij er is</td></tr>
    </tbody>
  </table>
</div>
<h4>De studio's leren van feedback</h4>
<p>Medewerkers keuren beelden goed of af met een categorie én een eigen notitie. Die notitie stuurt de volgende generatie aan. Drie dingen daarin zijn belangrijk:</p>
<ul class="lijst">
  <li>Feedback bij <em>dit</em> product telt als hoogste prioriteit; losse notities bij andere foto's gaan niet meer mee. Anders verdronk je nieuwste opmerking tussen veertien oude.</li>
  <li>Een ontkenning werkt niet bij beeldmodellen. "De mouwen zijn te lang" wordt daarom automatisch omgezet naar een positieve instructie — anders krijg je juist lange mouwen.</li>
  <li>De merkregels (wit overhemd mét kraag, gilet onderste knoop open, één mannelijk model) staan vást in code en niet in een vrij tekstveld. In een tekstveld verdwijnen ze een keer en dan staat er een t-shirt onder een pak.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Beeld genereren kost geld.</strong> De nachtelijke taak is drievoudig begrensd: aantal per run, een harde kostengrens per run, en een minimumsaldo waaronder hij niets meer doet. Alle drie staan in de portal.</p>
</div>`,
      },
      {
        nr: "2.6",
        titel: "Maten",
        html: `
<p>Maatvoering is bij herenmode het verschil tussen een verkoop en een retour. Er zitten vier lagen in.</p>
<ul class="lijst">
  <li><strong>Taxonomie.</strong> De catalogus mengt confectiematen (44–64), lengtematen (88–118), kwartmaten (22–32), boordmaten ("M 39/40") en S–XXL door elkaar. Voor het filter vouwen we alles terug naar ongeveer tien nette lettermaat-rijen; voor de sortering weten we welk systeem het is.</li>
  <li><strong>De maattabel.</strong> De autoritatieve GENTS-maatvoering: lichaamsmaten in centimeters naar confectiemaat. Belangrijk: GENTS valt anders dan de vuistregel "borst gedeeld door twee" — maat 50 is 107 cm borst, niet 100.</li>
  <li><strong>Maatadvies.</strong> Op basis van lichaamsmaten, of van een maat die de klant al kent bij een ander merk — met een expliciet lagere betrouwbaarheid, want merkmaten zijn onderling niet consistent.</li>
  <li><strong>Terugkoppeling.</strong> Elk gegeven advies wordt gelogd, zodat later te meten is of het klopte: welke maten verkopen, welke komen terug, en waar wijkt het advies af van wat mensen houden.</li>
</ul>
<div class="let">
  <p><strong>Een geüpload maatblad wordt gekeurd vóór activeren.</strong> Een gat tussen maat 48 en 52 laat de matcher stilletjes de dichtstbijzijnde pakken — geen foutmelding, geen kapotte pagina, alleen klanten met een colbert dat niet past.</p>
</div>`,
      },
      {
        nr: "2.7",
        titel: "Zoeken en filteren",
        html: `
<ul class="lijst">
  <li><strong>Synoniemen</strong> zijn beheerbaar: elke regel is een groep woorden die elkaars synoniem zijn.</li>
  <li><strong>Filterwaarden worden gebucket.</strong> De bron levert samenstellingen ("Polyester viscose") en losse motieven als aparte waarden — dat gaf 80 materialen en 43 dessins, waarvan tientallen met één product. Nu matchen we op hoofdcomponent: wie op wol zoekt vindt ook een wolmengsel.</li>
  <li><strong>Maten worden nooit vertaald</strong> — dat zijn codes, geen woorden. Filterlabels wél; de waarde in de URL blijft de Nederlandse bronwaarde, zodat een gedeelde filterlink in elke taal werkt.</li>
  <li><strong>De kassa zoekt anders.</strong> Daar geldt geen voorraad- of zichtbaarheidsfilter: aan de toonbank moet je élk actief artikel kunnen vinden, ook het laatste stuk.</li>
</ul>`,
      },
      {
        nr: "2.8",
        titel: "Merchandising: wat staat bovenaan",
        html: `
<p>Twee instrumenten, allebei in de portal en allebei zonder release te wijzigen.</p>
<div class="kv">
  <div><b>Pins</b><span>Eén product handmatig bovenaan een categorie of collectie. Een pin overrulet álle gedragssignalen, dus er staat een datum bij: "gepind sinds" maakt zichtbaar dat iets al maanden voordringt.</span></div>
  <div><b>Regels</b><span>Een hele groep verschuiven: "jaar 2026 omhoog", "NOS omlaag", "Herfst/Winter omhoog vanaf 1 september". Een regel kan aflopen, zodat seizoenswerk vanzelf stopt.</span></div>
</div>
<div class="let gunstig">
  <p><strong>Regels herschikken, ze filteren niet.</strong> Het resultaat is een volgorde, geen selectie. Daardoor blijven tellingen en paginering kloppen en kan een te scherpe regel nooit producten laten verdwijnen — hooguit naar achteren duwen. In de portal zie je een voorbeeld naast de huidige volgorde vóór je opslaat.</p>
</div>`,
      },
    ],
  },

  {
    id: "website",
    rom: "Deel III",
    titel: "De website",
    intro: "gents.nl: hoe de winkel is opgebouwd, wat de klant ziet en wat het team daarvan zelf kan bepalen.",
    hoofdstukken: [
      {
        nr: "3.1",
        titel: "De opbouw van de site",
        html: `
<p>De winkel is één Next-applicatie. Alle publieke pagina's zitten in een groep met dezelfde koptekst, footer en winkelwagen eromheen; beheerpagina's staan bewust buiten die groep zodat er geen winkel-chrome omheen komt.</p>
<h4>De belangrijkste routes</h4>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Pad</th><th scope="col">Wat het is</th></tr></thead>
    <tbody>
      <tr><td><code>/</code></td><td>Homepage — blokken en volgorde komen uit de portal</td></tr>
      <tr><td><code>/categorie/…</code> en <code>/collections/…</code></td><td>Productlijsten: categorieën uit de catalogus, collecties gecureerd</td></tr>
      <tr><td><code>/products/…</code></td><td>Productpagina</td></tr>
      <tr><td><code>/pak-samenstellen</code>, <code>/smoking-samenstellen</code></td><td>De samenstellers</td></tr>
      <tr><td><code>/looks</code>, <code>/gelegenheden</code>, <code>/merken</code>, <code>/blog</code></td><td>Inspiratie en verhaal</td></tr>
      <tr><td><code>/maatadvies</code>, <code>/maattabellen</code></td><td>De maat-tools: interactief en als indexeerbare tabel</td></tr>
      <tr><td><code>/winkelwagen</code>, <code>/afrekenen</code>, <code>/bestelling/…</code></td><td>Kopen en bevestigen</td></tr>
      <tr><td><code>/account</code>, <code>/members</code>, <code>/favorieten</code></td><td>Klantomgeving en spaarprogramma</td></tr>
      <tr><td><code>/retourneren</code>, <code>/vraag/…</code>, <code>/afspraak</code></td><td>Service: retour, ticket volgen, adviesgesprek boeken</td></tr>
      <tr><td><code>/zoeken</code>, <code>/pages/…</code>, <code>/cadeaubon</code></td><td>Zoeken, contentpagina's, cadeaubon kopen</td></tr>
    </tbody>
  </table>
</div>
<p>Onbekende URL's komen op een nette 404 binnen de winkel-layout terecht — mét navigatie, zodat een bezoeker verder kan.</p>`,
      },
      {
        nr: "3.2",
        titel: "De homepage als document",
        html: `
<p>De homepage is geen vaste pagina maar een <strong>lijst blokken</strong>: welke er staan, in welke volgorde en of ze aanstaan. Dat document wordt in de portal beheerd; ontbreekt het, dan valt de pagina terug op de standaardindeling in code.</p>
<div class="let">
  <p><strong>Teksten en talen — belangrijk.</strong> Laat je een titel leeg, dan gebruikt het blok de ingebouwde vertaalsleutel en is hij in álle talen goed. Vul je zelf iets in, dan staat díé tekst er in élke taal. Een blok dat je zelf toevoegt heeft dus eigen tekst nodig.</p>
</div>
<p>Daarnaast zijn de <strong>aankondigingsbalk</strong>, de <strong>hero</strong> (foto of video, titel, knop) en de <strong>USP-strip</strong> los instelbaar. Ze lopen via de vertaalrail, dus een gewijzigde campagnetekst wordt 's nachts vertaald en toont nooit een verouderde vertaling.</p>`,
      },
      {
        nr: "3.3",
        titel: "De productlijst (PLP)",
        html: `
<p>Filters, facetten en sortering draaien op één server-query. Wat de klant ziet is altijd het netto beschikbare aanbod.</p>
<ul class="lijst">
  <li><strong>Facetten</strong> op kleurfamilie, type, materiaal, dessin, seizoen, pasvorm en maat — met tellingen die met het filter meebewegen.</li>
  <li><strong>Sortering</strong>, waaronder "Aanbevolen": daarin landen de merchandising-pins en -regels.</li>
  <li><strong>Persoonlijke lagen</strong>: "shop in jouw maat" (uit het profiel) en "op voorraad in mijn winkel". Die staan als chip bij de resultaten, niet als blok bovenaan — het zijn services, geen waarschuwingen, en je moet ze in één klik uit kunnen zetten.</li>
  <li><strong>Snel toevoegen</strong> vanaf de tegel: maat kiezen zonder de productpagina te openen. Uitverkochte maten blijven staan, uitgegrijsd — ze weglaten zou over het assortiment liegen, en een klik op een uitverkochte maat is een inkoopsignaal dat we meten.</li>
</ul>
<div class="let">
  <p><strong>Het winkelfilter zit in de URL, de winkelkeuze in het profiel.</strong> Zo filtert een gedeelde link ook voor iemand met andere winkels, en zet het hebben van een voorkeurswinkel nooit ongevraagd een filter aan.</p>
</div>`,
      },
      {
        nr: "3.4",
        titel: "De productpagina (PDP)",
        html: `
<p>De belangrijkste pagina van de winkel. Wat erop staat en waarom:</p>
<ul class="lijst">
  <li><strong>Galerij</strong> in twee kolommen, met een schermvullende zoom. Een productvideo leidt als hij er is; bij een grote maat schuift een passende modelfoto vooraan.</li>
  <li><strong>Koopbalk</strong> met de maatmatrix. Uitverkochte maten tonen een envelop: mail me zodra deze maat terug is.</li>
  <li><strong>Maathulp</strong> als overlay — wegnavigeren midden in het koopproces kostte de klant zijn productpagina. De volledige maatpagina blijft bestaan voor SEO en directe links.</li>
  <li><strong>Levertijdbelofte</strong> die uitsluitend van de server komt, uit de allocatie-engine. Een eerdere client-side terugval verzon "morgen bezorgd" juist in de gevallen waarin de server bewust géén belofte doet.</li>
  <li><strong>Afhalen in de winkel</strong>: hoeveel winkels hebben deze maat, en per winkel de mogelijkheid om te reserveren om te passen.</li>
  <li><strong>Eerlijke social proof</strong> uit eigen kijkcijfers, met een drempel. Geen verzonnen "x mensen kijken nu".</li>
  <li><strong>Reviews</strong> met een AI-samenvatting, <strong>FAQ per hoofdgroep</strong>, kleurvarianten, "past hierbij" en onderhoudsadvies uit de productdata.</li>
</ul>`,
      },
      {
        nr: "3.5",
        titel: "Samenstellers en looks",
        html: `
<div class="kv">
  <div><b>Pak samenstellen</b><span>Colbert en pantalon (en gilet) worden los verkocht in dezelfde stijl. De koppeling zit in het artikelnummer: haal de rol-prefix eraf en de rest is de gedeelde stijlcode. Prijs = som.</span></div>
  <div><b>Smoking compleet</b><span>Jas, pantalon, overhemd en strik, elk in eigen maat, tegen één vaste pakketprijs per niveau. De vier delen gaan als échte losse artikelen naar de winkelwagen met een gedeelde groep-sleutel; het prijsverschil wordt bij het afrekenen server-side verrekend.</span></div>
  <div><b>Shop the look</b><span>Gecureerde outfits met genummerde hotspots op een modelfoto. Per artikel kiest de klant direct een maat zonder de pagina te verlaten.</span></div>
</div>
<div class="let waarschuwing">
  <p><strong>Een vaste pakketprijs mag nooit alleen in de weergave zitten.</strong> Zou dat wel zo zijn, dan ziet de klant een prijs die de order niet kent. De verrekening gebeurt daarom bij het aanmaken van de bestelling.</p>
</div>`,
      },
      {
        nr: "3.6",
        titel: "De contentlaag",
        html: `
<p>Menu, footer, pagina's, gelegenheden, looks, bundels en de homepage zijn contentdocumenten in de eigen database. Ze worden in de portal bewerkt; is er nog niets bewerkt, dan geldt de standaard uit code als startpunt.</p>
<ul class="lijst">
  <li><strong>Botsingsbeveiliging.</strong> Zulke documenten worden altijd in hun geheel overschreven. Zonder controle wist de laatste opslag stil het werk van wie er net vóór was — een collega, of je eigen tweede tabblad. Elke opslag draagt daarom een stempel van de versie die je opende.</li>
  <li><strong>Veilige opmaak.</strong> Contentpagina's gebruiken lichte Markdown die naar echte elementen wordt omgezet — geen rauwe HTML, dus geen injectie via een beheerscherm.</li>
  <li><strong>Bezette adressen.</strong> Sommige paden worden al door de winkel zelf bediend. Een contentpagina op zo'n adres zou onzichtbaar blijven; die worden geweigerd en in het beheer als bezet getoond.</li>
  <li><strong>De stijlgids</strong> (blog) wordt tweewekelijks door AI geschreven, citeert uitsluitend echte producten en volgt de eigen stijlregels. Artikelen zijn met de hand te redigeren.</li>
</ul>`,
      },
      {
        nr: "3.7",
        titel: "Meertaligheid",
        html: `
<p>Vijf talen, met een eigen aanpak per soort tekst.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Soort</th><th scope="col">Hoe het vertaald wordt</th></tr></thead>
    <tbody>
      <tr><td>Vaste microcopy</td><td>Sleutels in de code; ontbrekende sleutels vallen terug op Nederlands</td></tr>
      <tr><td>Portal-teksten (hero, menu, footer, landings)</td><td>Nachtelijke vertaaltaak op de actuele brontekst, met een hash zodat alleen wijzigingen vertaald worden</td></tr>
      <tr><td>Producttitels en -omschrijvingen</td><td>Eigen vertaaltabel, ook via de nachtelijke taak</td></tr>
      <tr><td>Filterwaarden</td><td>Alleen het zichtbare label; de waarde in de URL blijft Nederlands</td></tr>
    </tbody>
  </table>
</div>
<div class="let">
  <p><strong>Nooit een verouderde vertaling.</strong> Bij het renderen wordt gecontroleerd of de vertaling nog bij de huidige brontekst hoort. Zo niet, dan toont de site het Nederlandse origineel tot de vertaaltaak hem oppakt. Handmatige overrides in de portal winnen altijd.</p>
</div>
<div class="let gunstig">
  <p><strong>Merkregel.</strong> "GENTS", de slogan "Suits You" en de naam van het spaarprogramma blijven in elke taal onvertaald. Maten, getallen, prijzen en opmaak blijven intact.</p>
</div>`,
      },
      {
        nr: "3.8",
        titel: "SEO en vindbaarheid",
        html: `
<ul class="lijst">
  <li><strong>Canonical en hreflang</strong> per pagina, met alle taalvarianten. De Nederlandse variant is prefixloos; <code>/nl/…</code> stuurt permanent door om dubbele content te voorkomen.</li>
  <li><strong>SEO-overrides</strong> per pad in de portal: eigen titel, omschrijving en desgewenst noindex, zonder release.</li>
  <li><strong>Omleidingen</strong> voor legacy-URL's uit het Shopify-tijdperk, beheerd in de portal.</li>
  <li><strong>Sitemap</strong> uit de eigen catalogus, plus gestructureerde data (product, breadcrumb, FAQ) en een beschrijving voor AI-crawlers.</li>
  <li><strong>Indexeren staat uit</strong> tot de omschakeling. Dat is een zichtbare schakelaar — het klassieke replatform-ongeluk is een staging-noindex die meereist naar productie.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Reviews en JSON-LD.</strong> Gestructureerde data wordt in een script-tag gezet. Tekens die uit die tag kunnen breken worden ontsnapt; zonder die stap is een reviewtekst een injectie op elke pagina met structured data.</p>
</div>`,
      },
      {
        nr: "3.9",
        titel: "Toegankelijkheid, meten en toestemming",
        html: `
<ul class="lijst">
  <li><strong>Toegankelijkheid</strong>: skip-link, zichtbare focus, focus-gevangenschap in modals, en respect voor "minder beweging".</li>
  <li><strong>Meten</strong>: een eigen event-catalogus is de bron van waarheid. Elk event vuurt op één plek en wordt gespiegeld naar de tagmanager, zodat er nooit iets in de externe rapportage staat dat niet in de eigen database staat.</li>
  <li><strong>Toestemming is gelaagd</strong>: de eigen meting vraagt analytische toestemming, advertentie-events daarnaast marketingtoestemming. De standaardstand is geweigerd, en die staat in de laag vóórdat de tagmanager laadt — anders is toestemming een formaliteit.</li>
  <li><strong>Heatmap</strong>: kliks, dode kliks en scrolldiepte per pagina, met een eigen rail zodat de kostbare catalogus-events nooit achter een stroom kliks blijven staan. Het ruwe materiaal wordt na de ingestelde bewaartermijn opgeruimd; de dagtotalen blijven en zijn niet meer tot een bezoek te herleiden.</li>
  <li><strong>A/B-experimenten</strong> in eigen huis, met een deterministische verdeling, een waakhond op scheve verdeling en een z-toets op het doel van het experiment.</li>
</ul>`,
      },
    ],
  },

  {
    id: "kopen",
    rom: "Deel IV",
    titel: "Kopen",
    intro: "Van winkelwagen tot bevestiging: betalen, korting, voorraad claimen, bezorgen of afhalen.",
    hoofdstukken: [
      {
        nr: "4.1",
        titel: "Winkelwagen",
        html: `
<p>Toevoegen gebeurt overal op dezelfde manier, met één site-brede bevestiging in plaats van een openklappende lade. Daarin staat meteen wat erbij past, op basis van de hoofdgroepen in de wagen.</p>
<ul class="lijst">
  <li>De <strong>gratis-verzendendrempel</strong> ({{knop.freeShippingCents|euro}}) komt uit dezelfde instelling als de homepage-boodschap — één bron, geen verschil tussen belofte en kassa.</li>
  <li><strong>Staffelkorting</strong> is instelbaar: vanaf een aantal artikelen een percentage over het subtotaal. Standaard staat die uit.</li>
  <li>De <strong>levertijd</strong> in de wagen komt uit dezelfde allocatie-engine als op de productpagina, inclusief de melding als de bestelling uit meerdere locaties komt.</li>
</ul>`,
      },
      {
        nr: "4.2",
        titel: "Afrekenen: adres en bezorging",
        html: `
<ul class="lijst">
  <li><strong>Adres-autofill</strong> op postcode en huisnummer via de open overheidsdienst — scheelt typefouten en mislukte bezorgingen.</li>
  <li><strong>Bezorglanden</strong> staan per land in de instellingen: aan of uit, tarief, gratis-vanaf en hoeveel werkdagen erbovenop komen. Het postcodepatroon per land staat in code; de checkout valideerde vroeger alles op het Nederlandse formaat en zou Belgische en Duitse adressen weigeren.</li>
  <li><strong>Bezorgkeuze</strong>: standaard of sneller (met toeslag {{knop.expressSurchargeCents|euro}}), met echte bezorgdatums uit de allocatie-engine.</li>
  <li><strong>Afhalen</strong>: per winkel wordt getoond of álle artikelen daar liggen, zodat de klant een winkel kiest waar alles klaarligt.</li>
</ul>
<div class="let">
  <p><strong>Onbekend land wordt geweigerd.</strong> Liever een nette weigering dan een order aannemen die we niet tegen het juiste tarief kunnen verzenden.</p>
</div>`,
      },
      {
        nr: "4.3",
        titel: "Betalen",
        html: `
<p>De actieve provider is een instelling met een harde noodrem in de omgeving. Standaard Mollie; Worldline ligt ernaast voor het geval dat.</p>
<div class="stroom">
  <div class="stap"><b>1. Keuze</b><span>Kopgroep per land, rest onder "overige"</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>2. Betaalpagina</b><span>Bij de provider</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>3. Terugkeer</b><span>Status wordt opgehaald, nooit uit de URL gelezen</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>4. Webhook</b><span>De onafhankelijke waarheid; idempotent</span></div>
</div>
<ul class="lijst">
  <li>De kopgroep per land is instelbaar. Welke methode bovenaan hoort is een commerciële keuze die per markt en seizoen verschuift — geen code.</li>
  <li>Elke betaalaanvraag draagt een idempotentie-sleutel, zodat één afrekenpoging hooguit één betaling oplevert.</li>
  <li>De webhook is de bron van waarheid: die krijgt alleen een id binnen en haalt de status zélf op. Zo is de uitkomst niet te vervalsen.</li>
  <li>De footer toont dezelfde methoden als de checkout, uit dezelfde bron — daar stond ooit een handgeschreven lijstje met methoden die we helemaal niet aanboden.</li>
</ul>`,
      },
      {
        nr: "4.4",
        titel: "Korting en betaalmiddelen",
        html: `
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Instrument</th><th scope="col">Wat het is</th><th scope="col">Regel</th></tr></thead>
    <tbody>
      <tr><td>Kortingscode</td><td>Percentage of vast bedrag, met minimum en vervaldatum</td><td>Korting altijd server-side berekend</td></tr>
      <tr><td>Cadeaubon</td><td>Saldo, dus een betaalmiddel — géén korting</td><td>Gaat er ná het factuurtotaal af; anders zou de btw-grondslag te laag uitvallen</td></tr>
      <tr><td>Staffelkorting</td><td>Vanaf X artikelen Y% over het subtotaal</td><td>Instelbaar, standaard uit</td></tr>
      <tr><td>Pakketprijs</td><td>Smoking compleet: vaste prijs per niveau</td><td>Server-side verrekend bij het afrekenen</td></tr>
      <tr><td>Verenigingsactie</td><td>Percentage, vast bedrag, N+M gratis of een cadeau-artikel</td><td>Herrekend bij registratie; wat de kassa toont is een voorvertoning</td></tr>
      <tr><td>Punten inwisselen</td><td>Tegoedbon uit spaarpunten</td><td>Vanaf {{knop.loyaltyConfig.redeemMinPoints}} punten, in stappen; koers in Deel V</td></tr>
    </tbody>
  </table>
</div>
<p>Bij het afrekenen is er één invoerveld: wij bepalen zelf of het een cadeaubon of een kortingscode is.</p>`,
      },
      {
        nr: "4.5",
        titel: "Anti-oversell: het laatste stuk",
        html: `
<p>SRS ziet de webverkopen niet. Tussen twee synchronisaties zou de site daardoor hetzelfde laatste stuk twee keer kunnen verkopen. Daarom claimt de bestelling de voorraad op het moment van aanmaken.</p>
<div class="let gunstig">
  <p><strong>De claim is één SQL-statement:</strong> verhoog de teller alleen als de nieuwe stand binnen de beschikbare voorraad past. De rijvergrendeling serialiseert gelijktijdige checkouts — de tweede klant wacht en krijgt dan een nette weigering in plaats van een order die niemand kan leveren.</p>
</div>
<ul class="lijst">
  <li>Een claim heeft een korte houdbaarheid. Een verlaten checkout geeft de voorraad vanzelf vrij; een geplande taak ruimt op in rustige periodes.</li>
  <li>Betaald of mislukt: in beide gevallen valt de claim vrij, want dan telt de order zelf mee (of helemaal niet).</li>
  <li>Een <strong>drift-monitor</strong> vergelijkt de teller met de werkelijke claims en corrigeert. Dat is de nulmeting vóór de kassa door dezelfde poort gaat.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Voorverkoop is de bewuste uitzondering.</strong> Bij een backorder betaalt de klant voor iets dat er nog niet is; de claim wordt dan overgeslagen in plaats van geforceerd. Supply chain krijgt een melding zodat er besteld wordt.</p>
</div>`,
      },
      {
        nr: "4.6",
        titel: "De order ontstaat",
        html: `
<p>Bij het aanmaken gebeurt in vaste volgorde:</p>
<div class="stroom">
  <div class="stap"><b>Regels oplossen</b><span>Prijzen uit de database</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>Land en tarief</b><span>Verzendkosten en levertijd</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>Voorraad claimen</b><span>Atomair</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>Betaling starten</b><span>Bij de provider</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Betaald: plannen</b><span>Toewijzing aan locaties</span></div>
</div>
<ul class="lijst">
  <li>Een artikel dat tussentijds is gearchiveerd mag <strong>niet stil uit de order vallen</strong> — dan betaalt de klant voor de rest zonder het te weten. De checkout weigert en markeert de regel.</li>
  <li>Pas ná betaling wordt het toewijzingsplan gemaakt en opgeslagen op de order. Dat plan is later te herzien.</li>
  <li>Elke handmatige actie in het back-office komt in een logboek: wie deed wat, wanneer.</li>
</ul>`,
      },
      {
        nr: "4.7",
        titel: "Afhalen, reserveren en click &amp; collect",
        html: `
<div class="kv">
  <div><b>Reserveren om te passen</b><span>Vanaf de productpagina: maat en winkel kiezen. Het stuk wordt hard vastgehouden ({{kaart.reserveringMinuten}} minuten), klant en winkel krijgen bericht. Maximaal drie open reserveringen per e-mailadres.</span></div>
  <div><b>Click &amp; collect</b><span>Online betalen, ophalen in een gekozen winkel. Betaald = onbeperkt vasthouden tot ophalen.</span></div>
  <div><b>Bestel voor klant</b><span>Vanuit de kassa: staat het niet in deze winkel, dan komt het uit een ander filiaal of het magazijn — bezorgen of afhalen.</span></div>
</div>
<p>Een reservering kan online worden afgerekend via een link in de mail; dan wordt hij een betaalde afhaalorder.</p>`,
      },
      {
        nr: "4.8",
        titel: "De levertijdbelofte",
        html: `
<p>Wat de klant te zien krijgt komt uit dezelfde engine die later bepaalt wie de order levert. Dat is bewust: als belofte en werklijst uiteenlopen, ziet de klant "zaterdag verzonden" terwijl de winkel "uiterlijk maandag" leest.</p>
<ul class="lijst">
  <li>Basis: standaard {{knop.standardMinDays}}–{{knop.standardMaxDays}} werkdagen. Vanuit een winkel rekent hij standaard {{knop.storeExtraDays}} dag extra.</li>
  <li>De engine kent openingstijden, feestdagen per land, extra sluitingsdagen, gepauzeerde filialen en de echte cutoff per locatie.</li>
  <li>Is er binnen negen dagen geen verzenddag te vinden (lange sluiting, feestdagencluster), dan doet de site géén harde belofte. Geen belofte is beter dan een verkeerde.</li>
</ul>`,
      },
      {
        nr: "4.9",
        titel: "Na de bestelling",
        html: `
<ul class="lijst">
  <li><strong>Bevestigingsmail</strong> in de taal van de klant, met de orderregels. De bedanktpagina ververst zichzelf zodra de betaling bevestigd is.</li>
  <li><strong>Factuur</strong> als printbare pagina — de browser maakt er met "bewaar als pdf" een pdf van, zonder extra afhankelijkheid. Bedrijfsgegevens (KvK, btw-nummer, IBAN) komen uit de instellingen; een leeg veld laat de regel weg in plaats van een nummer te verzinnen.</li>
  <li><strong>Pakbon</strong> voor verzending vanuit een winkel: geen prijzen, wél de retourtekst — en die tekst is in de portal aan te passen, want het is het enige stukje GENTS dat de klant in de doos vindt.</li>
  <li><strong>Statusmails</strong> bij verzonden, klaar om af te halen, bezorgd (met review-uitnodiging) en terugbetaald.</li>
  <li><strong>Opnieuw bestellen</strong> vanuit een eerdere order, met wat vandaag nog leverbaar is.</li>
</ul>`,
      },
    ],
  },

  {
    id: "klant",
    rom: "Deel V",
    titel: "De klant",
    intro: "Account, identiteit, spaarprogramma, mail en service — alles wat de klant aan zich bindt, en de regels die daarbij gelden.",
    hoofdstukken: [
      {
        nr: "5.1",
        titel: "Account zonder wachtwoord",
        html: `
<p>Inloggen gaat met een magic link: de klant vult zijn e-mailadres in en krijgt een link. Geen wachtwoord om te vergeten, te hergebruiken of te lekken.</p>
<ul class="lijst">
  <li>De link verzilvert één keer en zet een sessiecookie. Verloopt server-side, niet alleen in de browser.</li>
  <li>De mail volgt de taal van de bezoeker.</li>
  <li>In het account: bestellingen (web én winkel), punten, adresboek, maatprofiel, voorkeuren, tickets, memberspas en de AVG-knoppen.</li>
</ul>`,
      },
      {
        nr: "5.2",
        titel: "Wie is wie: de identiteitsgrafiek",
        html: `
<p>Dezelfde persoon bestond in vier gedaanten die elkaar niet kenden: als klant-id, als SRS-klantnummer, als los e-mailadres bij tickets en retouren, en als anoniem apparaat-id in het gedrag op de site.</p>
<ul class="lijst">
  <li><strong>Normaliseren vóór opslaan.</strong> Een e-mailadres in kleine letters, een telefoonnummer in internationale notatie. Doe je dat pas bij het zoeken, dan staat hetzelfde adres in drie schrijfwijzen in de database.</li>
  <li>Alle koppelingen lopen via één laag. Voorheen gebeurde dat ad hoc op e-mailadres, soms met een stille terugval op "pak de eerste treffer" — waardoor een tweede klant met hetzelfde adres andermans historie kon zien.</li>
  <li>Het klantbeeld (360) haalt online orders, kassabonnen, punten en SRS-historie in één keer op. Portal en kassa lezen hetzelfde beeld; daarvóór keken een verkoper en een medewerker letterlijk naar een andere klant.</li>
</ul>`,
      },
      {
        nr: "5.3",
        titel: "Het klantprofiel",
        html: `
<p>Naast de harde gegevens staat er een voorkeurenlaag: geboortedatum, leeftijdsgroep, favoriete kleuren, vaste winkel(s) en waarvoor iemand bij ons koopt.</p>
<ul class="lijst">
  <li>Een klant komt vaak in meer dan één winkel (thuis, werk, familie), dus het is een lijst. De eerste winkel geldt als de vaste, want daar hangen de profielchecklist en de eenmalige bonus aan.</li>
  <li>De keuze staat in een cookie én in het profiel: de cookie zodat de server hem bij de eerste render al kent (geen flikkering), het profiel zodat hij meereist naar een ander apparaat.</li>
  <li>Nachtelijk worden profielen herbouwd en doelgroepen opnieuw gevuld — in die volgorde, want een doelgroep is een filter over de profieltabel.</li>
</ul>`,
      },
      {
        nr: "5.4",
        titel: "GENTS MEMBERS: het spaarprogramma",
        html: `
<p>Eén grootboek voor punten, gevoed door web én kassa. De naam van het programma blijft in elke taal onvertaald.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Knop</th><th scope="col">Nu</th><th scope="col">Wat het betekent</th></tr></thead>
    <tbody>
      <tr><td>Spaarsnelheid</td><td class="mono">{{knop.loyaltyConfig.pointsPerEuro}} punt per euro</td><td>Webshop; de kassa rekent met een eigen regel die je gelijk moet meedraaien</td></tr>
      <tr><td>Inwisselkoers</td><td class="mono">{{knop.loyaltyConfig.redeemCentsPerPoint}} cent per punt</td><td>Samen met de spaarsnelheid bepaalt dit wat sparen waard is</td></tr>
      <tr><td>Drempel</td><td class="mono">{{knop.loyaltyConfig.redeemMinPoints}} punten</td><td>Minimaal in te wisselen, in stappen van {{knop.loyaltyConfig.redeemStepPoints}}</td></tr>
      <tr><td>Wachttijd</td><td class="mono">{{knop.loyaltyConfig.vestingDays}} dagen</td><td>Punten worden pas besteedbaar ná de retourperiode, zodat een retour geen negatief saldo geeft</td></tr>
      <tr><td>Tegoedbon geldig</td><td class="mono">{{knop.loyaltyConfig.redeemVoucherDays}} dagen</td><td>Looptijd van de bon die uit punten ontstaat</td></tr>
    </tbody>
  </table>
</div>
<h4>Bonussen die retouren moeten terugdringen</h4>
<p>Eenmalig per klant, direct besteedbaar: account aanmaken, maatprofiel bewaren, memberspas in de wallet, vaste winkel kiezen en een compleet profiel. De gedachte: de duurste retour is "verkeerde maat besteld", en wie zijn maat kent bestelt gerichter. Een bonus op nul zetten laat de taak uit de klant-UI verdwijnen; al toegekende punten blijven staan.</p>
<h4>Puntenacties en coulance</h4>
<ul class="lijst">
  <li><strong>Puntenacties</strong> ("koop dit, krijg extra punten") worden in de portal aangemaakt als data, niet als code. Ze geven punten en geen euro's korting — punten kosten pas geld bij het inwisselen, een korting kost meteen marge.</li>
  <li><strong>Klantenservice</strong> kan met de hand punten toekennen na een klacht, tot een instelbaar dak per keer ({{knop.loyaltyConfig.serviceMaxPerActie}}). De reden in het grootboek is klantgericht; de interne notitie en wie het deed staan apart.</li>
  <li>Een <strong>zelfherstel-taak</strong> boekt elk uur orders bij die om wat voor reden dan ook geen punten kregen. Zonder dat vangnet valt het grootboek stil zonder dat iemand het merkt: de klant ziet alleen een saldo van nul.</li>
</ul>`,
      },
      {
        nr: "5.5",
        titel: "De memberspas",
        html: `
<p>Dezelfde pas in drie verschijningen: Apple Wallet, Google Wallet en op het scherm in het account. De QR bevat het kale klant-id — dat is de afspraak met de kassa.</p>
<ul class="lijst">
  <li>De QR wordt op de server gebouwd en als platte tekening meegestuurd. Een code die pas verschijnt nadat er JavaScript geladen is, is precies dán te laat als de klant zijn telefoon omhoog houdt.</li>
  <li>De code staat zwart op wit, ook al is de pas zelf donker: een omgekeerde code lezen is optioneel gedrag in de norm, en onze scanners doen het niet gegarandeerd.</li>
  <li>Bij elke saldowijziging krijgt het toestel een seintje en haalt het zelf de verse pas op. Een nachtelijke taak stuurt op <em>verschil</em> in plaats van op mutaties, zodat een pas nooit stil achterloopt.</li>
</ul>`,
      },
      {
        nr: "5.6",
        titel: "Doelgroepen",
        html: `
<p>Een doelgroep wordt in de portal geklikt en opgeslagen als data — een boom van regels, nooit als losse zoekopdracht-tekst. Er is precies één plek waar die data een query wordt, en die werkt tegen een vaste veldenlijst.</p>
<div class="kv">
  <div><b>Bereiken</b><span>Wie je wilt aanschrijven of adverteren.</span></div>
  <div><b>Uitsluiten</b><span>Wie je juist niet wilt bereiken. Geld verbrandt niet aan wie je mist, maar aan wie je overbodig bereikt.</span></div>
  <div><b>Zaailijst</b><span>De beste klanten, als basis voor een vergelijkbaar publiek bij een advertentieplatform.</span></div>
</div>
<div class="let">
  <p><strong>Het getal dat telt is "bereikbaar".</strong> Een doelgroep van 4.000 klanten waarvan er 900 marketingtoestemming hebben, is geen doelgroep van 4.000. Dat verschil staat in het scherm vóór iemand een campagne begroot.</p>
</div>
<p>Uitleveren kan naar de mailprovider en naar de advertentieplatforms (die matchen op een hash van een genormaliseerde waarde — normaliseren en dán hashen, anders is de match nul zonder foutmelding), of als CSV.</p>`,
      },
      {
        nr: "5.7",
        titel: "E-mailflows",
        html: `
<p>Een flow is een reis: trigger, wachten, mail, vertakken, uitstappen. Wat we hadden waren losse mails — dus wie en wat, maar niet wanneer en in welke volgorde.</p>
<ul class="lijst">
  <li><strong>De uitstapregel is de kern.</strong> "Je vergat iets in je winkelwagen" twee dagen ná de aankoop is erger dan niets sturen: de klant ziet dat je niet weet wat hij deed. De regel wordt daarom vóór élke stap opnieuw getoetst.</li>
  <li><strong>Frequentieplafond.</strong> Vier flows die alle vier iets te melden hebben, sturen samen vier mails. Daar zit een dak op.</li>
  <li><strong>Sjablonen zijn code, geen vrije HTML.</strong> Wie in een beheerscherm willekeurige HTML mag invoeren, kan ook een phishingmail versturen op ons afzenderadres.</li>
  <li><strong>Aanzetten is een aparte handeling</strong>, niet een vinkje in het opslagformulier. Het is de enige knop waarna er echt mails vertrekken.</li>
</ul>
<div class="let gunstig">
  <p><strong>Meten met een controlegroep.</strong> "43 van de 1.188 bestelden binnen zeven dagen" is een waarneming, geen resultaat — een deel had sowieso besteld. Daarom krijgt een vast klein deel van de instappers bewust niets: het verschil tussen die twee groepen is wat de flow werkelijk oplevert.</p>
</div>`,
      },
      {
        nr: "5.8",
        titel: "Nieuwsbrief, welkomstkorting en verjaardag",
        html: `
<ul class="lijst">
  <li><strong>Nieuwsbrief</strong> met kanaalkeuze (mail of WhatsApp). E-mail gaat via dubbele bevestiging: eerst in behandeling, pas na de klik ingeschreven en door naar de mailprovider.</li>
  <li><strong>Welkomstkorting</strong> in een popup, één keer per bezoeker. De code wordt ook gemaild, want een gesloten popup komt nooit meer terug. Het is een gewone eenmalige code — er staat bewust niet meer "op je eerste bestelling", want niets in de keten dwong dat af.</li>
  <li><strong>Verjaardagsmail</strong>, dagelijks, hard begrensd op één per klant per jaar: de rij wordt geclaimd vóór het versturen. Zonder die claim is een herstart een dubbele felicitatie naar de hele lijst. Toestemming geldt ook hier.</li>
</ul>`,
      },
      {
        nr: "5.9",
        titel: "Reviews",
        html: `
<ul class="lijst">
  <li>Eigen review-engine. Geverifieerde kopers publiceren direct; overige reviews komen op moderatie.</li>
  <li>Een AI-samenvatting per product destilleert een korte blurb met pluspunten, aandachtspunten en een pasvorm-notitie. Die wordt vanuit de portal gegenereerd, niet bij elk bezoek — de productpagina leest alleen de cache.</li>
  <li>Historische reviews zijn geïmporteerd vanaf de oude aanbieder, met een ondergrens op de beoordeling.</li>
</ul>`,
      },
      {
        nr: "5.10",
        titel: "Klantenservice",
        html: `
<ul class="lijst">
  <li>Een <strong>AI-assistent</strong> beantwoordt veelvoorkomende vragen uit een gecureerde kennisbank. Lukt dat niet betrouwbaar, dan wordt het een ticket en krijgt de klant bericht dat een medewerker reageert.</li>
  <li><strong>Orderstatus</strong> alleen op een geverifieerde basis: voor een ingelogde klant op het sessie-e-mailadres, voor een gast op ordernummer plus postcode. Nooit op een vrij ingetikt e-mailadres.</li>
  <li>Het antwoord bevat bewust alleen wat de klant al over zichzelf mag zien: status, volglink, retour- en terugbetalingsstatus. Geen adres, geen tegoedbon-code — die gaat uitsluitend per mail.</li>
  <li>Een ticket is te volgen zonder in te loggen, via een link met een handtekening over ref en e-mailadres.</li>
</ul>`,
      },
      {
        nr: "5.11",
        titel: "Privacy en AVG",
        html: `
<ul class="lijst">
  <li><strong>Toestemming</strong> met gelijkwaardige knoppen en zonder voorgevinkte vakjes. Functionele opslag mag altijd; analytics en marketing vereisen een expliciete keuze, die altijd te wijzigen is.</li>
  <li><strong>Inzage</strong>: de klant downloadt al zijn gegevens als bestand.</li>
  <li><strong>Verwijdering</strong>: het account wordt geanonimiseerd na een expliciete bevestiging.</li>
  <li><strong>Meten zonder persoonsgegevens</strong>: de heatmap legt geen muisbewegingen, toetsaanslagen of formuliertekst vast, en het maatadvies-log bevat bij een anonieme bezoeker geen enkel identificerend gegeven.</li>
  <li><strong>De sandbox wordt geanonimiseerd</strong> vóór iemand erbij kan (zie Deel IX).</li>
</ul>`,
      },
    ],
  },

  {
    id: "kassa",
    rom: "Deel VI",
    titel: "De kassa",
    intro: "De eigen kassa in de winkel: verkopen, betalen, klant koppelen, kas tellen en bestellen wat er niet ligt.",
    hoofdstukken: [
      {
        nr: "6.1",
        titel: "Wat de kassa is",
        html: `
<p>De kassa is een scherm in het portal, per filiaal. Hij draait op tablet en desktop, kan schermvullend en werkt door als het internet hapert: verkopen gaan dan in een wachtrij en synchroniseren daarna.</p>
<ul class="lijst">
  <li>De <strong>voorraadgetallen</strong> komen uit de gedeelde kern — dezelfde som die de site gebruikt.</li>
  <li>De <strong>catalogus</strong> wordt lokaal bewaard zodat scannen en zoeken blijven werken bij een storing. Bewust zonder voorraad (die is offline per definitie onbekend) en zonder foto's (te groot).</li>
  <li><strong>Hardware</strong> (lade, bonprinter) loopt via een lokale agent op de winkel-pc.</li>
</ul>`,
      },
      {
        nr: "6.2",
        titel: "De verkoopflow",
        html: `
<div class="stroom">
  <div class="stap"><b>Scan of zoek</b><span>Barcode, sku of tekst</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>Mandje</b><span>Korting, vrije regel, klant koppelen</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>Afrekenen</b><span>Contant, pin, cadeaubon, split</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Bon</b><span>Print, mail of publieke bonpagina</span></div>
</div>
<ul class="lijst">
  <li><strong>Zoeken aan de kassa</strong> gaat rechtstreeks op de database, geïndexeerd op barcode, sku en SRS-nummer — milliseconden in plaats van seconden.</li>
  <li>Bij het afrekenen wordt gecontroleerd of het laatste stuk er nog is. Een artikel dat online gereserveerd staat geeft een <strong>waarschuwing</strong>, geen blokkade: de klant staat aan de balie met het stuk in handen.</li>
  <li><strong>Parkeren</strong> zet een mandje opzij; het concept staat in de database en niet in het tabblad.</li>
  <li><strong>Annuleren en retourneren</strong> boekt de voorraad terug en draait de punten terug.</li>
</ul>`,
      },
      {
        nr: "6.3",
        titel: "Bonnummers en de bon",
        html: `
<div class="let gevaar">
  <p><strong>Het incident dat dit stuurt.</strong> De bonnummerteller stond in een bestand. Twee verkopen, 73 minuten na elkaar, kregen allebei hetzelfde nummer doordat de lees-actie een verouderde waarde teruggaf. SRS ontdubbelt op bonnummer, dus de tweede bon van € 249,90 werd stil genegeerd: omzet weg, zonder foutmelding.</p>
</div>
<p>De teller staat nu in de database en wordt in één statement opgehoogd en uitgegeven. Geen race, geen cache, geen verouderde lees-actie — ook niet bij twee kassa's tegelijk.</p>
<ul class="lijst">
  <li>Op de bon staat een QR waarmee een klant zonder account de punten later alsnog naar zijn account haalt.</li>
  <li>De bon is als pagina te openen via een link met handtekening — geen aanroep naar een ander systeem nodig om die te verifiëren.</li>
</ul>`,
      },
      {
        nr: "6.4",
        titel: "De klant aan de kassa",
        html: `
<ul class="lijst">
  <li><strong>Zoeken</strong> op naam of e-mailadres in hetzelfde klantbestand als de webshop; <strong>aanmaken</strong> is idempotent op e-mailadres, dus een bestaande klant wordt aangevuld en niet gedupliceerd.</li>
  <li><strong>Spaarpas scannen</strong> geeft direct het klant-id: de kassa weet meteen wie er staat en welke tegoedbonnen openstaan.</li>
  <li><strong>Klantbeeld</strong> met online orders én winkelbonnen naast elkaar.</li>
  <li><strong>Profiel-afrondlink</strong> mailen vanaf de kassa: de kassier vangt alleen het e-mailadres, de klant vult de rest zelf in en verdient daarmee punten.</li>
</ul>`,
      },
      {
        nr: "6.5",
        titel: "Betaalmiddelen aan de kassa",
        html: `
<ul class="lijst">
  <li><strong>Pinnen</strong> loopt via een fysieke terminal die vanuit de kern wordt aangestuurd: starten, status pollen, annuleren en terugbetalen op de originele kaartbetaling.</li>
  <li>Een <strong>eigen webhook</strong> vangt de uitkomst op, los van het kassascherm. Een betaling leefde eerder alleen in dat tabblad; viel dat weg, dan was er geld binnen zonder bon en zonder spoor.</li>
  <li><strong>Cadeaubonnen</strong> worden aan de kassa gevalideerd, afgeboekt en desgewenst weer vrijgegeven — atomair en idempotent per bon, zodat een dubbele druk niet dubbel afboekt. Fysieke bonnen kunnen ook aan de kassa geactiveerd worden.</li>
  <li><strong>Kortingscodes en tegoedbonnen</strong> worden altijd server-side gewaardeerd; wat de kassa toont is een voorvertoning.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>De terminal heeft een eigen sleutel.</strong> Sinds webshop en terminal gesplitst zijn, bestaat een winkelbetaling niet in de webshop-omgeving. Wie daar zoekt vindt niets — en dan doet een webhook stil helemaal niets.</p>
</div>`,
      },
      {
        nr: "6.6",
        titel: "De kas: openen, muteren, afsluiten",
        html: `
<div class="stroom">
  <div class="stap"><b>Opening</b><span>Beginkas tellen, per winkel per dag</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>Mutaties</b><span>In en uit kas, in en uit kluis</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>Dagafsluiting</b><span>Kasstaat + kasopmaak, met btw-uitsplitsing</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Boekhouding</b><span>Dagstaat naar Exact</span></div>
</div>
<ul class="lijst">
  <li>Kasmutaties zijn een <strong>geldspoor</strong>: alleen toevoegen. Fout ingevoerd betekent een tegenmutatie boeken, niet wissen.</li>
  <li>Een hertelling van de beginkas overschrijft met een audit-spoor; de boeking van die dag blijft staan, anders lokt een hertelling een tweede boeking uit.</li>
  <li>De <strong>webshop-dagstaat</strong> is de online tegenhanger van de kassa-dagstaat: samen vullen ze de tussenrekeningen die de betaalafrekeningen weer leegvegen. Een cadeaubon telt daarin als betaalmiddel, niet als omzet — de btw komt pas bij besteding.</li>
  <li>De koppeling met de boekhouding heeft een <strong>slot</strong> op het vernieuwen van de toegang: dat token is eenmalig, en twee servers die tegelijk vernieuwen trekken de hele keten in.</li>
</ul>`,
      },
      {
        nr: "6.7",
        titel: "Bestellen wat er niet ligt",
        html: `
<p>Staat het artikel niet in deze winkel, dan bestelt de verkoper het gewoon: uit een ander filiaal of uit het magazijn, bezorgen bij de klant of afhalen in een winkel naar keuze.</p>
<ul class="lijst">
  <li>Er ontstaat een <strong>normale order</strong> met dezelfde toewijzing en dezelfde voorraadclaim als een webbestelling.</li>
  <li>De klant krijgt een <strong>betaallink</strong>; de omzet wordt aan het filiaal toegerekend.</li>
  <li>Openstaande <strong>afhaalorders en weborders</strong> voor deze winkel staan in één lijst, inclusief wat er gepickt moet worden.</li>
</ul>`,
      },
      {
        nr: "6.8",
        titel: "Printen, paspop en meldingen",
        html: `
<ul class="lijst">
  <li><strong>Print-inbox.</strong> De backend kan niet rechtstreeks op een winkelprinter printen (die zit achter het winkelnetwerk), dus opdrachten worden per winkel in een wachtrij gezet. De kassa haalt ze op, print via de lokale agent en bevestigt. Zo komt een pick-bon met scanbare barcode in de bronwinkel uit de printer.</li>
  <li><strong>Paspop en etalage.</strong> Een stuk markeren als "op de paspop" blijft verkoopbaar — het raakt de beschikbaarheid niet. Het is zichtbaarheid, en het telt mee bij de inventarisatie.</li>
  <li><strong>Afspraken.</strong> De winkel ziet de aangevraagde adviesgesprekken, kan de status bijwerken en zelf een afspraak inplannen; de klant krijgt dan exact dezelfde bevestigingsmail als bij een online aanvraag.</li>
</ul>`,
      },
    ],
  },

  {
    id: "keten",
    rom: "Deel VII",
    titel: "De keten",
    intro: "Voorraad, toewijzing, ontvangst, herverdeling, tellen en retour — het werk van supply chain, en de logica eronder.",
    hoofdstukken: [
      {
        nr: "7.1",
        titel: "De voorraadformule",
        html: `
<p>Eén som, overal hetzelfde: op de productpagina, aan de kassa en op de scanner.</p>
<div class="stroom">
  <div class="stap"><b>SRS-baseline</b><span>bruto per filiaal</span></div>
  <span class="pijl" aria-hidden="true">+</span>
  <div class="stap"><b>Kassa-delta</b><span>verkoop, retour, correctie</span></div>
  <span class="pijl" aria-hidden="true">&minus;</span>
  <div class="stap let-op"><b>Web-reservering</b><span>lopende orders en claims</span></div>
  <span class="pijl" aria-hidden="true">&minus;</span>
  <div class="stap let-op"><b>Veiligheidsvoorraad</b><span>budget per artikel</span></div>
  <span class="pijl" aria-hidden="true">=</span>
  <div class="stap goed"><b>Beschikbaar</b><span>per artikel, per locatie</span></div>
</div>
<ul class="lijst">
  <li><strong>Onderweg telt niet mee.</strong> Een zending die gepickt of onderweg is verhoogt niets; voorraad ontstaat pas bij de ontvangstscan.</li>
  <li><strong>Nooit dubbel geboekt.</strong> Elke mutatie is uniek op bon, kanaal en artikel — een kassa die na een storing alsnog synchroniseert boekt dezelfde bon niet twee keer.</li>
  <li><strong>Zelfherstellend.</strong> Zodra SRS de mutatie zelf verwerkt heeft, valt onze delta uit de som. Een gemiste synchronisatie corrigeert de volgende ronde.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Sleutels lopen niet gelijk.</strong> De webshop vraagt op sku, de scanner op barcode — en bij ongeveer de helft van de catalogus is die barcode de leveranciers-EAN. Een aparte vertaallaag lost elke vorm op naar hetzelfde artikel. Zonder die laag gaf een EAN-vraag "systeem 0" terwijl de voorraad klopte, en viel de kassa terug op een verouderende momentopname.</p>
</div>`,
      },
      {
        nr: "7.2",
        titel: "Hoe de SRS-voorraad binnenkomt",
        html: `
<p>De baseline staat als momentopname in onze eigen database. De import schrijft een nieuwe generatie en zet die pas op scherp als hij compleet is.</p>
<ul class="lijst">
  <li><strong>Generatie-wissel.</strong> Beginnen, in batches vullen, dan omschakelen. Een half geschreven synchronisatie is dus onzichtbaar, en een lege levering wordt geweigerd — de site kan nooit leeggetrokken worden.</li>
  <li><strong>Uurlijkse volledige push</strong>, met een markering die pas opschuift als de push is vastgelegd: een gemiste ronde probeert zichzelf opnieuw.</li>
  <li><strong>Vijf-minuten-delta</strong> loopt al mee in een schaduwtabel. Nog geen lezers: eerst bewijzen dat hij exact gelijkloopt, dan pas overschakelen.</li>
</ul>`,
      },
      {
        nr: "7.3",
        titel: "Veiligheidsvoorraad",
        html: `
<p>Een budget <strong>per artikel</strong> — niet per maat per winkel. Eén artikel is artikelnummer plus kleur, met de hele maatboog eronder.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Marge</th><th scope="col">Nu</th><th scope="col">Waarom</th></tr></thead>
    <tbody>
      <tr><td>Winkels</td><td class="mono">{{knop.retailSafetyStock}} stuks</td><td>Beschermt tegen een mistelling of een displaystuk bij een klant die het rek niet ziet</td></tr>
      <tr><td>Magazijn</td><td class="mono">{{knop.warehouseSafetyStock}}</td><td>Daar is de telling betrouwbaar genoeg</td></tr>
      <tr><td>Winkelkanaal</td><td class="mono">{{knop.storeChannelSafetyStock}}</td><td>Aan de kassa en tussen winkels onderling heeft de verkoper het artikel in handen</td></tr>
    </tbody>
  </table>
</div>
<p>Het budget gaat naar de <strong>dunste regels</strong> — daar zit het risico. De diepte blijft online verkoopbaar. Bij gelijke stand beslist een vaste volgorde, zodat productpagina, toewijzing en kassa gegarandeerd dezelfde stuks vasthouden.</p>
<div class="let waarschuwing">
  <p><strong>Waarom dit veranderd is.</strong> De marge werd eerst van élke combinatie winkel-en-maat afgetrokken. Dat hield 44.855 van de 55.999 stuks winkelvoorraad vast — 80% — en zette 262 producten mét voorraad online op uitverkocht.</p>
</div>
<p>Daarnaast beschermt een schakelaar ({{knop.protectUnderstockedRetail|aanuit}}) winkels die onder hun eigen minimum zitten: die leveren geen weborder, tenzij er nergens anders voorraad is.</p>`,
      },
      {
        nr: "7.4",
        titel: "Toewijzing: wie levert de order",
        html: `
<p>Een vaste ladder. Pas als een stap niet lukt, zakt hij naar de volgende.</p>
<ul class="lijst">
  <li><strong>1. Compleet vanaf één locatie</strong> — scheelt een tweede pakket en een tweede pickronde.</li>
  <li><strong>2. Magazijn eerst</strong> — winkelvoorraad bewaren we voor de klant die in de winkel staat.</li>
  <li><strong>3. Meerdere kandidaten?</strong> De locatie met de meeste voorraad wint.</li>
  <li><strong>4. Niet compleet?</strong> Zo min mogelijk splitsen; daarbinnen weer magazijn en diepte eerst.</li>
  <li><strong>5. Open en vóór de cutoff</strong> — een dichte winkel of feestdag schuift door naar de eerstvolgende verzenddag.</li>
</ul>
<h4>Waar hij verder op let</h4>
<div class="chips">
  <span class="chip">Pak-sets blijven bij elkaar</span>
  <span class="chip">Gepauzeerd filiaal overgeslagen</span>
  <span class="chip">Onderbevoorrade winkel beschermd</span>
  <span class="chip">België bij voorkeur uit Antwerpen</span>
  <span class="chip">Overstock-eerst (optie)</span>
</div>
<div class="let gunstig">
  <p><strong>Zelf doorrekenen.</strong> In de portal laat je een order doorrekenen: welke locaties zouden leveren, hoe hij splitst en welke tekorten er zijn. Er wordt niets geboekt.</p>
</div>`,
      },
      {
        nr: "7.5",
        titel: "Cutoffs en verzenddagen",
        html: `
<p>Eén definitie voedt zowel de belofte aan de klant als de pick-deadline die de winkel ziet. Liepen die uiteen, dan las de klant "zaterdag verzonden" en de winkel "uiterlijk maandag".</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Knop</th><th scope="col">Nu</th><th scope="col">Toelichting</th></tr></thead>
    <tbody>
      <tr><td>Cutoff magazijn</td><td class="mono">{{knop.warehouseCutoffHour|uur}}</td><td>Per weekdag te overschrijven</td></tr>
      <tr><td>Cutoff winkels</td><td class="mono">{{knop.storeCutoffHour|uur}}</td><td>Nooit later dan de sluitingstijd min de overdrachtsmarge</td></tr>
      <tr><td>Overdrachtsmarge</td><td class="mono">{{knop.storeHandoverMinutes}} minuten</td><td>Inpakken en overdragen aan de vervoerder</td></tr>
      <tr><td>Zaterdag winkels</td><td class="mono">{{knop.dispatchOnSaturdayStores|janee}}</td><td>Magazijn werkt door de week</td></tr>
      <tr><td>Zondag</td><td class="mono">{{knop.dispatchOnSunday|janee}}</td><td>Vervoerders halen niet op</td></tr>
    </tbody>
  </table>
</div>
<ul class="lijst">
  <li><strong>Feestdagen</strong> worden per jaar en per land berekend, niet uit een handmatige lijst — die dekte alleen het lopende jaar en zou daarna stil "geen feestdag" zeggen op Eerste Kerstdag.</li>
  <li><strong>Extra sluitingsdagen</strong> (bedrijfssluiting, personeelsdag, inventarisatie) zet je er zelf bij; die gelden voor alle filialen.</li>
  <li><strong>Filiaal pauzeren</strong> haalt een winkel tijdelijk uit de toewijzing zonder hem te verwijderen.</li>
  <li>De winkel ziet een <strong>pick-deadline</strong>: oranje onder twee uur, rood als hij voorbij is.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Een te ruime cutoff belooft "vandaag verzonden"</strong> op een moment dat er niets meer vertrekt. Zet hier het échte ophaalmoment neer, niet de sluitingstijd.</p>
</div>`,
      },
      {
        nr: "7.6",
        titel: "Goederenontvangst",
        html: `
<p>Voorraad ontstaat bij de scan, niet bij de pakbon.</p>
<div class="stroom">
  <div class="stap"><b>Aangemeld</b><span>verwachte regels</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap let-op"><b>Onderweg</b><span>telt nergens mee</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>Scannen</b><span>steekproefplan vastgezet</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Voorraad</b><span>nu pas verkoopbaar</span></div>
</div>
<div class="kv">
  <div><b>Tellen — de normale weg</b><span>Scannen tegen de verwachte regels. Alleen wat écht geteld is wordt geboekt; het ontbrekende stuk wordt nooit toegevoegd. Verschillen komen in de werklijst.</span></div>
  <div><b>Alles binnenmelden — blind</b><span>Geen tijd om te tellen? Dan boekt hij de verwachte aantallen. Bewust géén afwijkingen: er is niet geteld, dus er is geen signaal om op te sturen.</span></div>
</div>
<div class="let waarschuwing">
  <p><strong>Beschadigd of verkeerd geleverd?</strong> Meld het bij de scan. Die stuks gaan in quarantaine en worden niet als verkoopbare voorraad geboekt — ook niet wanneer de rest blind wordt binnengemeld.</p>
</div>
<p>De ontvangst-mutatie overbrugt het gat tot SRS de ontvangst zelf verwerkt; daarna valt hij uit de som, zodat er nooit dubbel geteld wordt.</p>`,
      },
      {
        nr: "7.7",
        titel: "De slimme steekproef",
        html: `
<p>Niet alles tellen, wel altijd het risico tellen — en het systeem leert per leverancier.</p>
<h4>Altijd de hele levering tellen bij</h4>
<div class="chips">
  <span class="chip warn">Kleine partij: {{kaart.ontvangst.smallLotPieces}} stuks of minder</span>
  <span class="chip warn">Nieuwe bron: minder dan {{kaart.ontvangst.newSourceReceipts}} ontvangsten</span>
  <span class="chip warn">Bron met manco: {{kaart.ontvangst.sourceTightenRate|pct}} of meer</span>
  <span class="chip warn">Hoge waarde: vanaf {{kaart.ontvangst.highValueCents|euro}} per stuk</span>
</div>
<h4>Anders: verplicht plus aanvulling</h4>
<ul class="lijst">
  <li><strong>Verplicht</strong> zijn artikelen die in {{kaart.ontvangst.mancoWindowDays}} dagen minstens {{kaart.ontvangst.mancoLineMinHits}} keer manco kwamen én in {{kaart.ontvangst.mancoLineRate|pct}} of meer van de gevallen.</li>
  <li><strong>Aangevuld</strong> met de duurste regels tot de steekproefgrootte gehaald is (minimaal {{kaart.ontvangst.nMin}} regels).</li>
  <li><strong>Accepteren</strong> als het aantal afwijkingen onder {{kaart.ontvangst.aql|pct}} van de getelde regels blijft; de niet-getelde regels boeken dan op verwacht. Zit het erboven, dan schiet de zending naar 100% en wordt er nog niets geboekt.</li>
</ul>
<div class="stroom">
  <div class="stap let-op"><b>Nieuw</b><span>alles tellen</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>Normaal</b><span>gewone steekproef</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Betrouwbaar</b><span>na {{kaart.ontvangst.reducedAfterCleanReceipts}} schone ontvangsten: kleinere steekproef</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap fout"><b>Aangescherpt</b><span>terug naar alles tellen</span></div>
</div>`,
      },
      {
        nr: "7.8",
        titel: "Afwijkingen",
        html: `
<p>Elk verschil tussen besteld en geteld komt in de werklijst, met de bron erbij.</p>
<div class="chips">
  <span class="chip bad">Tekort</span><span class="chip warn">Teveel</span><span class="chip warn">Niet besteld</span>
  <span class="chip bad">Beschadigd</span><span class="chip bad">Verkeerd artikel</span><span class="chip warn">Kwaliteit</span><span class="chip warn">Verkeerd gelabeld</span>
</div>
<h4>Afhandeling</h4>
<p>Open → claim ingediend → gecrediteerd, afgeschreven of opgelost. Alleen geverifieerde regels tellen mee: bij een steekproef zijn dat de getelde regels; wie blind binnenmeldt meldt niets.</p>
<h4>Het dashboard (90 dagen)</h4>
<div class="kv">
  <div><b>Nauwkeurigheid per bron</b><span>Welke leverancier of welk magazijn structureel scheef levert.</span></div>
  <div><b>Nauwkeurigheid per winkel</b><span>Waar er slordig geteld wordt — een trainingssignaal.</span></div>
  <div><b>Verdeling per code</b><span>Tekort, schade of niet besteld: het type bepaalt de oplossing.</span></div>
  <div><b>Dock-to-stock</b><span>Uren tussen onderweg en geboekt — hoe lang voorraad stilstaat.</span></div>
</div>
<div class="let gunstig">
  <p><strong>Melden werkt dubbel.</strong> Elke afwijking voedt ook het manco-profiel: de volgende zending van diezelfde bron wordt automatisch strenger of juist lichter gecontroleerd.</p>
</div>`,
      },
      {
        nr: "7.9",
        titel: "Herverdeling tussen winkels",
        html: `
<div class="stroom">
  <div class="stap"><b>Bronwinkel</b><span>&minus;1 direct bij versturen</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap let-op"><b>Onderweg</b><span>telt nergens</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Doelwinkel</b><span>+1 bij de ontvangstscan</span></div>
</div>
<ul class="lijst">
  <li><strong>Gate op de bron.</strong> Heeft de bronwinkel fysiek te weinig, dan weigert de uitwisseling — anders raakt de bron negatief en krijgt het doel fantoomvoorraad.</li>
  <li><strong>Pick-bon met barcode</strong> rolt uit de kassaprinter van de bronwinkel; scannen betekent verstuurd, een tweede scan doet niets.</li>
  <li><strong>Rit of DHL.</strong> Zitten beide winkels op dezelfde rit die binnen {{kaart.ritten.maxRouteWaitDays}} dagen vertrekt, dan gaat het gratis mee. Anders DHL ({{kaart.ritten.dhlCostCents|euro}}, morgen binnen). Spoed is altijd DHL.</li>
  <li>Ontvangen gaat via dezelfde scan-to-receive, inclusief afwijking als er iets mist.</li>
</ul>
<div class="let">
  <p><strong>Dit is de goedkoopste inkoop die er is:</strong> overstock in de ene winkel is het tekort van de andere. Zolang er geen ritten zijn ingesteld, adviseert het systeem altijd DHL.</p>
</div>`,
      },
      {
        nr: "7.10",
        titel: "Inventarisatie",
        html: `
<div class="stroom">
  <div class="stap"><b>Klaarzetten</b><span>alles, groep, artikelen of sectie</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>Tellen</b><span>op de handscanner</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>Afronden</b><span>niet gescand = 0</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Goedkeuren</b><span>verschillen geboekt als correctie</span></div>
</div>
<ul class="lijst">
  <li><strong>Apart gelegd telt mee.</strong> Wat gereserveerd is of op de paspop staat wordt niet als verdwenen weggeboekt; de nul-telling houdt daar rekening mee.</li>
  <li><strong>Overzicht over alle winkels</strong>: afgeronde tellingen wachten op goedkeuring, met historie en zoeken per artikel.</li>
  <li><strong>Idempotent</strong>: twee keer goedkeuren boekt niet twee keer.</li>
</ul>
<div class="let gunstig">
  <p><strong>Praktisch.</strong> Een deeltelling per sectie of productgroep kost een winkel een half uur en levert meer op dan één jaarlijkse telling.</p>
</div>`,
      },
      {
        nr: "7.11",
        titel: "Niet leverbaar",
        html: `
<p>De winkel vindt het toegewezen stuk niet. Er gebeuren dan drie dingen, in deze volgorde:</p>
<ul class="lijst">
  <li><strong>1. Het fantoom-stuk gaat eraf</strong> bij die winkel, zodat het niet opnieuw verkocht of gerouteerd wordt.</li>
  <li><strong>2. De order wordt opnieuw toegewezen</strong> zonder die winkel — magazijn eerst, anders een andere winkel met voorraad.</li>
  <li><strong>3. Lukt dat niet: make-whole</strong> — annuleren en terugbetalen, of een retour starten voor een deel dat al verstuurd is.</li>
</ul>
<p>De klant krijgt (instelbaar) bericht met maximaal {{knop.unfulfillableConfig.alternativesCount}} alternatieven op maat. Per winkel wordt de miss-rate over 90 dagen bijgehouden: een betrouwbaarheidssignaal, en meteen input voor de volgende telling.</p>`,
      },
      {
        nr: "7.12",
        titel: "Retouren richting voorraad",
        html: `
<div class="stroom">
  <div class="stap"><b>Aanmelden</b><span>account of retourportaal</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap"><b>Methode</b><span>DHL-label of in de winkel</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap koel"><b>Ontvangen</b><span>controle en terugbetaling</span></div>
  <span class="pijl" aria-hidden="true">&rarr;</span>
  <div class="stap goed"><b>Terug in voorraad</b><span>de afvinklijst</span></div>
</div>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Knop</th><th scope="col">Nu</th></tr></thead>
    <tbody>
      <tr><td>Bedenktijd</td><td class="mono">{{knop.returnConfig.windowDays}} dagen</td></tr>
      <tr><td>Retourkosten bij geld terug</td><td class="mono">{{knop.returnConfig.dhlReturnCostCents|euro}}</td></tr>
      <tr><td>Gratis bij tegoed</td><td class="mono">{{knop.returnConfig.freeOnCredit|janee}}</td></tr>
      <tr><td>Signaaldrempel</td><td class="mono">{{knop.returnConfig.signalMinReturns}}× · {{knop.returnConfig.signalMinRatePct}}% · binnen {{knop.returnConfig.signalFastDays}} dagen</td></tr>
    </tbody>
  </table>
</div>
<ul class="lijst">
  <li><strong>Retourredenen zijn een vaste lijst.</strong> Een vrij tekstveld leverde balkjes met "te klein", "Te klein!!" en "past niet echt" — zes staafjes van n=1 zeggen niets. De database krijgt altijd het Nederlandse label, ook als de klant de site in het Duits gebruikt.</li>
  <li><strong>Store credit is gratis</strong> en houdt de omzet binnen; geld terug kost retourkosten. Het tegoed wordt pas uitgegeven bij ontvangst.</li>
  <li><strong>De refund-formule staat op één plek</strong>, gedeeld door server en klantpreview. Eerder rekende het scherm met de brutosom terwijl de server pro-rata verrekende — dan belooft de preview meer dan er wordt uitbetaald.</li>
  <li><strong>Split-orders</strong> krijgen pas een verzendlabel als élk winkeldeel gereed is gemeld; anders vertrekt een halve bestelling.</li>
</ul>`,
      },
    ],
  },

  {
    id: "portal",
    rom: "Deel VIII",
    titel: "De portal",
    intro: "De stuurhut: waar het team werklijsten afwerkt, cijfers leest en alle knoppen bedient.",
    hoofdstukken: [
      {
        nr: "8.1",
        titel: "Hoe de portal aan de data komt",
        html: `
<p>De portal is een eigen applicatie met een eigen login. Hij praat als tussenlaag met de kern: elke aanvraag gaat server-to-server met een token, zodat er nooit een sleutel in de browser belandt.</p>
<ul class="lijst">
  <li>De <strong>identiteit</strong> van de medewerker komt uit de sessie van de portal, nooit uit de browser. Zo is een actie altijd aan een persoon te koppelen.</li>
  <li><strong>Portalgebruik wordt gemeten</strong> per pagina per gebruiker per dag. Reden: er zijn bijna tweehonderd schermen en "dit gebruiken we niet" was altijd een gevoel. Bij het opschonen rond de SRS-uitfasering is dat te riskant — één verkeerd weggegooid scherm is een afdeling die vastloopt.</li>
  <li>Sommige beheerschermen draaien bewust in de webshop zelf: de heatmap-viewer (omdat de kleurlaag over de échte pagina moet liggen) en dit handboek.</li>
</ul>`,
      },
      {
        nr: "8.2",
        titel: "Bestellingen",
        html: `
<ul class="lijst">
  <li><strong>Lijst</strong> met filters op status, kanaal en betaling (openstaand, mislukt, betaald), plus een export naar CSV met exact dezelfde filters.</li>
  <li><strong>Detail</strong> met het volledige toewijzingsplan, een momentopname van de betaling (wat er terug mag, of een nieuwe betaallink is toegestaan) en het logboek van handmatige acties.</li>
  <li><strong>Acties</strong>: status zetten, niet-leverbaar melden en afhandelen, nieuwe betaallink, (deel)terugbetaling, betaalstatus ophalen na een gemiste webhook, annuleren, bevestiging opnieuw sturen, adres corrigeren, opnieuw routeren, notitie plaatsen.</li>
  <li><strong>Orderbouwer</strong>: met de hand een bestelling aanmaken (telefonisch, per mail, of een nabestelling na een klacht) mét betaallink. Die loopt door dezelfde motor als de webshop: prijzen uit de database, voorraad atomair geclaimd.</li>
  <li><strong>Dupliceren</strong> zet een bestaande order klaar als voorstel tegen de huidige prijzen — dat is meteen de manier om een order te "wijzigen": dupliceren, aanpassen, de oude annuleren.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Een betaalde bestelling krijgt nooit een nieuwe betaallink.</strong> Klinkt vanzelfsprekend, maar "betaald" is niet één status — verzonden, klaar voor afhalen en bezorgd zijn het ook. Die regel staat daarom in een apart, getest bestand en niet verstopt in een knop.</p>
</div>`,
      },
      {
        nr: "8.3",
        titel: "Producten, content en site",
        html: `
<ul class="lijst">
  <li><strong>PIM</strong>: productenlijst met kwaliteitsfilters, één-artikel-scherm, bulkbewerking, export en het kwaliteitsoverzicht van de hele catalogus.</li>
  <li><strong>Site-CMS</strong>: menu, footer, pagina's, gelegenheden, looks, bundels en de homepage-indeling — allemaal met botsingsbeveiliging.</li>
  <li><strong>Merchandising</strong>: pins en regels, met een voorbeeld naast de huidige volgorde.</li>
  <li><strong>SEO</strong>: overrides per pad, omleidingen, en de vertaalbeheerpagina met handmatige overrides.</li>
  <li><strong>Studio's</strong>: modellen, sfeerbeelden, hero-banners, beeldbank en de fotografeer-werklijsten (producten zonder eigen beeld).</li>
</ul>`,
      },
      {
        nr: "8.4",
        titel: "Meten",
        html: `
<div class="kv">
  <div><b>Overzicht</b><span>KPI's, omzet per dag, topproducten, statusverdeling, laatste orders.</span></div>
  <div><b>Analyse</b><span>Omzet per categorie, retentiecohorten en de conversietrechter.</span></div>
  <div><b>Gedrag</b><span>Funnel per stap, zoekopdrachten inclusief die zonder resultaat, navigatie-inzichten en welke uitverkochte maten worden aangeklikt — een direct inkoopsignaal.</span></div>
  <div><b>Heatmap</b><span>Kliks, dode kliks, woede-kliks en scrolldiepte per pagina, met de kleurlaag over de echte pagina.</span></div>
  <div><b>Experimenten</b><span>Uitslag per variant met significantie, plus een waakhond op scheve verdeling.</span></div>
  <div><b>Rapportage</b><span>Tabellen en tegels: vouchers, cadeaubonnen, nieuwsbrief, reviews, retouren. Klantnamen zitten achter een aparte vlag.</span></div>
</div>`,
      },
      {
        nr: "8.5",
        titel: "Klanten en marketing",
        html: `
<ul class="lijst">
  <li><strong>Klantenlijst</strong> met bestellingen en besteed bedrag, en het complete klantbeeld per klant.</li>
  <li><strong>Doelgroepen</strong>: bouwen, live tellen, voorbeeld bekijken, vastzetten en uitleveren.</li>
  <li><strong>E-mailflows</strong>: bouwen, de trechter per stap zien, proefdraaien zonder te versturen, en aanzetten als aparte handeling.</li>
  <li><strong>Punten</strong>: bonusrapportage (adoptie, trechter, effect) en met de hand toekennen als coulance, met verplichte naam van de medewerker.</li>
  <li><strong>Terug op voorraad</strong>: aanmeldingen, statistiek en de flow-instellingen.</li>
</ul>`,
      },
      {
        nr: "8.6",
        titel: "De instellingen",
        html: `<p>Alle knoppen, met hun huidige waarde. Wat hier staat wordt live uit de instellingen gelezen — het handboek kan dus niet verouderen ten opzichte van de winkel.</p>`,
        auto: "instellingen",
      },
    ],
  },

  {
    id: "automatisering",
    rom: "Deel IX",
    titel: "Automatisering en bewaking",
    intro: "Wat er vanzelf draait, wat zichzelf herstelt en waar de meldingen naartoe gaan.",
    hoofdstukken: [
      {
        nr: "9.1",
        titel: "De takenkalender",
        html: `<p>Alle geplande taken, rechtstreeks uit de projectconfiguratie. Elke taak is ook met de hand te starten door een beheerder.</p>`,
        auto: "crons",
      },
      {
        nr: "9.2",
        titel: "Zelfherstel",
        html: `
<p>Op de plekken waar een gemiste stap stil schade doet, staat een vangnet. Het patroon is telkens hetzelfde: niet op mutaties sturen maar op <strong>verschil</strong>, en idempotent werken zodat dubbel draaien niets kost.</p>
<div class="tabel-wrap">
  <table>
    <thead><tr><th scope="col">Waar</th><th scope="col">Wat er misging</th><th scope="col">Het vangnet</th></tr></thead>
    <tbody>
      <tr><td>Spaarpunten</td><td>Punten werden alleen op twee toevallige momenten geschreven; 28.392 betaalde orders tegenover 4 regels in het grootboek</td><td>Uurlijkse bijboeking van orders zonder puntenregel</td></tr>
      <tr><td>Wallet-pas</td><td>Een schrijfpad zonder seintje laat een pas stil achterlopen</td><td>Dagelijkse vergelijking van pas-saldo met het echte saldo</td></tr>
      <tr><td>Voorraadclaims</td><td>Een mislukte opruiming laat de teller weglopen van de werkelijke claims</td><td>Reconcile na elke opruimronde, met drift-historie</td></tr>
      <tr><td>Catalogus-vlaggen</td><td>Stonden vijftien dagen stil omdat niemand het script draaide</td><td>Periodieke verversing</td></tr>
      <tr><td>Productfoto's</td><td>Beelden in Shopify werden nooit opgehaald na de laatste import</td><td>Dagelijkse fotosynchronisatie met een venster dat een gemiste nacht inhaalt</td></tr>
    </tbody>
  </table>
</div>`,
      },
      {
        nr: "9.3",
        titel: "Bewaking en meldingen",
        html: `
<ul class="lijst">
  <li><strong>Kassabon-bewaking</strong> draait elke nacht en doet vijf controles. Twee daarvan bewaken geld: bonnen die de dagstaat mist, en meer geretourneerd dan verkocht.</li>
  <li><strong>Stil bij nul.</strong> Bij een schone stand gaat er géén mail. Een dagelijkse "alles goed"-mail wordt binnen een week weggeklikt, en dan valt de echte melding er ook tussenuit.</li>
  <li><strong>Meldingen gaan naar de adressen die je zelf instelt.</strong> Staat daar niemand, dan blijft de melding in het logboek staan. Er is een testknop die ook bij een schone stand mailt, zodat je het kanaal kunt controleren.</li>
  <li><strong>De drift-monitor</strong> in de portal laat zien hoe vaak en hoeveel de anti-oversell-teller wegliep.</li>
</ul>`,
      },
      {
        nr: "9.4",
        titel: "De sandbox",
        html: `
<p>Een aparte omgeving met een eigen database-vertakking en eigen opslag, 's nachts ververst vanaf productie en direct daarna geanonimiseerd — vóór iemand erbij kan.</p>
<div class="let gevaar">
  <p><strong>De gevaarlijkste regel code in het project.</strong> Herstellen overschrijft de doelvertakking met de bron. Worden de twee ooit verwisseld — in een instelling, bij het kopiëren van een project, door een typefout — dan herstelt die functie productie vanuit de sandbox. Dat is geen storing maar dataverlies van jaren. Daarom zit de controle niet in de documentatie maar in de code, met meerdere weigergronden.</p>
</div>
<ul class="lijst">
  <li><strong>Een slot op de voordeur.</strong> Externe adressen staan op tientallen plekken hard in de code; één vergeten instelling en een "veilige" sandbox boekt een echte bon. Daarom grijpt de sandbox in op de enige plek waar álle koppelingen langskomen: het uitgaande verkeer zelf. Drie uitkomsten en geen vierde — doorlaten, omleiden, of nabootsen.</li>
  <li><strong>De nabootsingen houden echte stand bij</strong>: voorraad die daalt als je verkoopt, bonnen die opgeslagen worden, betalingen die dezelfde idempotentie kennen als het echte systeem. Een nabootsing die alles goedkeurt verbergt precies de fouten die je wilt vinden.</li>
  <li><strong>Mail en WhatsApp</strong> komen in een sandbox-postvak, zodat een tester in één lijst ziet wat er "naar buiten" zou zijn gegaan.</li>
</ul>`,
      },
      {
        nr: "9.5",
        titel: "Testen en uitrollen",
        html: `
<ul class="lijst">
  <li>Bij elke wijziging draait automatisch een typecontrole en de testsuite. Er wordt eerst geteld of er überhaupt testbestanden zijn — een lege testmap zou anders stil groen worden.</li>
  <li>De tests dekken de plekken waar een stille fout het duurst is: veiligheidsvoorraad, retourbedragen en -redenen, puntenacties, kortingen, A/B-verdeling, maattabel-keuring, PIM-regels, de sandbox-weigering en de anonimisering.</li>
  <li>Die laatste is een waakhond: elke tabel met persoonsgegevens móet in de anonimisering voorkomen. Toen die test voor het eerst draaide stonden er vijf tabellen niet in, waaronder 48.336 klantprofielen.</li>
  <li>Elke pull request krijgt een eigen voorvertoning met een echte database-vertakking.</li>
</ul>`,
      },
      {
        nr: "9.6",
        titel: "Modules en endpoints",
        html: `<p>Onder dit hoofdstuk staat de volledige, automatisch afgeleide index van wat er in de codebase leeft. Hij wordt bij elke build opnieuw opgebouwd uit de code zelf: een nieuwe module of endpoint verschijnt hier vanzelf, met de toelichting die de ontwikkelaar erbij schreef.</p>`,
        auto: "modules",
      },
      {
        nr: "9.7",
        titel: "De API-oppervlakte",
        html: `<p>Alle endpoints, gegroepeerd naar poort. Ook deze lijst komt uit de code.</p>`,
        auto: "endpoints",
      },
    ],
  },

  {
    id: "grenzen",
    rom: "Deel X",
    titel: "Grenzen en spelregels",
    intro: "Wat er vandaag niet in zit, wat er nog moet gebeuren, en de regels die overal gelden.",
    hoofdstukken: [
      {
        nr: "10.1",
        titel: "Grenzen",
        html: `
<div class="kv">
  <div><b>SRS blijft het magazijnsysteem</b><span>Er gaat geen weborder naartoe. Onze ontvangstmutatie overbrugt het gat tot SRS de ontvangst zelf verwerkt; dat overdrachtsmoment wordt vóór livegang getoetst.</span></div>
  <div><b>Pinnen aan de kassa</b><span>Loopt via de fysieke terminal met een eigen sleutel. De integratie is er; de keuze van terminal en provider bepaalt het eindplaatje.</span></div>
  <div><b>Catalogus en prijzen</b><span>De kassa werkt met SRS-artikeldata, de site met de eigen catalogus. De voorraad is wél gedeeld; het samenvoegen van de artikeldata staat op de routekaart.</span></div>
  <div><b>Voorraad elke 5 minuten</b><span>De delta loopt mee in een schaduwtabel. Pas overschakelen als hij exact gelijkloopt.</span></div>
  <div><b>Shopify</b><span>Levert tijdens de overgang nog orders en foto's. Zodra hij dicht gaat, moeten artikelen met alleen Shopify-beeld eigen foto's hebben.</span></div>
</div>`,
      },
      {
        nr: "10.2",
        titel: "Livegang",
        html: `
<p>De omschakeling is een korte lijst schakelaars, bewust zichtbaar en omkeerbaar.</p>
<ul class="lijst">
  <li>Betaling van test naar live.</li>
  <li>Indexeren aan, en de afscherming van de omgeving eraf.</li>
  <li>Domein omzetten (met een lage vernieuwingstijd vooraf) en het oude platform pauzeren.</li>
  <li>Sitemap indienen en de omleidingen voor oude adressen live.</li>
  <li>Daarna verifiëren: één echte testbestelling met een klein bedrag, vertaalde pagina's, robots op allow, en een verkoop aan de kassa die de webvoorraad zichtbaar verlaagt.</li>
</ul>
<div class="let waarschuwing">
  <p><strong>Let op bij livegang:</strong> er is geen testadres-filter op klantmail. Zodra de betaling live staat gaan bevestigingen naar échte klanten — dat is zo bedoeld, maar het betekent dat je niet meer "even" een testbestelling met een willekeurig adres doet.</p>
</div>`,
      },
      {
        nr: "10.3",
        titel: "Tien spelregels",
        html: `
<ul class="lijst">
  <li><strong>1.</strong> Voorraad ontstaat bij de scan, niet bij de pakbon.</li>
  <li><strong>2.</strong> Onderweg telt bij niemand mee.</li>
  <li><strong>3.</strong> Wat je niet telt, kun je niet claimen.</li>
  <li><strong>4.</strong> Dubbel boeken kan niet — elke mutatie draagt zijn eigen sleutel.</li>
  <li><strong>5.</strong> Prijzen en kortingen komen van de server, nooit uit de browser.</li>
  <li><strong>6.</strong> Geld is een geheel getal in centen.</li>
  <li><strong>7.</strong> Eén bron per gegeven; staat het op twee plekken, dan lopen ze uit elkaar.</li>
  <li><strong>8.</strong> Een belofte aan de klant en de werklijst in de winkel komen uit dezelfde berekening.</li>
  <li><strong>9.</strong> Geen belofte is beter dan een verkeerde.</li>
  <li><strong>10.</strong> De knoppen staan in de portal, niet in de code.</li>
</ul>`,
      },
      {
        nr: "10.4",
        titel: "Winkels",
        html: `<p>De filialen zoals ze in de winkelgegevens staan — dezelfde bron die de site, de pakbon en de afhaalkeuze gebruiken.</p>`,
        auto: "winkels",
      },
    ],
  },
];
