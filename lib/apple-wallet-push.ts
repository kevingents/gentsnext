import { connect } from "node:http2";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { walletAppleRegistrations } from "@/db/schema";
import { walletConfigured } from "@/lib/apple-wallet-config";

/**
 * APNs-push voor de Apple-Wallet spaarpas. Bij een saldowijziging sturen we een
 * lege push naar elk geregistreerd device; iOS haalt daarna zélf de verse pas op
 * (GET /api/wallet/apple/v1/passes/…). De provider-verbinding gebruikt hetzelfde
 * Pass Type ID-certificaat als de ondertekening (client-TLS), topic =
 * passTypeIdentifier.
 *
 * ALLES best-effort: geen certs, geen registraties of een APNs-fout mag nooit de
 * loyalty-mutatie (sparen/inwisselen) laten falen. 410 = device afgemeld → de
 * registratie opruimen.
 */

function b64Pem(key: string): string {
  const v = process.env[key] || "";
  if (!v) return "";
  return v.includes("-----BEGIN") ? v : Buffer.from(v, "base64").toString("utf8");
}

/**
 * Het saldo zoals het OP DE PAS staat: het geveste (besteedbare) deel van het
 * grootboek, geklemd op 0 — exact wat de pas-route rendert (redeemableBalance).
 * Eén definitie, gebruikt door zowel de stempel na een push als de drift-cron,
 * zodat die twee niet uiteen kunnen lopen.
 */
export function vestedBalanceSql(serial: string) {
  return sql`greatest(0, coalesce((
    select sum(points)::int from loyalty_events
    where customer_id::text = ${serial} and (vests_at is null or vests_at <= now())
  ), 0))`;
}

const APNS_HOST = "https://api.push.apple.com";
const PUSH_TIMEOUT_MS = 5000; // per device-request
const OVERALL_TIMEOUT_MS = 6000; // harde bovengrens voor de hele push-ronde

/**
 * Stuur een pas-update-push voor één pas-serial (= customerId). Retourneert het
 * aantal succesvol gepushte devices. Werpt nooit.
 */
export async function pushPassUpdate(serialNumber: string): Promise<number> {
  const serial = String(serialNumber || "").trim();
  if (!serial || !walletConfigured()) return 0;

  let regs: { deviceLibraryIdentifier: string; pushToken: string }[] = [];
  try {
    const db = getDb();
    regs = await db
      .select({
        deviceLibraryIdentifier: walletAppleRegistrations.deviceLibraryIdentifier,
        pushToken: walletAppleRegistrations.pushToken,
      })
      .from(walletAppleRegistrations)
      .where(eq(walletAppleRegistrations.serialNumber, serial));
  } catch (e) {
    console.warn("[wallet/push] registraties lezen faalde:", (e as Error).message);
    return 0;
  }
  if (!regs.length) return 0;

  const topic = process.env.APPLE_PASS_TYPE_ID || "";
  const cert = b64Pem("APPLE_WALLET_SIGNER_CERT");
  const key = b64Pem("APPLE_WALLET_SIGNER_KEY");
  const passphrase = process.env.APPLE_WALLET_SIGNER_KEY_PASSPHRASE || undefined;
  if (!topic || !cert || !key) return 0;

  let client: ReturnType<typeof connect> | null = null;
  const stale: string[] = [];
  let ok = 0;
  try {
    client = connect(APNS_HOST, { cert, key, passphrase });
    // Een verbindingsfout mag de losse requests niet laten hangen.
    client.on("error", (e) => console.warn("[wallet/push] APNs-verbinding:", e.message));

    const pushOne = (r: { pushToken: string }) =>
      new Promise<void>((resolve) => {
        let settled = false;
        const done = () => { if (!settled) { settled = true; resolve(); } };
        try {
          const req = client!.request({
            ":method": "POST",
            ":path": `/3/device/${r.pushToken}`,
            "apns-topic": topic,
            "apns-push-type": "background",
            "apns-priority": "5",
            "content-type": "application/json",
          });
          let status = 0;
          req.on("response", (h) => { status = Number(h[":status"]) || 0; });
          // KRITIEK: de response-body MOET gedraind worden, anders vuurt 'end'
          // nooit (elke non-200 heeft een body, incl. 410) en hangt de promise.
          req.on("data", () => {});
          req.setTimeout(PUSH_TIMEOUT_MS, () => { try { req.close(); } catch { /* al dicht */ } done(); });
          req.on("end", () => {
            if (status === 200) ok += 1;
            else if (status === 410) stale.push(r.pushToken); // device heeft de pas verwijderd
            done();
          });
          // Vangnet: 'close' vuurt ook bij req.close()/reset → altijd settelen.
          req.on("close", done);
          req.on("error", done);
          req.end(JSON.stringify({}));
        } catch {
          done();
        }
      });

    // Harde bovengrens over de HELE ronde — geen enkele APNs-hapering mag de
    // loyalty-mutatie laten wachten. Wat niet binnen is, telt gewoon niet mee.
    await Promise.race([
      Promise.all(regs.map(pushOne)),
      new Promise<void>((r) => setTimeout(r, OVERALL_TIMEOUT_MS)),
    ]);
  } catch (e) {
    console.warn("[wallet/push] APNs push faalde:", (e as Error).message);
  } finally {
    try { client?.close(); } catch { /* al dicht */ }
  }

  // Afgemelde devices opruimen (best-effort).
  if (stale.length) {
    try {
      const db = getDb();
      for (const tok of stale) {
        await db.delete(walletAppleRegistrations).where(eq(walletAppleRegistrations.pushToken, tok));
      }
    } catch (e) {
      console.warn("[wallet/push] stale-registraties opruimen faalde:", (e as Error).message);
    }
  }
  /* Vastleggen wélk saldo de pas nu kent. Daarmee is achterlopen meetbaar: de
     drift-cron vergelijkt dit met het echte saldo en haalt in wat een pad hier
     niet langs bracht. Alleen bij een geslaagde push — anders zouden we een
     update claimen die het toestel nooit kreeg.
     Let op: de pas toont het GEVESTE (besteedbare) saldo, niet de totaalcache.
     Vergelijken met customers.loyalty_points zou vesting missen — en dat is nu
     juist de reden dat deze cron ooit bestond. */
  if (ok > 0) {
    try {
      const db = getDb();
      await db.execute(sql`
        update wallet_apple_registrations
        set last_pushed_points = ${vestedBalanceSql(serial)}
        where serial_number = ${serial}`);
    } catch (e) {
      console.warn("[wallet/push] saldo-stempel bijwerken faalde:", (e as Error).message);
    }
  }
  return ok;
}
