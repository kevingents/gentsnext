import Image from "next/image";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { ContactRequestForm } from "@/components/contact-request-form";
import type { ProductCardData } from "@/lib/catalog";
import { VISUAL } from "@/lib/visuals";

const USPS = [
  { title: "Direct uit voorraad leverbaar", body: "Voor veel aanvragen kunnen we direct schakelen dankzij sterke basis- en NOS-collecties." },
  { title: "19 winkels voor passen & service", body: "Altijd een vestiging in de buurt voor passen, advies en vermaak." },
  { title: "Borduring of bedrukking mogelijk", body: "Wil je een herkenbare teamuitstraling? Logo's of namen worden netjes verwerkt." },
  { title: "Eén duidelijk aanspreekpunt", body: "Geen omslachtige trajecten — je krijgt één contactpersoon voor je aanvraag." },
];

const SECTORS = [
  { name: "Horeca & hospitality", body: "Bediening, receptie, hosts en front-office — verzorgd, comfortabel en weerbaar." },
  { name: "Retail & detailhandel", body: "Verkoopmedewerkers en winkelpersoneel met een uniforme stijl." },
  { name: "Kantoor & professionele dienstverlening", body: "Smart-casual tot business-formeel voor dagelijkse zakelijke contexten." },
  { name: "Events & promotieteams", body: "Snel inzetbare outfits voor beurzen, evenementen en activaties." },
];

type Props = {
  businessSuits: ProductCardData[];
  businessShirts: ProductCardData[];
};

export function ZakelijkLanding({ businessSuits, businessShirts }: Props) {
  return (
    <article>
      {/* Hero */}
      <section className="relative h-[58vh] min-h-[420px] w-full overflow-hidden bg-ink">
        <Image
          src={VISUAL.zakelijk}
          alt="GENTS Zakelijk"
          fill
          priority
          sizes="100vw"
          className="object-cover opacity-85"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/80 via-ink/20 to-transparent" />
        <div className="absolute inset-0 mx-auto flex max-w-page flex-col items-start justify-end px-gutter pb-14">
          <p className="label-brand !text-canvas/80">GENTS Zakelijk</p>
          <h1 className="mt-3 max-w-3xl text-display-xl font-light text-canvas">
            Zakelijke kleding die snel leverbaar, representatief en praktisch geregeld is
          </h1>
          <p className="mt-4 max-w-xl font-sans text-base text-canvas/85">
            Voor bedrijven in horeca, hospitality, retail, events en kantooromgevingen.
            Van een nette dagelijkse uitstraling tot kleding voor grotere teams.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="#contact-zakelijk" className="btn-primary !bg-canvas !text-ink hover:!bg-surface">
              Vraag informatie aan
            </Link>
            <a
              href="tel:0851155042"
              className="btn-ghost !border-canvas !text-canvas hover:!bg-canvas hover:!text-ink"
            >
              Bel 085 115 50 42
            </a>
          </div>
        </div>
      </section>

      {/* USPs */}
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-page gap-6 px-gutter py-10 sm:grid-cols-2 lg:grid-cols-4">
          {USPS.map((u) => (
            <div key={u.title} className="border-l border-line pl-4">
              <h2 className="font-display text-lg font-light">{u.title}</h2>
              <p className="mt-1.5 font-sans text-sm text-ink-soft">{u.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Voor wie */}
      <section className="mx-auto max-w-page px-gutter py-14">
        <p className="label-brand">Voor wie</p>
        <h2 className="mt-2 text-display-md">Zakelijke kleding voor teams die representatief voor de dag willen komen</h2>
        <p className="mt-3 max-w-2xl font-sans text-ink-soft">
          Of het nu gaat om dagelijkse bedrijfskleding, nette outfits voor ontvangst
          en service, of een snelle oplossing voor een evenement — wij helpen je aan
          kleding die representatief oogt en prettig werkt in de praktijk.
        </p>
        <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {SECTORS.map((s) => (
            <div key={s.name} className="border border-line p-5">
              <h3 className="font-display text-lg font-light">{s.name}</h3>
              <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Business pakken */}
      {businessSuits.length > 0 ? (
        <section className="mx-auto max-w-page px-gutter py-14">
          <header className="mb-8 flex items-end justify-between">
            <div>
              <p className="label-brand">Snel schakelen</p>
              <h2 className="mt-2 text-display-md">Business pakken & overhemden</h2>
            </div>
            <Link href="/collections/mix-match-pakken" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
              Alle business pakken
            </Link>
          </header>
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
            {businessSuits.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      ) : null}

      {businessShirts.length > 0 ? (
        <section className="bg-surface">
          <div className="mx-auto max-w-page px-gutter py-14">
            <header className="mb-8 flex items-end justify-between">
              <div>
                <p className="label-brand">De basis</p>
                <h2 className="mt-2 text-display-md">Business overhemden</h2>
              </div>
              <Link href="/collections/business-overhemden" className="hidden font-sans text-sm text-ink underline underline-offset-4 sm:inline">
                Alle business overhemden
              </Link>
            </header>
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
              {businessShirts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* Contact + samenvatting */}
      <section className="mx-auto max-w-page px-gutter py-16">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
          <div>
            <p className="label-brand">Zo werkt het</p>
            <h2 className="mt-2 text-display-md">Van eerste contact tot je hele team in pak</h2>
            <ol className="mt-6 space-y-5">
              {[
                { n: "1", t: "Vertel wat je nodig hebt", b: "Aantal personen, type kleding, gewenste stijl en termijn." },
                { n: "2", t: "We denken mee en adviseren", b: "Over voorraad, levering, passen, vermaak, eventueel personalisatie." },
                { n: "3", t: "Passen en aanleveren", b: "Passervice in 19 winkels of bij grotere teams op locatie. Vermaak waar nodig." },
              ].map((s) => (
                <li key={s.n} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center border border-ink font-display text-lg">{s.n}</span>
                  <div>
                    <h3 className="font-display text-lg font-light">{s.t}</h3>
                    <p className="mt-1 font-sans text-sm text-ink-soft">{s.b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
          <ContactRequestForm
            channel="zakelijk"
            title="Vraag informatie aan"
            intro="We nemen binnen één werkdag contact met je op."
            showOrg
            showGroupSize
          />
        </div>
      </section>
    </article>
  );
}
