import Link from "next/link";
import { Accordion } from "@/components/pdp/accordion";
import { ServiceAsk } from "@/components/service/service-ask";
import { getLocale } from "@/lib/locale-server";
import { t } from "@/lib/messages";

const EMAIL = process.env.CONTACT_EMAIL || "klantenservice@gents.nl";
const WHATSAPP = process.env.WHATSAPP_PHONE_NUMBER || process.env.WHATSAPP_PHONE || "";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 text-ink" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

const FAQ = [
  {
    title: "Bezorging & verzendkosten",
    content:
      "We bezorgen in 1–3 werkdagen, en gratis vanaf € 75. Staat een artikel op voorraad en bestel je vóór 16:00? Dan ligt het vaak de volgende werkdag al bij je op de mat. Je ontvangt een track & trace zodra je pakket onderweg is.",
  },
  {
    title: "Retourneren & ruilen",
    content:
      "Niet helemaal goed? Je retourneert gratis binnen 14 dagen. Stuur het artikel ongedragen en met kaartje terug met het bijgevoegde retourlabel — of ruil 'm direct in één van onze 19 winkels. Zodra we je retour ontvangen, storten we het bedrag binnen enkele werkdagen terug.",
  },
  {
    title: "De juiste maat kiezen",
    content:
      "Twijfel je over je maat? Gebruik ons maatadvies (30 sec.) voor een persoonlijk advies, of kom langs in de winkel — onze stylisten meten je graag op. Zo bestel je in één keer raak en voorkom je retour.",
  },
  {
    title: "Betalen — veilig & vertrouwd",
    content:
      "Je betaalt veilig met o.a. iDEAL. Al je gegevens gaan versleuteld over een beveiligde verbinding. Je betaalt pas bij het afrekenen; achteraf betalen volgt binnenkort.",
  },
  {
    title: "Bestelling wijzigen of annuleren",
    content:
      "Is er iets misgegaan of wil je je bestelling aanpassen? Neem zo snel mogelijk contact op via de assistent hierboven of per e-mail — zolang je pakket nog niet verzonden is, passen we het graag voor je aan.",
  },
  {
    title: "Kwaliteit & garantie",
    content:
      "GENTS staat voor betaalbare kwaliteit. Is er onverhoopt iets mis met je artikel? Laat het ons weten met een foto, dan lossen we het samen op — netjes en zonder gedoe.",
  },
];

export async function KlantenserviceLanding() {
  const locale = await getLocale();
  const contacts = [
    { label: "Vraag de assistent", sub: "Direct antwoord, 24/7", icon: "M8 10h8M8 14h5M21 12a9 9 0 1 1-3.5-7.1L21 3v6h-6", href: "#assistent" },
    { label: "Mail ons", sub: `Reactie binnen 1 werkdag`, icon: "M4 6h16v12H4zM4 7l8 6 8-6", href: `mailto:${EMAIL}` },
    ...(WHATSAPP ? [{ label: "WhatsApp", sub: "Snel een appje", icon: "M21 12a9 9 0 0 1-13.5 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12Z", href: `https://wa.me/${WHATSAPP.replace(/\D/g, "")}` }] : []),
    { label: "Kom langs", sub: "Persoonlijk advies in 19 winkels", icon: "M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", href: "/pages/winkels" },
  ];

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      {/* Hero */}
      <div className="max-w-2xl">
        <p className="label-brand">{t("landing.klantenservice.label", locale)}</p>
        <h1 className="mt-2 text-display-lg">{t("landing.klantenservice.title", locale)}</h1>
        <p className="mt-3 font-sans text-ink-soft">
          Een vraag over je bestelling, maat of retour? Onze mensen — en onze assistent — helpen je graag.
          Persoonlijk, snel en zonder gedoe.
        </p>
      </div>

      {/* Contactopties */}
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {contacts.map((c) => {
          const external = c.href.startsWith("http") || c.href.startsWith("mailto");
          const inner = (
            <>
              <Icon d={c.icon} />
              <span className="mt-3 block font-sans text-sm font-medium text-ink">{c.label}</span>
              <span className="mt-0.5 block font-sans text-xs text-muted">{c.sub}</span>
            </>
          );
          return external ? (
            <a key={c.label} href={c.href} className="rounded-card border border-line p-4 transition-colors hover:border-ink">{inner}</a>
          ) : (
            <Link key={c.label} href={c.href} className="rounded-card border border-line p-4 transition-colors hover:border-ink">{inner}</Link>
          );
        })}
      </div>

      {/* Assistent + FAQ */}
      <div className="mt-12 grid gap-10 lg:grid-cols-[1fr_1fr]">
        <div id="assistent" className="scroll-mt-24">
          <ServiceAsk />
        </div>
        <div>
          <p className="label-brand">{t("landing.klantenservice.faqLabel", locale)}</p>
          <h2 className="mt-2 text-display-md">Misschien staat je antwoord hier</h2>
          <div className="mt-5">
            <Accordion items={FAQ} />
          </div>
        </div>
      </div>

      {/* Persoonlijk in de winkel */}
      <div className="mt-14 flex flex-col items-start justify-between gap-4 rounded-card bg-surface p-8 sm:flex-row sm:items-center">
        <div>
          <p className="font-display text-xl">{t("landing.klantenservice.personalAdvice", locale)}</p>
          <p className="mt-1 font-sans text-sm text-ink-soft">In onze 19 winkels meten en stylen we je van top tot teen.</p>
        </div>
        <Link href="/pages/winkels" className="btn-primary shrink-0">{t("landing.klantenservice.findStore", locale)}</Link>
      </div>
    </div>
  );
}
