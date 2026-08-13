import { getSiteUrl } from "@/lib/site-url";
import { formatEuro as euro } from "@/lib/format";
import { DEFAULT_LOCALE, localizedPath, type Locale } from "@/lib/i18n";
import { t as tStatic } from "@/lib/messages";
import { getT } from "@/lib/t-server";
import { walletConfigured } from "@/lib/apple-wallet-config";

/**
 * Transactionele mail via Resend (env-gated op RESEND_API_KEY). Bewust zonder
 * extra SDK: directe call naar de Resend API, net als de Mollie-client.
 * Afzender via RESEND_FROM (bv. "GENTS <bestellingen@gents.nl>").
 *
 * Taal: de vertaalrail ligt er (mailT/getT → cron-store → statische dict → NL,
 * plus `locale` naar shell/brandedEmailHtml voor het lang-attribuut en de
 * footer), maar hij is nog niet overal aangesloten. Stand van zaken:
 *
 * WEL in de taal van de klant:
 *  - orderbevestiging (sendOrderConfirmation, orders.locale)
 *  - order-statusmails (lib/order-notify)
 *  - inlog-/magic-link-mail (app/api/account/login)
 *  - welkomstkorting-mail (app/api/welcome-discount)
 *  - afspraakbevestiging (sendAppointmentConfirmation — de route levert de
 *    teksten al vertaald aan)
 *
 * NOG hardgecodeerd Nederlands (ook voor een /en- of /de-klant):
 *  - cadeaubon-mail (sendGiftcardEmail)
 *  - welkomstmail bij een nieuw account (sendWelcomeEmail)
 *  - profiel-afronden-incentive (sendProfileCompletionIncentiveEmail)
 *  - reserveringsbevestiging (sendReserveringEmail)
 *  - nieuwsbrief-bevestiging (sendNewsletterConfirmation)
 *  - conceptbestelling vanaf de kassa (sendConceptOrderMail)
 *  - retour aangemeld (sendReturnRegistered)
 *  - retour verwerkt/terugbetaald (sendReturnRefunded)
 * Buiten dit bestand geldt hetzelfde voor de terug-op-voorraad- en
 * alternatief-mail (lib/stock-notify): die gebruiken brandedEmailHtml zónder
 * `t`/`locale`.
 *
 * Interne notificaties (winkel/HQ) blijven bewust Nederlands.
 */

export function emailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM);
}

/** Vertaal-functie in de vorm die getT(locale) teruggeeft. */
type Tr = (key: string, params?: Record<string, string | number>) => string;

/**
 * Nederlandse vertaler — voor mails die bewust NL blijven (interne notificaties).
 * De NL-brontekst van alle `mail.*`-sleutels staat in lib/messages-catalog, dus
 * in dezelfde bron als de rest van de site: alleen dán ziet de vertaal-cron ze
 * en krijgt een /en- of /de-klant zijn mail in de eigen taal.
 */
const nlT: Tr = (key, params) => tStatic(key, DEFAULT_LOCALE, params);

/**
 * Vertaler voor een klantmail. Leest óók de cron-vertalingen (dezelfde bron als
 * de site) en valt bij een storing terug op Nederlands: een mail mag nooit op
 * i18n stukgaan.
 */
export async function mailT(locale: Locale): Promise<Tr> {
  if (locale === DEFAULT_LOCALE) return nlT;
  try {
    return await getT(locale);
  } catch {
    return nlT;
  }
}

type OrderLine = {
  title: string;
  size: string;
  color: string;
  quantity: number;
  unitPriceCents: number;
  roleLabel: string | null;
};
type OrderInfo = {
  orderNumber: string;
  firstName: string;
  email: string;
  street: string;
  houseNumber: string;
  postalCode: string;
  city: string;
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  discountCents?: number;
  giftcardCents?: number;
};

type CrossSellItem = { handle: string; title: string; imageUrl: string; minPriceCents: number; hasPriceRange?: boolean };

/** Bedenktijd + retourkosten uit Instellingen; zonder waarde valt de mail terug
 *  op de standaard, zodat een tijdelijk onbereikbare instellingen-store nooit
 *  "{amount}" in een klantmail zet. */
export type RetourBelofte = { days: number; amount: string };

/** Haalt de retourbelofte op uit Instellingen; faalt dat, dan de standaard. */
async function retourBelofte(): Promise<RetourBelofte> {
  try {
    const { getSettings } = await import("@/lib/settings");
    const s = await getSettings();
    return { days: s.returnConfig.windowDays, amount: euro(s.returnConfig.dhlReturnCostCents) };
  } catch {
    return { days: 14, amount: euro(499) };
  }
}

