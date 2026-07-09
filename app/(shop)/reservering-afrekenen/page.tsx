import type { Metadata } from "next";
import { formatEuro } from "@/lib/format";
import { getReservationByPayToken, reservationAmountCents, type ReservationLine } from "@/lib/reservations";
import { AfrekenenButton } from "./AfrekenenButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reservering afrekenen — GENTS",
  robots: { index: false, follow: false },
};

const euro = (c: number) => formatEuro(c || 0);

/**
 * /reservering-afrekenen?token=… — landingspagina van de "online afrekenen"-link uit
 * de reserveringsmail. Klant rekent online af → de reservering wordt een betaalde
 * afhaalorder (we houden 'm dan onbeperkt vast tot ophalen).
 */
export default async function ReserveringAfrekenenPage({ searchParams }: { searchParams: Promise<{ token?: string; betaald?: string }> }) {
  const sp = await searchParams;
  const token = String(sp.token || "").trim();
  const justPaid = sp.betaald === "1";
  const r = token ? await getReservationByPayToken(token) : null;

  // Huisstijl (ink/line/canvas + display-kop) i.p.v. generiek neutral-Tailwind —
  // deze klant-landingspagina moet als GENTS aanvoelen.
  const Wrap = ({ children }: { children: React.ReactNode }) => <main className="mx-auto max-w-lg px-gutter py-12">{children}</main>;
  const Heading = ({ children }: { children: React.ReactNode }) => (
    <>
      <p className="label-brand">Reservering</p>
      <h1 className="mt-2 font-display text-2xl font-light text-ink">{children}</h1>
    </>
  );

  if (!r) {
    return <Wrap><Heading>Reservering afrekenen</Heading><p className="mt-4 rounded-card border border-line bg-surface p-4 font-sans text-sm text-ink-soft">Deze link is niet (meer) geldig. Vraag in de winkel om een nieuwe.</p></Wrap>;
  }

  // Net betaald, of al afgerekend → bedankt-scherm.
  if (justPaid || r.status === "converted" || r.paid) {
    return (
      <Wrap>
        <div className="rounded-card border border-success/40 bg-success/5 p-6 text-center">
          <p className="font-display text-lg font-light text-ink">Bedankt — je reservering is afgerekend</p>
          <p className="mt-1 font-sans text-sm text-ink-soft">We houden je bestelling klaar in <strong className="text-ink">{r.location}</strong>. Je kunt &rsquo;m op je gemak ophalen — we houden &rsquo;m nu onbeperkt voor je vast.</p>
        </div>
      </Wrap>
    );
  }

  if (r.status !== "open") {
    return <Wrap><Heading>Reservering afrekenen</Heading><p className="mt-4 rounded-card border border-line bg-surface p-4 font-sans text-sm text-ink-soft">Deze reservering is niet meer actief.</p></Wrap>;
  }

  const lines = (Array.isArray(r.lines) ? r.lines : []) as ReservationLine[];
  const total = reservationAmountCents(lines);

  return (
    <Wrap>
      <Heading>Reken je reservering af</Heading>
      <p className="mt-2 font-sans text-sm text-ink-soft">Reken nu online af, dan houden we je bestelling <strong className="text-ink">onbeperkt</strong> voor je klaar in <strong className="text-ink">{r.location}</strong> tot je &rsquo;m ophaalt.</p>

      <div className="mt-6 divide-y divide-line rounded-card border border-line">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-sans text-sm font-medium text-ink">{l.title || l.sku}</p>
              <p className="truncate font-sans text-xs text-muted">{[l.color, l.size && `maat ${l.size}`, (l.qty || 1) > 1 ? `${l.qty}×` : ""].filter(Boolean).join(" · ")}</p>
            </div>
            <span className="shrink-0 font-sans text-sm tabular-nums text-ink-soft">{euro((Number(l.priceCents) || 0) * Math.max(1, Number(l.qty) || 1))}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-sans text-sm font-medium text-ink">Totaal</span>
          <span className="font-display text-base tabular-nums text-ink">{euro(total)}</span>
        </div>
      </div>

      <AfrekenenButton token={token} />
      <p className="mt-3 text-center font-sans text-xs text-muted">Betalen verandert niets aan je afhaalwinkel — je haalt &rsquo;m gewoon op in {r.location}.</p>
    </Wrap>
  );
}
