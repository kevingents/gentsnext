import { list } from "@vercel/blob";
import { singleflight } from "@/lib/inflight";

/**
 * Reservering-hold-duur (MINUTEN) — instelbaar via de ReserveringConfig-kaart in
 * de portal (Instellingen), die schrijft naar de storegents-blob
 * `config/reservering-config.json` ({ holdMinuten }). gentsnext leest die blob
 * direct, zodat de scanner, de site en de back-office dezelfde duur gebruiken.
 *
 * Was dagen (default 7). Kevin, 12 aug: "reserveringen in winkels houden we 2 uur
 * vast" — voor allebei de soorten, dus zowel wat de winkel apart legt (channel
 * 'store') als wat de klant online reserveert om op te halen ('web').
 *
 * Het oude `agingDagen` wordt BEWUST GENEGEERD. Zou het als fallback blijven
 * gelden, dan hield een blob die nog op 7 staat de nieuwe regel tegen en bleef
 * het stil 7 dagen — precies het soort verschil dat je pas ontdekt als een stuk
 * een week onverkoopbaar in het magazijn hangt.
 */

const KEY = "config/reservering-config.json";
const DEFAULT_MINUTEN = 120; // 2 uur
const TTL_MS = 60_000; // korte cache: een config-wijziging is binnen een minuut actief

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}
/** 5 minuten tot 90 dagen: kort genoeg voor "kom het vanmiddag halen", lang
 *  genoeg voor een bewaarafspraak, en nooit 0 (dan vervalt 'ie meteen). */
function clampMinuten(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(5, Math.min(129600, Math.round(v))) : DEFAULT_MINUTEN;
}

let cache: { minuten: number; at: number } | null = null;
const flight = singleflight<number>();

export async function getReservationHoldMinutes(): Promise<number> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.minuten;
  return flight(loadMinuten);
}

async function loadMinuten(): Promise<number> {
  let minuten = DEFAULT_MINUTEN;
  try {
    const token = blobToken();
    if (token) {
      const { blobs } = await list({ prefix: KEY, limit: 1, token });
      const b = (blobs || []).find((x) => x.pathname === KEY);
      if (b) {
        const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { holdMinuten?: number };
          if (data?.holdMinuten != null) minuten = clampMinuten(data.holdMinuten);
        }
      }
    }
  } catch {
    // Blob onbereikbaar → val terug op de default.
  }
  cache = { minuten, at: Date.now() };
  return minuten;
}
