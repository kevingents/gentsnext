/**
 * lib/sandbox/nep-srs.js — SRS zonder SRS.
 *
 * SRS is de gevaarlijkste koppeling die we hebben: daar hangt echte voorraad,
 * echte backoffice en (via de bonnummer-teller) echt geld aan. De drie
 * geld-incidenten van 6 augustus kwamen allemaal uit deze hoek. In de sandbox
 * mag er dus geen enkel pakketje richting srs.nl of storeinfo.nl.
 *
 * Deze nabootsing is bewust NIET "altijd ja zeggen". Hij houdt echte stand bij:
 * voorraad die daalt als je verkoopt, bonnen die opgeslagen worden, en
 * personeelscodes die moeten kloppen. Anders test je alleen of je code niet
 * crasht, niet of hij klopt.
 *
 * WAT ER GEBEURT MET ONBEKENDE ACTIES
 * SRS heeft tientallen webservices. Een actie die hier nog niet nagebootst is,
 * krijgt een SOAP Fault met een duidelijke tekst — geen leeg-maar-geldig
 * antwoord. Een leeg antwoord ziet er namelijk uit als "0 resultaten" en dat is
 * precies het soort stille onwaarheid waar je een sandbox voor gebruikt om hem
 * te vinden. Nu valt het op, en het logboek vertelt welke actie ontbreekt.
 */

import { PAD, lees, schrijf, voegToe, leesRegie } from './state.js';
import { DEMO_PERSONEEL, DEMO_VOORRAAD } from './seed.js';

