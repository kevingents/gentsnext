const USPS = [
  "Formele-momenten specialist",
  "Betaalbare luxe",
  "Gratis retour binnen 14 dagen",
  "Persoonlijk advies in 19 winkels",
];

export function UspBar() {
  return (
    <div className="border-y border-line bg-surface">
      <div className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-10 gap-y-2 px-gutter py-3">
        {USPS.map((usp) => (
          <span key={usp} className="label-brand !text-ink-soft">
            {usp}
          </span>
        ))}
      </div>
    </div>
  );
}