function orderHtml(
  order: OrderInfo,
  lines: OrderLine[],
  recs: CrossSellItem[] = [],
  t: Tr = nlT,
  locale: Locale = DEFAULT_LOCALE,
  retour: RetourBelofte = { days: 14, amount: euro(499) },
): string {
  const site = getSiteUrl();
  // Links met locale-prefix: de mail wordt ook geopend zonder onze taal-cookie.
  const url = (path: string) => `${site}${localizedPath(path, locale)}`;
  const points = Math.max(0, Math.floor(order.totalCents / 100)); // 1 punt per euro
  const rows = lines
    .map(
      (l) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">
          ${l.roleLabel ? `<span style="color:#8B8B8B">${l.roleLabel}: </span>` : ""}${l.title}
          <div style="color:#8B8B8B;font-size:12px">${[l.color, l.size && t("mail.line.size", { size: l.size }), `${l.quantity}×`].filter(Boolean).join(" · ")}</div>
        </td>
        <td align="right" style="padding:8px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">${euro(l.unitPriceCents * l.quantity)}</td>
      </tr>`
    )
    .join("");

  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#EDEBE7;padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #E6E4DF">
        ${brandHeaderRow()}
        <tr><td style="padding:24px 28px 8px">
          <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">${order.firstName ? t("mail.order.heading", { name: order.firstName }) : t("mail.order.headingNoName")}</h1>
          <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">
            ${t("mail.order.intro")}
          </p>
          <p style="font:13px Arial,sans-serif;color:#8B8B8B;margin:4px 0">${t("order.order_number")} <strong style="color:#0A0A0A">${order.orderNumber}</strong></p>
        </td></tr>
        <tr><td style="padding:8px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}
            <tr><td style="padding:10px 0 0;font:14px Arial,sans-serif;color:#8B8B8B">${t("cart.subtotal")}</td><td align="right" style="padding:10px 0 0;font:14px Arial,sans-serif;color:#0A0A0A">${euro(order.subtotalCents)}</td></tr>
            ${order.discountCents ? `<tr><td style="padding:4px 0;font:14px Arial,sans-serif;color:#8B8B8B">${t("checkout.discount")}</td><td align="right" style="padding:4px 0;font:14px Arial,sans-serif;color:#0A0A0A">− ${euro(order.discountCents)}</td></tr>` : ""}
            <tr><td style="padding:4px 0;font:14px Arial,sans-serif;color:#8B8B8B">${t("checkout.shipping")}</td><td align="right" style="padding:4px 0;font:14px Arial,sans-serif;color:#0A0A0A">${order.shippingCents === 0 ? t("checkout.free") : euro(order.shippingCents)}</td></tr>
            ${order.giftcardCents ? `<tr><td style="padding:4px 0;font:14px Arial,sans-serif;color:#8B8B8B">${t("checkout.giftcard_label")}</td><td align="right" style="padding:4px 0;font:14px Arial,sans-serif;color:#0A0A0A">− ${euro(order.giftcardCents)}</td></tr>` : ""}
            <tr><td style="padding:8px 0;border-top:1px solid #E6E4DF;font:600 15px Arial,sans-serif;color:#0A0A0A">${order.giftcardCents ? t("mail.order.remaining") : t("checkout.total")}</td><td align="right" style="padding:8px 0;border-top:1px solid #E6E4DF;font:600 15px Arial,sans-serif;color:#0A0A0A">${euro(order.totalCents)}</td></tr>
          </table>
        </td></tr>
        ${
          recs.length
            ? `<tr><td style="padding:20px 28px 4px">
          <p style="font:600 14px Arial,sans-serif;color:#0A0A0A;margin:0 0 12px">${t("order.complete_outfit_label")}</p>
          ${productCardsHtml(
            recs.map((r) => ({
              title: r.title,
              imageUrl: r.imageUrl,
              href: url(`/products/${r.handle}`),
              minPriceCents: r.minPriceCents,
              hasPriceRange: r.hasPriceRange,
            })),
            t,
          )}
        </td></tr>`
            : ""
        }
        ${
          points > 0
            ? `<tr><td style="padding:8px 28px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#F6F5F2;border:1px solid #E6E4DF;padding:16px">
            <div style="font:600 14px Arial,sans-serif;color:#0A0A0A">${t("mail.order.points", { points })}</div>
            <div style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin-top:4px">${t("mail.order.pointsBody", { link: `<a href="${url("/account")}" style="color:#0A0A0A">${t("mail.order.accountLink")}</a>` })}</div>
          </td></tr></table>
        </td></tr>`
            : ""
        }
        <tr><td style="padding:16px 28px 28px">
          <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">
            <strong>${t("checkout.delivery_address")}</strong><br>${order.street} ${order.houseNumber}<br>${order.postalCode} ${order.city}
          </p>
          <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:16px">
            ${t("mail.order.returnNote", { days: retour.days, amount: retour.amount })}
            ${t("mail.order.questions", { link: `<a href="${url("/")}" style="color:#0A0A0A">gents.nl</a>` })}
          </p>
        </td></tr>
      </table>
      <div style="font:11px Arial,sans-serif;color:#8B8B8B;margin-top:16px">GENTS B.V. · Lemelerbergweg 15, 1101 AJ Amsterdam · ${t("mail.footer.pricesInclVat")}</div>
    </td></tr></table>
  </body></html>`;
}

/* ── Cadeaubon ── */

type GiftcardEmail = {
  code: string;
  initialCents: number;
  recipientName: string;
  recipientEmail: string;
  senderName: string;
  message: string;
  expiresAt: Date | null;
};

function giftcardHtml(g: GiftcardEmail): string {
  const site = getSiteUrl();
  const greeting = g.recipientName ? `Hoi ${g.recipientName},` : "Hoi,";
  const fromLine = g.senderName
    ? `<strong style="color:#0A0A0A">${g.senderName}</strong> heeft je een GENTS-cadeaubon gestuurd.`
    : `Je hebt een GENTS-cadeaubon ontvangen.`;
  const expiry = g.expiresAt
    ? new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "long", year: "numeric" }).format(g.expiresAt)
    : null;
  const personal = g.message
    ? `<tr><td style="padding:8px 28px 0">
         <div style="border-left:3px solid #0A0A0A;padding:6px 0 6px 14px;font:italic 14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${g.message}</div>
       </td></tr>`
    : "";

  return `<!doctype html><html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#EDEBE7;padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #E6E4DF">
        ${brandHeaderRow()}
        <tr><td style="padding:24px 28px 8px">
          <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">${greeting}</h1>
          <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:8px 0 0">${fromLine}</p>
        </td></tr>
        ${personal}
        <tr><td style="padding:20px 28px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0A0A0A">
            <tr><td align="center" style="padding:22px 16px;background:#0A0A0A">
              <div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#C9A14A">CADEAUBON</div>
              <div style="font:600 34px Arial,sans-serif;color:#fff;margin:6px 0">${euro(g.initialCents)}</div>
              <div style="font:12px Arial,sans-serif;color:#B9B9B9;margin-bottom:10px">Cadeaubon-code</div>
              <div style="display:inline-block;background:#fff;color:#0A0A0A;font:700 20px 'Courier New',monospace;letter-spacing:2px;padding:10px 18px">${g.code}</div>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:0 28px 8px">
          <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:0">
            <strong>Zo verzilver je 'm:</strong> shop op <a href="${site}" style="color:#0A0A0A">gents.nl</a>, vul bij het afrekenen de code in onder “Cadeaubon”. Het bedrag wordt van je bestelling afgetrokken — je kunt 'm in meerdere keren gebruiken tot het saldo op is.
          </p>
          ${expiry ? `<p style="font:12px Arial,sans-serif;color:#8B8B8B;margin:10px 0 0">Geldig tot ${expiry}.</p>` : ""}
        </td></tr>
        <tr><td style="padding:18px 28px 28px">
          <a href="${site}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Begin met shoppen</a>
        </td></tr>
      </table>
      <div style="font:11px Arial,sans-serif;color:#8B8B8B;margin-top:16px">GENTS B.V. · Lemelerbergweg 15, 1101 AJ Amsterdam · Alle prijzen incl. btw</div>
    </td></tr></table>
  </body></html>`;
}

