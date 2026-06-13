import Link from "next/link";

const ITEMS = [
  {
    title: "19 winkels in Nederland & België",
    body: "Persoonlijk advies, pasvorm-expertise en het complete assortiment — kom langs.",
    href: "/pages/winkels",
    label: "Vind een winkel",
  },
  {
    title: "Gratis retour binnen 14 dagen",
    body: "Niet goed? Retourneer eenvoudig — gratis binnen Nederland.",
    href: "/pages/retourneren",
    label: "Hoe het werkt",
  },
  {
    title: "Dresscode-expertise",
    body: "Black tie, gala, bruiloft? Onze stylisten leggen elke dresscode uit.",
    href: "/pages/etiquette",
    label: "Naar de gids",
  },
];

export function TrustBlock() {
  return (
    <section className="bg-surface">
      <div className="mx-auto grid max-w-page gap-8 px-gutter py-14 md:grid-cols-3">
        {ITEMS.map((i) => (
          <div key={i.title} className="border-l border-line pl-6">
            <h3 className="font-display text-xl font-light">{i.title}</h3>
            <p className="mt-2 font-sans text-sm leading-relaxed text-ink-soft">{i.body}</p>
            <Link href={i.href} className="mt-3 inline-block font-sans text-sm text-ink underline underline-offset-4">
              {i.label} →
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
