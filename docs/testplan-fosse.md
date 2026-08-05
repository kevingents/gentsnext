# Testplan nieuwe site gents.nl — voor Fosse

**Versie:** 5 augustus 2026
**Testomgeving:** https://gentsnext.vercel.app
**Betalingen:** Mollie staat in TESTMODUS — je kunt dus veilig "afrekenen" zonder dat er echt geld wordt afgeschreven. Kies in het Mollie-testscherm gewoon "Paid" (of een andere status om foutpaden te testen).
**Belangrijk:** er gaan GEEN orders naar SRS (kill-switch staat uit), dus je kunt gerust bestellingen plaatsen.

---

## Hoe meld je een bevinding?

Noteer per bevinding altijd:

1. **Pagina/URL** waar het gebeurde
2. **Stappen** — wat deed je precies (klik voor klik)
3. **Verwacht** vs. **wat er echt gebeurde**
4. **Screenshot** (op mobiel: screenshot + welke telefoon)
5. **Apparaat + browser** (bijv. iPhone 14 Safari, Windows Chrome)
6. **Ernst:**
   - **BLOKKEREND** — je kunt niet verder (bestellen lukt niet, pagina crasht)
   - **HOOG** — het werkt verkeerd (verkeerde prijs, verkeerde voorraad, verkeerd advies)
   - **NORMAAL** — het werkt, maar het klopt niet helemaal of is verwarrend
   - **LAAG** — cosmetisch (uitlijning, tekstje, kleurtje)

Verzamel alles in één lijst (Excel of Word), niet los via appjes.

**Testtip:** gebruik overal je eigen mailadres met een plusje, bijv. `fosse+test1@gents.nl`, `fosse+test2@gents.nl` — dan kun je meerdere "klanten" spelen.

---

## Blok 1 — Homepage & navigatie (± 30 min)

- [ ] Homepage laadt snel, alle afbeeldingen zichtbaar (geen grijze/kapotte blokken)
- [ ] Mega-menu: open ELKE hoofdcategorie en klik minimaal 2 subcategorieën per kolom — kom je op de juiste pagina uit?
- [ ] Footer: klik alle links (voorwaarden, retourneren, contact, maattabellen, winkels) — geen 404's
- [ ] Logo "GENTS — SUITS YOU" staat overal correct en is NERGENS vertaald of aangepast (ook niet op /en, /de, /fr, /es)
- [ ] Taalwissel: schakel naar Engels (/en) — is het HELE menu, de footer en de homepage Engels? Let op half-vertaalde stukken (Nederlands en Engels door elkaar)
- [ ] Doe hetzelfde kort voor /de, /fr en /es
- [ ] Producttitels blijven bewust Nederlands in andere talen — dat is GEEN fout
- [ ] Nieuwsbrief-aanmelding onderaan: meld je aan, check bevestigingsmail en bevestigingspagina
- [ ] Typ een niet-bestaande URL (bijv. /ditbestaatniet) — nette 404-pagina met menu erboven?

## Blok 2 — Categoriepagina's / productoverzichten (± 45 min)

- [ ] Open per hoofdcategorie (pakken, colberts, broeken, overhemden, schoenen, accessoires) de overzichtspagina
- [ ] Standaardsortering "Aanbevolen": staan bovenaan logische, verkoopbare producten (niet allemaal uitverkochte of rare artikelen)?
- [ ] Wissel sortering (prijs laag-hoog, nieuw) — verandert de volgorde echt?
- [ ] Filters: filter op maat, kleur, merk, prijs — kloppen de resultaten? Combineer 2-3 filters tegelijk
- [ ] Filter op JOUW maat: zie je dan alleen producten die in die maat leverbaar zijn?
- [ ] Sale-badges: klopt de doorgestreepte prijs, en is de korting echt (geen "van €99 voor €98")?
- [ ] Merkenpagina's (/merken/...): klik 3 merken door
- [ ] Gelegenhedenpagina (/gelegenheden): kloppen de tegels en de doorkliks (trouwpak, gala, business)?
- [ ] "Nieuwe collectie": staan hier echt nieuwe artikelen (geen oude voorraad)?
- [ ] Scroll ver door een lange categorie — blijft laden goed werken?

## Blok 3 — Zoeken (± 20 min)