const XML_KOP = { 'content-type': 'text/xml; charset=utf-8', 'x-gents-sandbox': 'srs' };

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function envelop(binnenkant) {
  return `<?xml version="1.0" encoding="UTF-8"?>` +
    `<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/">` +
    `<SOAP-ENV:Body>${binnenkant}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;
}

function xmlAntwoord(binnenkant, status = 200) {
  return new Response(envelop(binnenkant), { status, headers: XML_KOP });
}

function fout(bericht) {
  return xmlAntwoord(
    `<SOAP-ENV:Fault><faultcode>Sandbox</faultcode>` +
    `<faultstring>${esc(bericht)}</faultstring></SOAP-ENV:Fault>`,
    500
  );
}

/** Waarde van één tag uit het binnenkomende verzoek. */
function tag(xml, naam) {
  const m = String(xml || '').match(
    new RegExp(`<(?:[\\w.-]+:)?${naam}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${naam}>`, 'i')
  );
  return m ? m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim() : '';
}

function alleTags(xml, naam) {
  const re = new RegExp(`<(?:[\\w.-]+:)?${naam}\\b[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${naam}>`, 'gi');
  return Array.from(String(xml || '').matchAll(re)).map((m) => m[1]);
}

/* ── Voorraad ──────────────────────────────────────────────────────────────
   Bijgehouden per "filiaal|scancode". Begint bij de demo-voorraad en beweegt
   mee met wat je in de sandbox verkoopt, ontvangt of verplaatst. */

async function voorraadKaart() {
  const opgeslagen = await lees(PAD.srsVoorraad, null);
  if (opgeslagen && typeof opgeslagen === 'object' && Object.keys(opgeslagen).length) return opgeslagen;
  return { ...DEMO_VOORRAAD };
}

async function muteerVoorraad(veranderingen) {
  const kaart = await voorraadKaart();
  for (const [sleutel, delta] of Object.entries(veranderingen)) {
    const nu = Number(kaart[sleutel] || 0);
    kaart[sleutel] = nu + Number(delta || 0);
  }
  await schrijf(PAD.srsVoorraad, kaart);
  return kaart;
}

/* ── Kassabon boeken (pos.storeinfo.nl/webservices/kassabonservice.php) ──── */

/**
 * De echte service antwoordt met een LEGE <return> als de bon geboekt is, en
 * met een gevulde <return> (bv. "authentication error") als hij hem weigert.
 * `srsAccepted()` in srs-boekbon.js leest precies dat, dus dat spiegelen we.
 */
/**
 * Bon-tekst → voorraadmutaties per "filiaal|scancode".
 *
 * Apart en exporteerbaar omdat dit het enige stukje van de nep-SRS is dat écht
 * kan liegen: klopt het teken of het veldnummer niet, dan beweegt de voorraad
 * in de sandbox de verkeerde kant op en ga je een bug zoeken die er niet is.
 * Zie test/unit/sandbox-nep-diensten.test.js.
 */
export function bonNaarVoorraadDeltas(bonText) {
  const regels = String(bonText || '').split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const kop = regels.find((r) => r.startsWith('KOP;')) || '';
  const filiaal = kop.split(';')[2] || '';

  const deltas = {};
  for (const regel of regels.filter((r) => r.startsWith('RGL;'))) {
    const v = regel.split(';');
    const scancode = v[4] || '';
    const aantal = Number(v[5]);
    if (!scancode || !Number.isFinite(aantal)) continue;
    const sleutel = `${filiaal}|${scancode}`;
    /* Verkoop haalt van de voorraad af; een retour komt als negatief aantal
       binnen en telt er dus vanzelf weer bij op. */
    deltas[sleutel] = (deltas[sleutel] || 0) - aantal;
  }
  return { filiaal, bonnr: kop.split(';')[1] || '', deltas, regels: regels.length };
}

async function boekBon(lichaam) {
  const regie = await leesRegie();
  if (regie.srsVertragingMs > 0) await wacht(regie.srsVertragingMs);
  if (regie.srsUitkomst === 'fout') {
    return xmlAntwoord(`<ns1:BoekBonResponse><return>sandbox: boeking geweigerd (ingesteld via de regieknop)</return></ns1:BoekBonResponse>`);
  }

  const bonText = tag(lichaam, 'bon');
  const company = tag(lichaam, 'company_id');
  const { filiaal, bonnr, deltas, regels } = bonNaarVoorraadDeltas(bonText);

  /* Voorraad meebewegen, zodat de sandbox ná een verkoop echt klopt en je
     fouten in de af-/bijboeklogica ziet in plaats van een bevroren getal. */
  if (Object.keys(deltas).length) await muteerVoorraad(deltas);

  await voegToe(PAD.srsBonnen, {
    op: new Date().toISOString(),
    bonnr,
    filiaal,
    company,
    regels,
    bon: bonText,
  });

  /* Lege <return> = geboekt. */
  return xmlAntwoord(`<ns1:BoekBonResponse><return></return></ns1:BoekBonResponse>`);
}

/* ── Personeel (Personnel.php → GetPersonnel) ─────────────────────────────
   De kassa logt hiermee de kassier in: personeelsnummer + PosLoginCode. */

function personeelXml(lijst) {
  const persoon = (p) => `<Person>` +
    `<PersonnelId>${esc(p.personnelId)}</PersonnelId>` +
    `<InternalName>${esc(p.internalName)}</InternalName>` +
    `<ExternalName>${esc(p.externalName)}</ExternalName>` +
    `<PersonnelGroupId>${esc(p.groupId || '1')}</PersonnelGroupId>` +
    `<PersonnelDiscountRate>0</PersonnelDiscountRate>` +
    `<PersonnelHourlyRate>0</PersonnelHourlyRate>` +
    `<PosLoginCode>${esc(p.posLoginCode)}</PosLoginCode>` +
    `<FingerprintRequiredToLogin>false</FingerprintRequiredToLogin>` +
    `<Active>${p.active === false ? 'false' : 'true'}</Active>` +
    `<Address><Street></Street><City></City></Address>` +
    (p.branches || []).map((b) => `<Branch><BranchId>${esc(b)}</BranchId></Branch>`).join('') +
    `</Person>`;
  return `<GetPersonnelResponse><Personnel>${lijst.map(persoon).join('')}</Personnel></GetPersonnelResponse>`;
}

function getPersoneel(lichaam) {
  /* Vraagt het verzoek om één filiaal, dan alleen de mensen van dat filiaal —
     zo test je ook of de winkelafscherming klopt. */
  const gevraagd = alleTags(lichaam, 'BranchId').map((b) => b.replace(/<[^>]+>/g, '').trim()).filter(Boolean);
  const lijst = gevraagd.length
    ? DEMO_PERSONEEL.filter((p) => p.branches.some((b) => gevraagd.includes(String(b))))
    : DEMO_PERSONEEL;
  return xmlAntwoord(personeelXml(lijst));
}

/* ── Voorraad opvragen (Stock.php) ────────────────────────────────────────── */

async function getVoorraad(lichaam) {
  const kaart = await voorraadKaart();
  const filiaal = tag(lichaam, 'BranchId') || '';
  const items = Object.entries(kaart)
    .filter(([sleutel]) => !filiaal || sleutel.startsWith(`${filiaal}|`))
    .map(([sleutel, aantal]) => {
      const [fil, scancode] = sleutel.split('|');
      return `<StockItem><BranchId>${esc(fil)}</BranchId>` +
        `<ScanCode>${esc(scancode)}</ScanCode>` +
        `<Quantity>${Number(aantal) || 0}</Quantity></StockItem>`;
    });
  return xmlAntwoord(`<GetStockResponse><Stock>${items.join('')}</Stock></GetStockResponse>`);
}

function wacht(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, Math.min(Number(ms) || 0, 10000))));
}

/**
 * Ingang vanuit het netwerkslot. Kiest op SOAPAction, met het pad als terugval
 * (de kassabonservice stuurt SOAPAction: BoekBon, maar niet elke client doet
 * dat netjes).
 */
export async function beantwoord(verzoek) {
  const actie = verzoek.soapActie || '';
  const pad = verzoek.url.pathname.toLowerCase();
  const lichaam = verzoek.lichaam || '';

  if (actie === 'BoekBon' || pad.includes('kassabonservice')) return boekBon(lichaam);
  if (actie === 'GetPersonnel' || pad.includes('personnel')) return getPersoneel(lichaam);
  if (/^GetStock/i.test(actie) || pad.includes('stock')) return getVoorraad(lichaam);

  const omschrijving = actie || pad;
  /* Best-effort loggen: dat het logboek onbereikbaar is mag de foutmelding
     hieronder — de eigenlijke boodschap aan de ontwikkelaar — niet opeten. */
  try {
    await voegToe(PAD.logboek, {
      op: new Date().toISOString(),
      host: verzoek.url.hostname,
      url: verzoek.url.href,
      soort: 'srs-niet-nagebootst',
      actie: omschrijving,
    });
  } catch { /* stil */ }
  return fout(
    `SRS-actie "${omschrijving}" is in de sandbox nog niet nagebootst. ` +
    `Voeg hem toe in lib/sandbox/nep-srs.js. (Bewust een fout en geen leeg antwoord: ` +
    `een leeg antwoord leest als "0 resultaten" en verbergt het gat.)`
  );
}
