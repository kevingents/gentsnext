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

export async function KlantenserviceLanding() {
  const locale = await getLocale();
  const FAQ = [
    {
      title: t("landing.klantenservice.faq.delivery", locale),
      content: t("landing.klantenservice.faq.deliveryBody", locale),
    },
    {
      title: t("landing.klantenservice.faq.returns", locale),
      content: t("landing.klantenservice.faq.returnsBody", locale),
    },
    {
      title: t("landing.klantenservice.faq.sizing", locale),
      content: t("landing.klantenservice.faq.sizingBody", locale),
    },
    {
      title: t("landing.klantenservice.faq.payment", locale),
      content: t("landing.klantenservice.faq.paymentBody", locale),
    },
    {
      title: t("landing.klantenservice.faq.change", locale),
      content: t("landing.klantenservice.faq.changeBody", locale),
    },
    {
      title: t("landing.klantenservice.faq.quality", locale),
      content: t("landing.klantenservice.faq.qualityBody", locale),
    },
  ];
  const contacts = [
    { label: t("landing.klantenservice.contact.assistant", locale), sub: t("landing.klantenservice.contact.assistantSub", locale), icon: "M8 10h8M8 14h5M21 12a9 9 0 1 1-3.5-7.1L21 3v6h-6", href: "#assistent" },
    { label: t("landing.klantenservice.contact.mail", locale), sub: t("landing.klantenservice.contact.mailSub", locale), icon: "M4 6h16v12H4zM4 7l8 6 8-6", href: `mailto:${EMAIL}` },
    ...(WHATSAPP ? [{ label: t("landing.klantenservice.contact.whatsapp", locale), sub: t("landing.klantenservice.contact.whatsappSub", locale), icon: "M21 12a9 9 0 0 1-13.5 7.8L3 21l1.3-4.4A9 9 0 1 1 21 12Z", href: `https://wa.me/${WHATSAPP.replace(/\D/g, "")}` }] : []),
    { label: t("landing.klantenservice.contact.visit", locale), sub: t("landing.klantenservice.contact.visitSub", locale), icon: "M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11ZM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z", href: "/pages/winkels" },
  ];

  return (
    <div className="mx-auto max-w-page px-gutter py-12">
      {/* Hero */}
      <div className="max-w-2xl">
        <p className="label-brand">{t("landing.klantenservice.label", locale)}</p>
        <h1 className="mt-2 text-display-lg">{t("landing.klantenservice.title", locale)}</h1>
        <p className="mt-3 font-sans text-ink-soft">{t("landing.klantenservice.intro", locale)}</p>
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
          <h2 className="mt-2 text-display-md">{t("landing.klantenservice.faqHeading", locale)}</h2>
          <div className="mt-5">
            <Accordion items={FAQ} />
          </div>
        </div>
      </div>

      {/* Persoonlijk in de winkel */}
      <div className="mt-14 flex flex-col items-start justify-between gap-4 rounded-card bg-surface p-8 sm:flex-row sm:items-center">
        <div>
          <p className="font-display text-xl">{t("landing.klantenservice.personalAdvice", locale)}</p>
          <p className="mt-1 font-sans text-sm text-ink-soft">{t("landing.klantenservice.personalAdviceSub", locale)}</p>
        </div>
        <Link href="/pages/winkels" className="btn-primary shrink-0">{t("landing.klantenservice.findStore", locale)}</Link>
      </div>
    </div>
  );
}