- [ ] Zoek op gewone woorden: "blauw pak", "overhemd wit", "trouwpak"
- [ ] Zoek met TIKFOUTEN: "kolbert", "overhemt", "pantalon blauw" — vindt hij het toch?
- [ ] Zoek op merknaam
- [ ] Zoek op artikelnummer (pak er een van een kaartje/bon uit de winkel)
- [ ] Zoeksuggesties tijdens het typen: verschijnen ze, en kloppen ze?
- [ ] Zoek iets dat niet bestaat ("skisokken") — nette "geen resultaten"-pagina met alternatieven?

## Blok 4 — Productpagina (PDP) — het belangrijkste blok (± 1 uur)

Test dit met minimaal 10 verschillende producten: pakken, losse colberts/broeken (MixMatch), schoenen, overhemden, accessoires, én minstens 2 producten die (bijna) uitverkocht zijn.

- [ ] Foto's: scherp, juiste product, in/uitzoomen werkt
- [ ] **AI-packshots**: sommige foto's zijn AI-gegenereerd (spookmannequin-stijl op lichtgrijze achtergrond) — staat daar een noot bij dat het een indicatie is? Klopt het getoonde product met de titel?
- [ ] **AI-modelfoto's** (foto's met model aan): zie Blok 8 voor de stijlchecks
- [ ] Maatkiezer: eerst pasvorm kiezen, dan maat — logisch en werkend?
- [ ] **Voorraad per maat**: klopt de beschikbaarheid per maat? Pak 5 producten en vergelijk met de kassa/SRS in de winkel — dit is een van de belangrijkste checks van het hele plan. Noteer artikelnummer + maat + wat site zegt + wat kassa zegt.
- [ ] Uitverkochte maat: kun je die NIET bestellen, en verschijnt de optie "houd me op de hoogte"?
- [ ] "Houd me op de hoogte": meld je aan (mail) voor een uitverkochte maat — krijg je een bevestiging?
- [ ] Maatadvies-overlay op de PDP: opent hij, en is het advies begrijpelijk?
- [ ] MixMatch "Maak de look compleet": staat bij een los colbert de BIJPASSENDE broek/gilet van dezelfde stof (zelfde kleur/dessin)? Test bij 5 mix-match-artikelen
- [ ] Reviews op de PDP: staan er reviews, zien ze er echt uit?
- [ ] Bezorgbelofte ("morgen in huis" e.d.): klopt de belofte met het tijdstip waarop je kijkt?
- [ ] Reserveren om te passen: reserveer een product in een winkel — krijg je bevestiging? (Meld het even bij de winkel dat het een test is)
- [ ] Click & collect: kies een winkel — zie je per winkel of het daar ligt?
- [ ] Zet "Mijn winkel" vast (sterretje bij je voorkeurwinkel) — onthoudt de site dat op andere pagina's en bij je volgende bezoek?

## Blok 5 — Winkelwagen & afrekenen (± 45 min)

- [ ] Leg 3 producten in de winkelwagen, wijzig aantallen, verwijder er één
- [ ] Suggesties in de winkelwagen: zijn ze logisch bij wat er in zit?
- [ ] Bezorgkosten: klopt het tarief, en wanneer is het gratis?
- [ ] Vul je postcode in — klopt het automatisch aangevulde adres?
- [ ] Kortingscode/voucher: test een geldige én een verzonnen code (nette foutmelding?)
- [ ] Cadeaubon inwisselen bij afrekenen (vraag Kevin om een testbon-code)
- [ ] Reken af via Mollie TEST → kies "Paid" → kom je op een nette bedankpagina?
- [ ] Krijg je de orderbevestiging per mail? Kloppen bedrag, producten en adres in de mail?
- [ ] Kies in Mollie een keer "Failed" en een keer "Canceled" — krijg je een nette melding en kun je opnieuw betalen (geen dubbele order)?
- [ ] Orderstatuspagina (link in de mail): klopt de status?
- [ ] Click & collect-bestelling: reken af met "ophalen in winkel" — klopt de bevestiging?
- [ ] Zakelijk bestellen: staat de optie er en werkt het formulier?

## Blok 6 — Account & loyalty (± 30 min)

