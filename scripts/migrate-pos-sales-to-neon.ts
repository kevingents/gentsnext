import "@/lib/load-env";
import { list } from "@vercel/blob";
import { recordPosSaleCore } from "@/lib/pos-sales-core";

/**
 * Eenmalige (her-draaibare) data-migratie: storegents-blob admin/pos-sales.json →
 * Neon-core pos_sales. Idempotent (recordPosSaleCore dedupt op client_ref + id),
 * dus veilig om vlak vóór go-live nog eens te draaien om stragglers op te pikken.
 *   npm run migrate:possales
 */
const KEY = "admin/pos-sales.json";
function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}

async function main() {
  const token = blobToken();
  if (!token) { console.error("Geen blob-token (STOREGENTS_BLOB_READ_WRITE_TOKEN)."); process.exit(1); }

  const { blobs } = await list({ prefix: KEY, limit: 1, token });
  const b = (blobs || []).find((x) => x.pathname === KEY);
  if (!b) { console.log("Geen pos-sales-blob gevonden — niets te migreren."); process.exit(0); }

  const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
  if (!res.ok) { console.error("Blob-fetch faalde:", res.status); process.exit(1); }
  const data = (await res.json()) as { sales?: Record<string, unknown>[] };
  const sales = Array.isArray(data?.sales) ? data.sales : [];
  console.log("blob-verkopen:", sales.length);

  let inserted = 0, deduped = 0, failed = 0;
  // Blob is nieuwste-eerst → oudste eerst invoegen voor nette created_at-volgorde.
  for (const sale of [...sales].reverse()) {
    try {
      const r = await recordPosSaleCore(sale as { id?: string; store?: string });
      if (r.ok) { r.deduped ? deduped++ : inserted++; } else { failed++; console.warn("skip:", r.error); }
    } catch (e) { failed++; console.warn("fout bij", (sale as { id?: string })?.id, (e as Error).message); }
  }
  console.log(`KLAAR — ingevoegd: ${inserted} | al aanwezig (deduped): ${deduped} | mislukt: ${failed}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error("FAIL:", e); process.exit(1); });
