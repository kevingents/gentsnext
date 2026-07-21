import { connect } from "node:http2";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { walletAppleRegistrations } from "@/db/schema";
import { walletConfigured } from "@/lib/apple-wallet";

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

const APNS_HOST = "https://api.push.apple.com";
const PUSH_TIMEOUT_MS = 8000;

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

    await Promise.all(
      regs.map(
        (r) =>
          new Promise<void>((resolve) => {
            try {
              const req = client!.request({
                ":method": "POST",
                ":path": `/3/device/${r.pushToken}`,
                "apns-topic": topic,
                "apns-push-type": "background",
                "content-type": "application/json",
              });
              let status = 0;
              req.on("response", (h) => { status = Number(h[":status"]) || 0; });
              req.setTimeout(PUSH_TIMEOUT_MS, () => req.close());
              req.on("end", () => {
                if (status === 200) ok += 1;
                // 410 Gone = device heeft de pas verwijderd → registratie opruimen.
                else if (status === 410) stale.push(r.pushToken);
                resolve();
              });
              req.on("error", () => resolve());
              req.write(JSON.stringify({}));
              req.end();
            } catch {
              resolve();
            }
          }),
      ),
    );
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
  return ok;
}