export async function sendGiftcardEmail(g: GiftcardEmail): Promise<boolean> {
  if (!emailConfigured() || !g.recipientEmail) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [g.recipientEmail],
      subject: g.senderName ? `${g.senderName} stuurt je een GENTS-cadeaubon` : "Je GENTS-cadeaubon",
      html: giftcardHtml(g),
    }),
  });
  if (!res.ok) {
    console.error("[email] giftcard Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/* ── Gedeelde wrapper + generieke verzender (voor lifecycle-mails) ── */

/** Zwarte merk-header met het officiële witte logo (zelfde asset als de
 *  site-footer; de slogan zit al ín het logo — niets aan toevoegen). */
function brandHeaderRow(): string {
  const site = getSiteUrl();
  return `<tr><td style="padding:0">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#111111">
      <tr><td align="center" style="padding:26px 28px">
        <img src="${site}/brand/brand-logo-wit.png" width="150" alt="GENTS — Suits You"
          style="display:block;width:150px;max-width:60%;height:auto;margin:0 auto" />
      </td></tr>
    </table>
  </td></tr>`;
}

/** Gebrande footer binnen de kaart: snelkoppelingen + tagline.
 *  De links krijgen het locale-prefix mee (/en/…): een mail wordt ook geopend
 *  op een apparaat zonder onze taal-cookie, en dan zou de klant alsnog op de
 *  Nederlandse pagina belanden. */
/**
 * Spaarpas-regel onder elke gebrande KLANTMAIL. Bewust in de gedeelde footer en
 * niet per mailsoort: dan staat 'ie automatisch onder alles wat de klant krijgt,
 * en is er één plek om 'm weer weg te halen.
 *
 * De link gaat naar /account en NIET rechtstreeks naar /api/wallet/apple: die
 * route eist een ingelogde sessie, dus vanuit de mail zou 'm dat een 401 opleveren
 * in plaats van een pas. Via het account loopt de klant door de magic-link heen en
 * staat de knop er gewoon.
 *
 * `?bron=mail` is het meetpunt: zo is te zien hoeveel passen uit de mail komen.
 * Env-gated — zonder pass-certificaat bieden we niets aan wat 503 geeft.
 */
function walletFooterBlock(t: Tr = nlT, locale: Locale = DEFAULT_LOCALE): string {
  if (!walletConfigured()) return "";
  const href = `${getSiteUrl()}${localizedPath("/account", locale)}?tab=punten&bron=mail`;
  return `<div style="border-top:1px solid #F0EEEA;margin-top:14px;padding-top:14px">
      <div style="font:12px Arial,sans-serif;color:#2C2C2C;line-height:1.5">${t("mail.footer.wallet")}</div>
      <a href="${attrUrl(href)}" style="display:inline-block;margin-top:8px;border:1px solid #111111;color:#111111;font:12px Arial,sans-serif;padding:8px 16px;text-decoration:none;letter-spacing:.3px">${t("mail.footer.walletLink")}</a>
    </div>`;
}

function brandFooterRow(t: Tr = nlT, locale: Locale = DEFAULT_LOCALE): string {
  const site = getSiteUrl();
  const link = (href: string, label: string) =>
    `<a href="${site}${localizedPath(href, locale)}" style="color:#111111;text-decoration:none;font:12px Arial,sans-serif">${label}</a>`;
  return `<tr><td style="padding:8px 28px 26px">
    <div style="border-top:1px solid #E6E4DF;padding-top:18px">
      <div style="font:12px Arial,sans-serif;color:#111111">
        ${link("/account", t("common.account"))} &nbsp;·&nbsp; ${link("/pages/winkels", t("nav.stores"))} &nbsp;·&nbsp; ${link("/retourneren", t("retourneren.title"))} &nbsp;·&nbsp; ${link("/pages/klantenservice", t("help.link.service"))}
      </div>
      ${walletFooterBlock(t, locale)}
      <div style="font:11px Arial,sans-serif;color:#B2AEA8;margin-top:12px">${t("mail.footer.usps")}</div>
    </div>
  </td></tr>`;
}

/** Mail-huisstijl. `locale`/`t` bepalen de taal van de vaste onderdelen én het
 *  lang-attribuut; zonder argumenten blijft alles Nederlands (interne mails). */
function shell(inner: string, locale: Locale = DEFAULT_LOCALE, t: Tr = nlT): string {
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#EDEBE7;padding:24px 12px">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid #E6E4DF">
        ${brandHeaderRow()}
        ${inner}
        ${brandFooterRow(t, locale)}
      </table>
      <div style="font:11px Arial,sans-serif;color:#9a958d;margin-top:14px">GENTS B.V. · Lemelerbergweg 15, 1101 AJ Amsterdam</div>
    </td></tr></table>
  </body></html>`;
}

/**
 * Gebrande e-mail (voor losse mails buiten de lifecycle-set, bv. de inlog-link).
 * `bodyHtml` is vrije HTML in de contentzone; optionele knop + voetnoot.
 * De aanroeper levert de teksten al vertaald aan (zoals de afspraak-mail) en
 * geeft dan `locale` + `t` mee, zodat lang-attribuut en footer meelopen.
 */
export function brandedEmailHtml(opts: {
  heading: string;
  bodyHtml: string;
  cta?: { label: string; href: string };
  footnote?: string;
  locale?: Locale;
  t?: Tr;
}): string {
  const inner = `
    <tr><td style="padding:26px 28px 6px">
      <h1 style="font:400 22px Arial,sans-serif;color:#111111;margin:0">${opts.heading}</h1>
    </td></tr>
    <tr><td style="padding:6px 28px;font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.65">${opts.bodyHtml}</td></tr>
    ${opts.cta ? `<tr><td style="padding:14px 28px 6px">
      <a href="${attrUrl(opts.cta.href)}" style="display:inline-block;background:#111111;color:#ffffff;font:14px Arial,sans-serif;padding:13px 26px;text-decoration:none;letter-spacing:.5px">${opts.cta.label}</a>
    </td></tr>` : ""}
    ${opts.footnote ? `<tr><td style="padding:10px 28px 6px;font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.5">${opts.footnote}</td></tr>` : ""}
  `;
  return shell(inner, opts.locale ?? DEFAULT_LOCALE, opts.t ?? nlT);
}

/**
 * URL veilig in een HTML-attribuut. Vooral de `&` telt: een getrackte link met
 * meerdere query-parameters is in HTML pas correct als die `&amp;` is, anders
 * mag een parser hem als entiteit lezen (&copy, &reg, …) en breekt de link.
 */
function attrUrl(url: string): string {
  return String(url || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Tekst uit de database of van de klant in HTML. Producttitels komen uit de
 * SRS-/Shopify-import en de voornaam typt de klant zelf; vandaag staat er niets
 * bijzonders in, maar één her-import met "Overhemd S&P" of een naam met een
 * punthaak breekt anders de mail-opmaak.
 */
function escHtml(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Eén productkaartje in een mail: foto, titel, prijs — de hele kaart is de link. */
export type MailProductCard = {
  title: string;
  imageUrl: string;
  /** Volledige URL; de aanroeper bepaalt of daar tracking op zit. */
  href: string;
  minPriceCents: number;
  hasPriceRange?: boolean;
};

/**
 * Rij productkaartjes voor in een mail. Gedeeld door de orderbevestiging
 * ("maak de look compleet") en de annuleringsmail ("dit hebben we wél"), zodat
 * beide er hetzelfde uitzien en er maar één plek is die e-mail-HTML kent —
 * tabellen en inline styles, want Outlook doet niet aan flexbox.
 */
export function productCardsHtml(items: MailProductCard[], t: Tr = nlT): string {
  if (!items.length) return "";
  const width = Math.floor(100 / items.length);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            ${items
              .map(
                (r) => `<td width="${width}%" valign="top" style="padding:0 5px">
              <a href="${attrUrl(r.href)}" style="text-decoration:none;color:#0A0A0A">
                ${r.imageUrl ? `<img src="${attrUrl(r.imageUrl)}" width="100%" alt="" style="display:block;border:1px solid #E6E4DF;background:#F6F5F2"/>` : ""}
                <div style="font:12px Arial,sans-serif;color:#0A0A0A;margin-top:6px;line-height:1.3">${escHtml(r.title)}</div>
                <div style="font:12px Arial,sans-serif;color:#8B8B8B">${r.hasPriceRange ? `${t("product.from")} ` : ""}${euro(r.minPriceCents)}</div>
              </a>
            </td>`,
              )
              .join("")}
          </tr></table>`;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (!emailConfigured() || !to) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    console.error("[email] Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/** Welkomstmail bij de eerste account-bevestiging (one-shot, zie account.ts). */
export async function sendWelcomeEmail(email: string, firstName: string): Promise<boolean> {
  const site = getSiteUrl();
  const hi = firstName ? `Welkom, ${firstName}` : "Welkom bij GENTS";
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">${hi}</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">
        Goed dat je er bent. Je account staat klaar — je bestellingen, bewaarde maten en favorieten vind je voortaan op één plek.
      </p>
    </td></tr>
    <tr><td style="padding:4px 28px">
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:0"><strong>Handig om te weten</strong></p>
      <ul style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:6px 0 0;padding-left:18px">
        <li>Bewaar je maten en we vullen ze automatisch in — <a href="${site}/maatadvies" style="color:#0A0A0A">doe het maatadvies</a>.</li>
        <li>14 dagen retourrecht — gratis met een GENTS-tegoed of in één van onze winkels.</li>
        <li>Persoonlijk advies in 19 winkels door heel Nederland.</li>
      </ul>
    </td></tr>
    <tr><td style="padding:20px 28px 28px">
      <a href="${site}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Begin met shoppen</a>
    </td></tr>`;
  return sendEmail(email, "Welkom bij GENTS", shell(inner));
}

/** "Rond je profiel af voor +50 punten" — incentive-mail met afrond-link. */
export async function sendProfileCompletionIncentiveEmail(email: string, firstName: string, token: string): Promise<boolean> {
  const site = getSiteUrl();
  const url = `${site}/profiel-afronden?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`;
  const hi = firstName ? `Hoi ${firstName},` : "Hoi,";
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Rond je profiel af — 50 punten cadeau</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} maak je GENTS-profiel even compleet (je maten + voorkeuren). We zetten dan <strong>50 spaarpunten</strong> op je voucherkaart, en je krijgt voortaan advies en aanbiedingen die echt bij je passen.</p>
    </td></tr>
    <tr><td style="padding:18px 28px 28px">
      <a href="${url}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 24px;text-decoration:none">Profiel afronden (+50 punten)</a>
      <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:14px">Duurt een halve minuut; de punten staan er meteen op.</p>
    </td></tr>`;
  return sendEmail(email, "Rond je GENTS-profiel af — 50 punten cadeau", shell(inner));
}

/** Reservering-bevestiging: "we houden 'm 7 dagen voor je vast" + afreken-link
 *  (online afrekenen → onbeperkt vasthouden). */
export async function sendReserveringEmail(input: {
  to: string; name?: string; store: string; validUntil?: Date | string | null;
  lines: { title?: string; sku?: string; size?: string; color?: string; qty?: number }[]; payToken?: string;
}): Promise<boolean> {
  // Naam escapen: sinds reserveer-om-te-passen is dit veld publiek beïnvloedbaar
  // (HTML-injectie in een gebrande mail = phishing-kanaal).
  const hi = input.name ? `Hoi ${String(input.name).replace(/</g, "&lt;")},` : "Hoi,";
  const tot = input.validUntil ? new Date(input.validUntil).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" }) : "";
  const itemsHtml = (input.lines || []).map((l) => `
    <tr><td style="padding:10px 0;border-bottom:1px solid #EAEAEA">
      <div style="font:700 14px Arial,sans-serif;color:#0A0A0A">${(l.title || l.sku || "Artikel").replace(/</g, "&lt;")}</div>
      <div style="font:12px Arial,sans-serif;color:#6B6B6B;margin-top:2px">${[l.color, l.size && `maat ${l.size}`, l.qty ? `${l.qty}×` : ""].filter(Boolean).join(" · ")}</div>
    </td></tr>`).join("");
  const payUrl = input.payToken ? `${getSiteUrl()}/reservering-afrekenen?token=${encodeURIComponent(input.payToken)}` : "";
  const cta = payUrl ? `
    <tr><td style="padding:6px 28px 28px">
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0 0 12px">Wil je 'm langer vasthouden? Reken je reservering online af — dan houden we 'm <strong>onbeperkt</strong> voor je vast tot je 'm ophaalt.</p>
      <a href="${payUrl}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 24px;text-decoration:none">Online afrekenen</a>
    </td></tr>` : "";
  const inner = `
    <tr><td style="padding:24px 28px 4px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">We houden 'm voor je apart</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} je reservering staat klaar in <strong>${input.store.replace(/</g, "&lt;")}</strong>${tot ? ` — we houden 'm tot en met <strong>${tot}</strong> voor je vast` : ""}.</p>
    </td></tr>
    <tr><td style="padding:8px 28px 8px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemsHtml}</table>
    </td></tr>
    ${cta}`;
  return sendEmail(input.to, `We houden je reservering vast in ${input.store}`, shell(inner));
}

/** Winkel-notificatie: klant reserveerde via de site om te passen (intern → NL).
 *  Klant als reply-to zodat de winkel direct kan reageren. */
export async function sendReservationStoreNotify(n: {
  to: string; store: string; customerName: string; customerEmail: string; customerPhone: string;
  title: string; size: string; color: string; validUntil: Date | string | null;
}): Promise<boolean> {
  if (!emailConfigured() || !n.to) return false;
  const tot = n.validUntil ? new Date(n.validUntil).toLocaleDateString("nl-NL", { day: "numeric", month: "long" }) : "";
  const lines = [
    `Nieuwe pas-reservering via gents.nl voor ${n.store}:`,
    "",
    `Artikel: ${n.title}`,
    [n.color, n.size && `maat ${n.size}`].filter(Boolean).join(" · "),
    "",
    `Klant: ${n.customerName}`,
    `E-mail: ${n.customerEmail}`,
    n.customerPhone ? `Telefoon: ${n.customerPhone}` : "",
    "",
    `Leg het artikel apart — de voorraad is al vastgehouden${tot ? ` t/m ${tot}` : ""}.`,
    "De reservering staat ook in het kassa-reserveringenoverzicht.",
  ].filter(Boolean);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [n.to],
      reply_to: n.customerEmail || undefined,
      subject: `Pas-reservering — ${n.title}${n.size ? ` (maat ${n.size})` : ""}`,
      text: lines.join("\n"),
    }),
  });
  if (!res.ok) {
    console.error("[email] pas-reservering winkelnotificatie Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/** Double-opt-in: bevestigingsmail voor de nieuwsbrief. */
export async function sendNewsletterConfirmation(email: string, confirmUrl: string): Promise<boolean> {
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Bevestig je inschrijving</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">
        Nog één klik en je ontvangt als eerste onze nieuwe collecties, styling-tips en exclusieve aanbiedingen.
      </p>
    </td></tr>
    <tr><td style="padding:12px 28px 28px">
      <a href="${confirmUrl}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Ja, schrijf me in</a>
      <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:16px">
        Heb je je niet aangemeld? Negeer deze mail — er gebeurt niets.
      </p>
    </td></tr>`;
  return sendEmail(email, "Bevestig je GENTS-nieuwsbrief", shell(inner));
}

/** Orderbevestiging in de taal waarin de klant besteld heeft (orders.locale). */
export async function sendOrderConfirmation(
  order: OrderInfo,
  lines: OrderLine[],
  recs: CrossSellItem[] = [],
  locale: Locale = DEFAULT_LOCALE,
): Promise<boolean> {
  if (!emailConfigured()) return false;
  const t = await mailT(locale);
  // Bedenktijd + retourkosten uit Instellingen, niet uit de tekst zelf: past
  // Kevin het bedrag aan, dan klopt de bevestigingsmail meteen mee.
  const retour = await retourBelofte();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [order.email],
      subject: t("mail.order.subject", { orderNumber: order.orderNumber }),
      html: orderHtml(order, lines, recs, t, locale, retour),
    }),
  });
  if (!res.ok) {
    console.error("[email] Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/* ── Conceptbestelling (kassa: "denk er nog over na") ── */

type ConceptOrderEmail = {
  email: string;
  firstName: string;
  orderNumber: string;
  checkoutUrl: string;
  store: string;
  items: { title: string; size: string; color: string; qty: number; unitPriceCents: number }[];
};

/** Concept van de kassa: de klant twijfelt nog → krijgt z'n selectie gemaild met
 *  een afrond-link. Rondt 'ie af, dan gaat de omzet naar de winkel. */
export async function sendConceptOrderMail(c: ConceptOrderEmail): Promise<boolean> {
  const hi = c.firstName ? `Hoi ${c.firstName},` : "Hoi,";
  const rows = c.items
    .map(
      (l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">
        ${l.title}<div style="color:#8B8B8B;font-size:12px">${[l.color, l.size && `maat ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}</div></td>
        <td align="right" style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">${euro(l.unitPriceCents * l.qty)}</td></tr>`,
    )
    .join("");
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je selectie staat klaar</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} je was bij <strong>${c.store}</strong> en wilde er nog even over nadenken — geen probleem. Hieronder je selectie. Rond 'm af wanneer je wilt; we leggen 'm dan voor je klaar of bezorgen 'm.</p>
    </td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table></td></tr>
    <tr><td style="padding:18px 28px 28px">
      <a href="${c.checkoutUrl}" style="display:inline-block;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 24px;text-decoration:none">Bestelling afronden</a>
      <p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin-top:14px">De link blijft geldig — geen haast. Vragen? Antwoord gerust op deze mail.</p>
    </td></tr>`;
  return sendEmail(c.email, `Je GENTS-selectie van ${c.store} — rond af wanneer je wilt`, shell(inner));
}

/* ── Retouren ── */

type ReturnRegisteredEmail = {
  email: string;
  firstName: string;
  orderNumber: string;
  method: "dhl" | "store";
  refundType: "money" | "credit";
  items: { title: string; size: string; color: string; qty: number }[];
  labelUrl: string;
  tracking: string;
  itemsCents: number;
  shippingCostCents: number;
  pickupStore: string;
};

/** Bevestiging dat de retour is aangemeld — met DHL-label of winkel-instructie. */
export async function sendReturnRegistered(r: ReturnRegisteredEmail): Promise<boolean> {
  const site = getSiteUrl();
  const hi = r.firstName ? `Hoi ${r.firstName},` : "Hoi,";
  const itemRows = r.items
    .map(
      (l) => `<tr><td style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">
        ${l.title}<div style="color:#8B8B8B;font-size:12px">${[l.color, l.size && `maat ${l.size}`, `${l.qty}×`].filter(Boolean).join(" · ")}</div></td></tr>`,
    )
    .join("");
  const deliveryBlock =
    r.method === "dhl"
      ? r.labelUrl
        ? `<tr><td style="padding:8px 28px 0">
             <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">Print je <strong>DHL-retourlabel</strong>, plak het op het pakket en lever het in bij een DHL-punt.</p>
             <a href="${r.labelUrl}" style="display:inline-block;margin-top:12px;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Download retourlabel</a>
             ${r.tracking ? `<p style="font:12px Arial,sans-serif;color:#8B8B8B;margin:10px 0 0">Track &amp; trace: ${r.tracking}</p>` : ""}
           </td></tr>`
        : `<tr><td style="padding:8px 28px 0"><p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">We sturen je het <strong>DHL-retourlabel</strong> zo snel mogelijk per e-mail toe.</p></td></tr>`
      : `<tr><td style="padding:8px 28px 0"><p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">Lever de artikelen samen met je bestelnummer in bij <strong>${r.pickupStore || "een van onze GENTS-winkels"}</strong>. Inleveren is gratis.</p></td></tr>`;
  const refundLine =
    r.refundType === "credit"
      ? `Je ontvangt <strong>GENTS-tegoed</strong> van ${euro(r.itemsCents)} zodra we de artikelen hebben ontvangen en gecontroleerd.`
      : `Je krijgt ${euro(Math.max(0, r.itemsCents - r.shippingCostCents))} terug op je betaalmethode zodra we de artikelen hebben ontvangen${r.shippingCostCents ? ` (na aftrek van ${euro(r.shippingCostCents)} retourkosten)` : ""}.`;
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je retour is aangemeld</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} we hebben je retour voor bestelling <strong>${r.orderNumber}</strong> ontvangen.</p>
    </td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table></td></tr>
    ${deliveryBlock}
    <tr><td style="padding:16px 28px 8px"><p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">${refundLine}</p></td></tr>
    <tr><td style="padding:8px 28px 28px"><p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin:0">Volg de status van je retour in <a href="${site}/account" style="color:#0A0A0A">Mijn GENTS</a>.</p></td></tr>`;
  return sendEmail(r.email, `Je GENTS-retour voor ${r.orderNumber} is aangemeld`, shell(inner));
}

type ReturnRefundedEmail = {
  email: string;
  firstName: string;
  orderNumber: string;
  refundType: "money" | "credit";
  amountCents: number;
  creditCode: string;
};

/** Retour verwerkt: geld teruggestort, of tegoed-code uitgegeven. */
export async function sendReturnRefunded(r: ReturnRefundedEmail): Promise<boolean> {
  const site = getSiteUrl();
  const hi = r.firstName ? `Hoi ${r.firstName},` : "Hoi,";
  if (r.refundType === "credit") {
    const inner = `
      <tr><td style="padding:24px 28px 8px">
        <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je GENTS-tegoed staat klaar</h1>
        <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} we hebben je retour voor bestelling <strong>${r.orderNumber}</strong> verwerkt. Hieronder je tegoed.</p>
      </td></tr>
      <tr><td style="padding:8px 28px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0A0A0A">
          <tr><td align="center" style="padding:22px 16px;background:#0A0A0A">
            <div style="font:11px Arial,sans-serif;letter-spacing:3px;color:#C9A14A">GENTS-TEGOED</div>
            <div style="font:600 34px Arial,sans-serif;color:#fff;margin:6px 0">${euro(r.amountCents)}</div>
            <div style="display:inline-block;background:#fff;color:#0A0A0A;font:700 20px 'Courier New',monospace;letter-spacing:2px;padding:10px 18px">${r.creditCode}</div>
          </td></tr>
        </table>
      </td></tr>
      <tr><td style="padding:12px 28px 28px">
        <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.7;margin:0">Vul de code bij het afrekenen in onder “Cadeaubon”. Je kunt 'm in meerdere keren gebruiken tot het saldo op is.</p>
        <a href="${site}" style="display:inline-block;margin-top:14px;background:#0A0A0A;color:#fff;font:14px Arial,sans-serif;padding:12px 22px;text-decoration:none">Kies iets nieuws</a>
      </td></tr>`;
    return sendEmail(r.email, "Je GENTS-tegoed staat klaar", shell(inner));
  }
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">Je retour is terugbetaald</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${hi} we hebben <strong>${euro(r.amountCents)}</strong> teruggestort op je betaalmethode voor je retour van bestelling <strong>${r.orderNumber}</strong>. Afhankelijk van je bank zie je het binnen enkele werkdagen terug.</p>
    </td></tr>
    <tr><td style="padding:8px 28px 28px"><p style="font:12px Arial,sans-serif;color:#8B8B8B;line-height:1.6;margin:0">Bekijk je retouren in <a href="${site}/account" style="color:#0A0A0A">Mijn GENTS</a>.</p></td></tr>`;
  return sendEmail(r.email, `Je GENTS-retour voor ${r.orderNumber} is terugbetaald`, shell(inner));
}

/* ── Niet leverbaar: annulering + terugbetaling ── */

export type UnfulfillableRefundEmail = {
  email: string;
  firstName: string;
  orderNumber: string;
  /** Titels van de artikelen die vervallen (zoals ze op de order staan). */
  cancelledTitles: string[];
  /** 0 = er is (nog) niets teruggestort; dan noemt de mail geen bedrag. */
  refundedCents: number;
  /** Een deel was al verzonden en komt met een gratis retourlabel terug. */
  partialReturn: boolean;
  /** 2-3 vergelijkbare artikelen die NU wél leverbaar zijn; leeg = blok weglaten. */
  alternatives: MailProductCard[];
  orderUrl: string;
  locale?: Locale;
  t?: Tr;
};

/**
 * De mail die de klant krijgt als zijn artikel niet meer leverbaar blijkt.
 *
 * Dit was tot nu toe een stille terugbetaling: geld terug, geen bericht. Twee
 * dingen maken het verschil voor de klant: (1) uitleggen dát we alles hebben
 * nagekeken — dat is bij een annulering altijd al gebeurd — en (2) meteen laten
 * zien wat we wél in zijn maat hebben, zodat hij niet zelf hoeft te gaan zoeken.
 */
export async function sendUnfulfillableRefund(m: UnfulfillableRefundEmail): Promise<boolean> {
  const t = m.t ?? nlT;
  const locale = m.locale ?? DEFAULT_LOCALE;
  // Escapen vóór de vertaling: interpolate() plakt de waarde rauw in de tekst.
  const name = escHtml(m.firstName) || t("mail.greeting.fallbackName");
  const titles = (m.cancelledTitles || []).filter(Boolean);

  const itemsHtml = titles.length
    ? `<ul style="margin:10px 0 0;padding-left:18px;color:#0A0A0A">${titles
        .map((title) => `<li style="margin:2px 0">${escHtml(title)}</li>`)
        .join("")}</ul>`
    : "";

  const altHtml = m.alternatives.length
    ? `<div style="margin-top:22px;border-top:1px solid #E6E4DF;padding-top:18px">
         <p style="font:600 14px Arial,sans-serif;color:#0A0A0A;margin:0 0 4px">${t("mail.unfulfillable.altHeading")}</p>
         <p style="margin:0 0 12px;font:13px Arial,sans-serif;color:#8B8B8B">${t("mail.unfulfillable.altIntro")}</p>
         ${productCardsHtml(m.alternatives, t)}
       </div>`
    : "";

  const bodyHtml = `
    <p style="margin:0">${t("mail.unfulfillable.intro", { name, orderNumber: m.orderNumber })}</p>
    ${itemsHtml}
    <p style="margin:14px 0 0">${t("mail.unfulfillable.checked")}</p>
    <p style="margin:14px 0 0">${
      m.refundedCents > 0
        ? t("mail.unfulfillable.refunded", { amount: euro(m.refundedCents) })
        : t("mail.unfulfillable.refundPending")
    }</p>
    ${m.partialReturn ? `<p style="margin:14px 0 0">${t("mail.unfulfillable.returnNote")}</p>` : ""}
    ${altHtml}`;

  return sendEmail(
    m.email,
    t("mail.unfulfillable.subject", { orderNumber: m.orderNumber }),
    brandedEmailHtml({
      heading: t("mail.unfulfillable.heading"),
      bodyHtml,
      cta: { label: t("mail.unfulfillable.cta"), href: m.orderUrl },
      footnote: t("mail.unfulfillable.help"),
      locale,
      t,
    }),
  );
}

/* ── Klantafspraken (/afspraak) ── */

const esc = (s: string) => String(s || "").replace(/</g, "&lt;");

type AppointmentEmail = {
  to: string;
  /** Vertaalde teksten (getT(locale) in de route) — de mail volgt de taal van de aanvraag. */
  subject: string;
  heading: string;
  body: string;
  rows: { label: string; value: string }[];
  outro: string;
};

/** Bevestiging van een afspraakaanvraag naar de klant — huisstijl-shell, teksten
 *  komen vertaald binnen zodat een /en- of /de-klant de mail in zijn taal krijgt. */
export async function sendAppointmentConfirmation(a: AppointmentEmail): Promise<boolean> {
  const detailRows = a.rows
    .map(
      (r) => `<tr>
        <td style="padding:6px 12px 6px 0;border-bottom:1px solid #E6E4DF;font:13px Arial,sans-serif;color:#8B8B8B;white-space:nowrap">${esc(r.label)}</td>
        <td style="padding:6px 0;border-bottom:1px solid #E6E4DF;font:14px Arial,sans-serif;color:#0A0A0A">${esc(r.value)}</td>
      </tr>`,
    )
    .join("");
  const inner = `
    <tr><td style="padding:24px 28px 8px">
      <h1 style="font:400 22px Arial,sans-serif;color:#0A0A0A;margin:0">${esc(a.heading)}</h1>
      <p style="font:14px Arial,sans-serif;color:#2C2C2C;line-height:1.6">${esc(a.body)}</p>
    </td></tr>
    <tr><td style="padding:8px 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table></td></tr>
    <tr><td style="padding:16px 28px 28px">
      <p style="font:13px Arial,sans-serif;color:#2C2C2C;line-height:1.6;margin:0">${esc(a.outro)}</p>
    </td></tr>`;
  return sendEmail(a.to, a.subject, shell(inner));
}

type AppointmentStoreNotify = {
  to: string;
  store: string;
  typeLabel: string;
  preferredDate: string;
  dagdeel: string;
  name: string;
  phone: string;
  wensen: string;
  customerEmail: string;
};

/** Notificatie naar de winkel: nieuwe afspraakaanvraag (intern → NL). De klant
 *  staat als reply-to zodat de winkel direct kan reageren om het tijdstip af te stemmen. */
export async function sendAppointmentStoreNotify(n: AppointmentStoreNotify): Promise<boolean> {
  if (!emailConfigured() || !n.to) return false;
  const lines = [
    `Type: ${n.typeLabel}`,
    `Winkel: ${n.store}`,
    `Gewenste datum: ${n.preferredDate}`,
    `Dagdeel: ${n.dagdeel}`,
    `Naam: ${n.name}`,
    n.phone ? `Telefoon: ${n.phone}` : "",
    n.wensen ? `Wensen: ${n.wensen}` : "",
    "",
    "Neem contact op met de klant om het exacte tijdstip te bevestigen.",
  ].filter(Boolean);
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM,
      to: [n.to],
      reply_to: n.customerEmail,
      subject: `Nieuwe afspraakaanvraag — ${n.typeLabel} — ${n.preferredDate}`,
      text: lines.join("\n"),
    }),
  });
  if (!res.ok) {
    console.error("[email] afspraak-winkelnotificatie Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}

/**
 * Interne signaalmail (bewaking, storingen) — platte tekst, geen huisstijl-shell
 * en geen klant in de cc. Bedoeld voor meldingen die iemand 's ochtends moet
 * kunnen scannen, niet voor iets dat een klant ooit ziet.
 *
 * Ontvangers komen uit de instellingen (settings.alertEmails), niet uit env:
 * wie de bewaking krijgt is een knop in de tool, geen deploy.
 */
export async function sendOpsAlert(to: string[], subject: string, text: string): Promise<boolean> {
  const ontvangers = (to || []).map((a) => String(a || "").trim()).filter(Boolean);
  if (!emailConfigured() || !ontvangers.length) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: process.env.RESEND_FROM, to: ontvangers, subject, text }),
  });
  if (!res.ok) {
    console.error("[email] ops-melding Resend-fout:", res.status, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}
