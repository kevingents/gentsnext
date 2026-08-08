import { NextResponse } from "next/server";
import { getSessionCustomer } from "@/lib/account";
import { sendOpsAlert } from "@/lib/email";
import { getSettings } from "@/lib/settings";
import { meldingTekst } from "./melding";
import { geldAfwijkingen, gestrandTeller, totaalAfwijkingen, verifyPosSales } from "@/lib/verify-pos-sales";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Nachtelijke kassabon-verificatie (zie vercel.json) — dezelfde vijf controles
 * als `npm run verify:possales`, uit dezelfde lib. UITSLUITEND LEZEN.
 *
 * Twee daarvan bewaken geld:
 *  [1]/[2] bonnen die de DAGSTAAT mist. Die leest Neon-first en valt alleen
 *      terug op de blob als de core onbereikbaar is — niet als een bon er
 *      simpelweg niet in staat. Een gemist gat heelt nooit vanzelf.
 *  [5] meer geretourneerd dan verkocht. De over-retour-guard zit in de
 *      blob-mutator en is niet race-vast (Vercel Blob heeft geen
 *      compare-and-swap). Slaat dit aan, dan is er te veel terugbetaald.
 *
 * STIL BIJ NUL: bij een schone run gaat er geen mail — een dagelijkse
 * "alles goed"-mail wordt binnen een week weggeklikt en dan valt de echte
 * melding er ook tussenuit. Wat er wél altijd is: de JSON-respons (handmatig
 * open te klikken door een beheerder) en één regel in de cron-log.
 *
 * Vercel stuurt automatisch `Authorization: Bearer <CRON_SECRET>`; een ingelogde
 * beheerder mag 'm ook handmatig openen.
 */
function secretOk(req: Request): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return header === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

export async function GET(req: Request) {
  const customer = secretOk(req) ? null : await getSessionCustomer();
  if (!secretOk(req) && !customer?.isAdmin) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const v = await verifyPosSales();
    const totaal = totaalAfwijkingen(v);
    const geld = geldAfwijkingen(v);
    /* Ook melden als de blob onleesbaar was: dan draaien [1], [3] en [4] niet en
       zou de bewaking stil half uitstaan — precies de faalmodus die deze cron
       moet uitsluiten. */
    const meldenswaardig = totaal > 0 || v.dubbeleClientRefs > 0 || !v.blob.gelezen;
    /* ?test=1 stuurt de mail ook bij een schone stand. Een melder die alleen bij
       ellende afgaat is anders pas op de dag zelf voor het eerst getest — en dán
       ontdekken dat het adres of Resend niet klopt is te laat. */
    const kanaaltest = new URL(req.url).searchParams.get("test") === "1";

    let gemaild = false;
    let mailReden = "";
    if (meldenswaardig || kanaaltest) {
      const kop = !meldenswaardig
        ? "TEST — kassabon-bewaking, niets aan de hand"
        : geld > 0
          ? `GELD: ${geld} afwijking(en) op de kassabonnen`
          : totaal > 0
            ? `${totaal} afwijking(en) op de kassabonnen`
            : /* Geen enkele afwijking, maar toch een melding: dan draaide de
                 controle zelf niet volledig. Dat hoort in de onderwerpregel te
                 staan, anders leest 'm niemand als "0 afwijkingen". */
              v.blob.gelezen
              ? "gezondheidscheck sloeg aan"
              : "bewaking draaide maar half (blob onleesbaar)";
      // Altijd ook in de log: als de mail niet aankomt (geen ontvanger, Resend
      // eruit) mag de bevinding niet nergens landen.
      console.error(`[verify-possales] ${kop} — [1]=${v.ontbreekt.length} [2]=${gestrandTeller(v).length} [3]=${v.drift.length} [4]=${v.botsingen.length} [5]=${v.overRetour.length} blob=${v.blob.gelezen ? "ok" : v.blob.reden}`);
      const { alertEmails } = await getSettings();
      if (!alertEmails.length) {
        mailReden = "geen ontvanger ingesteld (Instellingen → Meldingen)";
        console.error(`[verify-possales] niet gemaild: ${mailReden}`);
      } else {
        gemaild = await sendOpsAlert(alertEmails, `Kassabonnen — ${kop}`, meldingTekst(v));
        if (!gemaild) mailReden = "Resend niet geconfigureerd of verzenden mislukt";
      }
    }

    return NextResponse.json({
      ok: true,
      schoon: !meldenswaardig,
      gemaild,
      mailReden: mailReden || undefined,
      totaal,
      geld,
      checks: {
        blobNietInNeon: v.ontbreekt.length,
        voorraadZonderBon: gestrandTeller(v).length,
        statusDrift: v.drift.length,
        soortBotsing: v.botsingen.length,
        overRetour: v.overRetour.length,
      },
      bonnenMetMeerdereRetouren: v.bonnenMetMeerdereRetouren,
      dubbeleClientRefs: v.dubbeleClientRefs,
      blob: v.blob,
      neon: v.neon,
      graceMinuten: v.graceMinuten,
    });
  } catch (e) {
    /* Een gevallen verificatie is zélf een bevinding. Alleen een 500 teruggeven
       zou betekenen dat de bewaking maandenlang uit kan staan zonder dat iemand
       het merkt — precies waar deze cron tegen bedoeld is. Dus ook hierover een
       mail, als dat nog lukt: bij een Neon-storing valt getSettings terug op de
       defaults en is er mogelijk geen ontvanger, en dan blijft de log over. */
    const fout = e instanceof Error ? e.message : "cron-fout";
    console.error("[verify-possales] cron-fout:", e);
    try {
      const { alertEmails } = await getSettings();
      if (alertEmails.length) {
        await sendOpsAlert(
          alertEmails,
          "Kassabonnen — bewaking kon NIET draaien",
          `De nachtelijke kassabon-verificatie is gestrand:\n\n${fout}\n\n` +
            "Er is dus vannacht NIET gecontroleerd of de dagstaat bonnen mist of er ergens\n" +
            "te veel geretourneerd is. Handmatig nakijken: npm run verify:possales",
        );
      }
    } catch {
      /* Mail mislukt ook — de log hierboven is dan het enige spoor. Niet nog een
         keer gooien: de oorspronkelijke fout is wat er teruggegeven moet worden. */
    }
    return NextResponse.json({ ok: false, error: fout }, { status: 500 });
  }
}