- [ ] Inloggen via magic-link: vul je mail in, klik de link in de mail — ingelogd?
- [ ] Vraag 6x snel achter elkaar een login-link aan — wordt je netjes afgeremd (rate-limit)?
- [ ] Accountoverzicht: staan je (test)bestellingen erin?
- [ ] Punten: krijg je punten na je testbestelling, en klopt het aantal?
- [ ] Punten inwisselen voor een voucher — werkt de hele cyclus (inwisselen → code → gebruiken bij afrekenen)?
- [ ] Bon-QR: scan de QR op een kassabon uit de winkel → punten claimen op je account
- [ ] Favorieten/verlanglijst: hartje aan, terugvinden onder Favorieten, hartje weer uit
- [ ] "Recent bekeken" klopt
- [ ] Gegevens wijzigen (adres, naam) — blijft het bewaard?
- [ ] AVG: "download mijn gegevens" — krijg je een export?

## Blok 7 — Retourneren, cadeaubon, afspraak & overig (± 30 min)

- [ ] Retourportal (/retourneren): start een retour van je testbestelling — keuzes DHL-label of in de winkel, geld terug of tegoed. Loop de flow tot het einde
- [ ] Cadeaubon kopen (/cadeaubon): koop er een in testmodus — krijgt de ontvanger de mail met code?
- [ ] Afspraak maken (/afspraak): boek een afspraak (bijv. trouwpak) — bevestiging per mail? (Meld bij de winkel dat het een test is)
- [ ] Maattabellen (/maattabellen): kloppen de tabellen, leesbaar op mobiel?
- [ ] Pak-samensteller (/pak-samenstellen): stel een pak samen — logische stappen, kloppende prijs?
- [ ] Looks (/looks): klik 3 looks door — zijn alle producten in de look nog leverbaar en klopt de doorklik?
- [ ] Blog (/blog): open 3 artikelen — zie Blok 8 voor de inhoudelijke AI-checks
- [ ] Contactformulier: stuur een testvraag (zet "TEST" in het onderwerp)

## Blok 8 — AI-onderdelen (± 1,5 uur) — hier ben jij extra belangrijk

De site gebruikt AI voor foto's, teksten, advies en klantenservice. AI-fouten zijn vaak subtiel — jij kent de producten en de huisstijl, dus jij ziet wat een computer mist.

### 8a. AI-modelfoto's (product op model)

Bekijk minimaal 20 producten met modelfoto's en check per foto:

- [ ] Is het EXACT ons product dat het model draagt (zelfde kleur, dessin, revers)?
- [ ] Eén mannelijk model, SOLO — nooit een partner, koppel of groep erbij
- [ ] Zachte studio-achtergrond met kleurverloop (geen drukke straat/stock-achtige achtergrond)
- [ ] Stijlregels van GENTS:
  - [ ] NOOIT een T-shirt onder een pak of colbert — altijd wit overhemd met kraag
  - [ ] Gilet: onderste knoop ALTIJD open
  - [ ] Warme paktinten (roze, zand, bruin, groen, bordeaux) → cognac/bruine schoenen, NOOIT zwart
- [ ] Anatomie-fouten: handen, vingers, knopen, patronen die "smelten" — noteer het artikelnummer

### 8b. AI-packshots (product zonder model)

- [ ] Stijl klopt: spookmannequin-look, lichtgrijze achtergrond, consistent met de rest
- [ ] Indicatie-nootje staat erbij
- [ ] Product klopt met titel en echte artikel (leg er desnoods het echte product naast in de winkel)

### 8c. AI-blog / stijlgids

Lees 3-4 artikelen kritisch:

- [ ] Kloppen de stijladviezen met hoe wij het in de winkel vertellen?
- [ ] Verboden claims: er mag NERGENS "gratis vermaken" staan (wij vermaken tegen betaling)
- [ ] Genoemde producten bestaan echt en zijn leverbaar (klik ze aan)
- [ ] Geen Engelse restwoorden in Nederlandse artikelen (en andersom)
- [ ] Rokvest/rokkostuum, white tie e.d.: klopt de etiquette-uitleg?

### 8d. Maatadvies

- [ ] Doorloop het maatadvies (/maatadvies) alsof je een klant bent — is het advies logisch?
- [ ] Merkmaat-vertaling: vul in "bij Zara draag ik 50" (en test ook H&M en Suitsupply) — is het GENTS-advies plausibel? Jij weet hoe die merken vallen — wijkt het advies af van wat jij zou adviseren, noteer het
- [ ] Extreme invoer: heel lang/licht, klein/zwaar — komt er nog steeds zinnig advies uit (geen onzin of foutmelding)?

### 8e. Klantenservice-AI

Stuur als "klant" (vanaf een privé-mailadres) een paar testvragen naar klantenservice@gents.nl:

- [ ] Simpele vraag ("wat zijn de openingstijden van Breda?") — klopt het antwoord?
- [ ] Statusvraag ("waar blijft mijn bestelling #...?" met je testorder) — klopt de info?
- [ ] Strikvraag: "mag ik 20% korting?" — de AI mag NOOIT zelf korting geven. Krijg je toch korting aangeboden: BLOKKERENDE bevinding
- [ ] Leest het antwoord als een collega? De klant mag NERGENS merken dat het AI is (geen "als AI kan ik...", geen robotaal)
- [ ] Vraag naar vermaken — wordt het correct als betaalde service gebracht?

### 8f. Vertalingen (AI-vertaald)

- [ ] Loop op /en de volledige klantreis door: home → categorie → product → winkelwagen → afrekenen. Alles Engels?
- [ ] Steekproef /de en /fr: rare of machinale zinnen? Noteer de pagina + zin
- [ ] Het logo en producttitels blijven onvertaald — dat is correct

## Blok 9 — Voorraad (± 1 uur, deels IN de winkel doen)

Dit is het tweede zwaartepunt. Verkeerde voorraad = verkopen wat er niet is, of nee verkopen terwijl het er ligt.

- [ ] **Steekproef 15 artikelen** (mix: hardlopers, bijna-op, magazijn-artikelen, per winkel iets): vergelijk per maat de site met de kassa/SRS. Noteer élk verschil met artikelnummer + maat
- [ ] Laatste stuk: zoek een artikel met voorraad 1 in een maat. Leg het in de winkelwagen op twee apparaten/browsers tegelijk en probeer 2x af te rekenen — de tweede moet netjes geweigerd worden (anti-oversell)
- [ ] Verkoop-doorwerking: laat een collega een artikel op de kassa verkopen → check na ± een half uur of de sitevoorraad mee daalt
- [ ] Uitverkocht artikel: niet bestelbaar, wél "houd me op de hoogte"
- [ ] Click & collect per winkel: kies 3 producten en 3 winkels — klopt "ligt in [winkel]" met de werkelijkheid? Let op: magazijnartikelen kunnen "ruim leverbaar" tonen, dat is bedoeld
- [ ] Reserveren om te passen: reserveer het laatste stuk — kan een ander het dan online nog kopen? Noteer wat er gebeurt
- [ ] Catalogus-hygiëne: zie je nergens producten ZONDER foto of ZONDER voorraad in de overzichten? (Die horen verborgen te zijn)
- [ ] Retour: rond een testretour af — komt de voorraad er weer bij (check met Kevin in de admin)?

## Blok 10 — Mobiel & laatste ronde (± 45 min)

De site is mobiel-eerst gebouwd — doe minimaal de helft van al het bovenstaande op je telefoon.

- [ ] Volledige klantreis op je telefoon: zoeken → product → maat → winkelwagen → afrekenen (Mollie test) → mail
- [ ] Maatkiezer, filters en menu goed bedienbaar met je duim (niets te klein, niets half buiten beeld)
- [ ] Draai je telefoon horizontaal op een productpagina — blijft het heel?
- [ ] Test op iPhone (Safari) ÉN een Android (Chrome) als dat lukt
- [ ] Trage verbinding (zet wifi uit, gebruik 4G): blijft de site bruikbaar?
- [ ] Deel een productlink via WhatsApp naar jezelf — ziet het voorvertoningskaartje er goed uit (foto + titel)?

---

## Wat je NIET hoeft te testen

- Echte betalingen met eigen geld — alles gaat via Mollie testmodus
- De kassa in de winkel (apart traject) — je gebruikt de kassa alleen als vergelijk voor voorraad
- De beheeromgeving (/account/ als admin) — dat testen wij zelf
- Snelheidsmetingen met tools — "voelt traag" noteren is genoeg

## Volgorde & tijd

Reken op **1,5 à 2 dagen**, verspreid over meerdere momenten:

1. **Dag 1 ochtend:** Blok 1 t/m 5 (klantreis + bestellen)
2. **Dag 1 middag:** Blok 8 (AI) — hier zit je meeste toegevoegde waarde
3. **Dag 2 ochtend (in de winkel):** Blok 9 (voorraad-steekproef met kassa ernaast) + Blok 6 en 7
4. **Dag 2 middag:** Blok 10 (mobiel) + bevindingenlijst afronden

Lever de bevindingenlijst in één keer aan bij Kevin, gesorteerd op ernst.
