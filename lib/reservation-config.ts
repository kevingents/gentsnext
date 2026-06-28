import { list } from "@vercel/blob";
import { singleflight } from "@/lib/inflight";

/**
 * Reservering-hold-duur (dagen) — instelbaar via de ReserveringConfig-kaart in de
 * portal (Instellingen), die schrijft naar de storegents-blob
 * `config/reservering-config.json` ({ agingDagen }). gentsnext leest die blob direct
 * (zelfde patroon als de sfeerbeeld/model-learnings) zodat zowel de scanner als de
 * back-office automatisch dezelfde, instelbare hold-duur gebruiken. Default 7.
 */

const KEY = "config/reservering-config.json";
const DEFAULT_DAYS = 7;
const TTL_MS = 60_000; // korte cache: een config-wijziging is binnen een minuut actief

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}
function clampDays(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(1, Math.min(365, Math.round(v))) : DEFAULT_DAYS;
}

let cache: { days: number; at: number } | null = null;
const flight = singleflight<number>();

export async function getReservationHoldDays(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.days;
  return flight(loadDays);
}

async function loadDays(): Promise<number> {
  let days = DEFAULT_DAYS;
  try {
    const token = blobToken();
    if (token) {
      const { blobs } = await list({ prefix: KEY, limit: 1, token });
      const b = (blobs || []).find((x) => x.pathname === KEY);
      if (b) {
        const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { agingDagen?: number };
          days = clampDays(data?.agingDagen);
        }
      }
    }
  } catch {
    // Blob onbereikbaar → val terug op de default.
  }
  cache = { days, at: Date.now() };
  return days;
}
