/**
 * Levertijd-indicatie op de PDP. De tekst komt UITSLUITEND server-side uit de
 * allocatie-engine (estimateDelivery): die kent de voorraadlocatie, split,
 * openingstijden, feestdagen, bedrijfssluitingen en de echte cutoff.
 *
 * Er stond hier een client-side terugval die zelf een leverdatum uitrekende met
 * de tijdzone van de bezoeker, een hardgecodeerde cutoff van 16:00 en alleen een
 * weekendcheck. Die sprong juist bij in de gevallen waarin de server bewust géén
 * belofte doet — uitverkocht, filiaal gepauzeerd, lange sluiting — en verzon dan
 * "morgen bezorgd". Geen belofte is beter dan een verkeerde, dus die is weg.
 *
 * Geen "use client" meer nodig: er is geen tijd, timer of locale-logica meer.
 */
export function DeliveryPromise({
  promise,
  note,
  extra,
}: {
  promise?: string | null;
  note?: string | null;
  /** Extra rustige regel in hetzelfde blok (bv. "Gratis verzending") — voorkomt
   *  losse info-regels onder elkaar op mobiel. */
  extra?: string | null;
}) {
  const sub = [note, extra].filter(Boolean).join(" · ");
  if (!promise && !sub) return null;

  return (
    <div className="mt-6 border-y border-line py-3">
      {promise ? (
        <p className="flex items-center gap-1.5 font-sans text-sm">
          <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden className="shrink-0 text-success">
            <circle cx="4" cy="4" r="4" fill="currentColor" />
          </svg>
          <span className="font-medium">{promise}</span>
        </p>
      ) : null}
      {sub ? <p className={`${promise ? "mt-1 " : ""}font-sans text-xs text-muted`}>{sub}</p> : null}
    </div>
  );
}
