import type { Metadata } from "next";
import { getReservationByPayToken, reservationAmountCents, type ReservationLine } from "@/lib/reservations";
import { AfrekenenButton } from "./AfrekenenButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Reservering afrekenen — GENTS",
  robots: { index: false, follow: false },
};

function euro(c: number): string {
  try { return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format((c || 0) / 100); }
  catch { return `€ ${((c || 0) / 100).toFixed(2)}`; }
}

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

  const Wrap = ({ children }: { children: React.ReactNode }) => <main className="mx-auto max-w-lg px-4 py-12">{children}</main>;

  if (!r) {
    return <Wrap><h1 className="text-2xl font-semibold text-neutral-900">Reservering afrekenen</h1><p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Deze link is niet (meer) geldig. Vraag in de winkel om een nieuwe.</p></Wrap>;
  }

  // Net betaald, of al afgerekend → bedankt-scherm.
  if (justPaid || r.status === "converted" || r.paid) {
    return (
      <Wrap>
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <p className="text-lg font-semibold text-emerald-800">Bedankt — je reservering is afgerekend</p>
          <p className="mt-1 text-sm text-emerald-700">We houden je bestelling klaar in <strong>{r.location}</strong>. Je kunt 'm op je gemak ophalen — we houden 'm nu onbeperkt voor je vast.</p>
        </div>
      </Wrap>
    );
  }

  if (r.status !== "open") {
    return <Wrap><h1 className="text-2xl font-semibold text-neutral-900">Reservering afrekenen</h1><p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">Deze reservering is niet meer actief.</p></Wrap>;
  }

  const lines = (Array.isArray(r.lines) ? r.lines : []) as ReservationLine[];
  const total = reservationAmountCents(lines);

  return (
    <Wrap>
      <h1 className="text-2xl font-semibold text-neutral-900">Reken je reservering af</h1>
      <p className="mt-2 text-sm text-neutral-600">Reken nu online af, dan houden we je bestelling <strong>onbeperkt</strong> voor je klaar in <strong>{r.location}</strong> tot je 'm ophaalt.</p>

      <div className="mt-6 divide-y divide-neutral-200 rounded-xl border border-neutral-200">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900">{l.title || l.sku}</p>
              <p className="truncate text-xs text-neutral-500">{[l.color, l.size && `maat ${l.size}`, (l.qty || 1) > 1 ? `${l.qty}×` : ""].filter(Boolean).join(" · ")}</p>
            </div>
            <span className="shrink-0 text-sm tabular-nums text-neutral-700">{euro((Number(l.priceCents) || 0) * Math.max(1, Number(l.qty) || 1))}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3">
          <span className="text-sm font-semibold text-neutral-900">Totaal</span>
          <span className="text-sm font-semibold tabular-nums text-neutral-900">{euro(total)}</span>
        </div>
      </div>

      <AfrekenenButton token={token} />
      <p className="mt-3 text-center text-xs text-neutral-500">Betalen verandert niets aan je afhaalwinkel — je haalt 'm gewoon op in {r.location}.</p>
    </Wrap>
  );
}
