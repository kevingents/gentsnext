import { list } from "@vercel/blob";

/**
 * Verzendadvies voor winkel→winkel-herverdeling (F4+): rit (gratis, vaste dagen) vs
 * DHL (betaald, morgen binnen). De rit-schema's zijn instelbaar via de settings-blob
 * `config/transfer-routes.json` (mirror van receiving-config) — jij beheert ze zelf,
 * niet in Vercel. Defaults: geen ritten → advies altijd DHL.
 *
 * Een rit = een naam + de winkels die 'ie aandoet + de weekdagen (0=zo … 6=za).
 * Zitten bron én doel op dezelfde rit en vertrekt die binnen `maxRouteWaitDays`,
 * dan adviseren we de rit (gratis); anders DHL. Spoed → altijd DHL (snelst).
 */

const KEY = "config/transfer-routes.json";
const TTL_MS = 60_000;

export type TransferRoute = { name: string; stores: string[]; days: number[] };
export type TransferRoutesConfig = { routes: TransferRoute[]; dhlCostCents: number; maxRouteWaitDays: number };

const DEFAULTS: TransferRoutesConfig = { routes: [], dhlCostCents: 700, maxRouteWaitDays: 4 };
const DOW = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];

function blobToken(): string {
  return process.env.STOREGENTS_BLOB_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN || "";
}
function num(v: unknown, def: number, min: number, max: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
}

let cache: { cfg: TransferRoutesConfig; at: number } | null = null;

export async function getTransferRoutesConfig(): Promise<TransferRoutesConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.cfg;
  let cfg = { ...DEFAULTS };
  try {
    const token = blobToken();
    if (token) {
      const { blobs } = await list({ prefix: KEY, limit: 1, token });
      const b = (blobs || []).find((x) => x.pathname === KEY);
      if (b) {
        const res = await fetch(`${b.url}?_=${Date.now()}`, { cache: "no-store" });
        if (res.ok) {
          const d = (await res.json()) as Partial<TransferRoutesConfig>;
          const routes = (Array.isArray(d.routes) ? d.routes : []).map((r) => ({
            name: String(r?.name || "").trim(),
            stores: (Array.isArray(r?.stores) ? r.stores : []).map((s) => String(s || "").trim()).filter(Boolean),
            days: (Array.isArray(r?.days) ? r.days : []).map((n) => num(n, -1, 0, 6)).filter((n) => n >= 0),
          })).filter((r) => r.name && r.stores.length && r.days.length);
          cfg = { routes, dhlCostCents: num(d.dhlCostCents, DEFAULTS.dhlCostCents, 0, 100000), maxRouteWaitDays: num(d.maxRouteWaitDays, DEFAULTS.maxRouteWaitDays, 0, 30) };
        }
      }
    }
  } catch { /* defaults */ }
  cache = { cfg, at: Date.now() };
  return cfg;
}

/** Eerstvolgende datum (incl. vandaag) met een weekdag uit `days`. */
function nextDateForDays(days: number[], now: Date): Date {
  const set = new Set(days);
  for (let i = 0; i < 8; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    if (set.has(d.getDay())) { d.setHours(0, 0, 0, 0); return d; }
  }
  return now;
}

export type ShipAdvice = {
  method: "route" | "dhl";
  reason: string;
  routeName?: string;
  nextDate?: string; // ISO
  waitDays?: number;
  costCents: number;
  eta: string;
};

/** Pure advies-functie (testbaar): rit vs DHL gegeven een config. Spoed → altijd DHL. */
export function computeAdvice(cfg: TransferRoutesConfig, fromStore: string, toStore: string, urgent: boolean, now: Date): ShipAdvice {
  const dhl = (reason: string): ShipAdvice => ({ method: "dhl", reason, costCents: cfg.dhlCostCents, eta: "morgen" });
  if (urgent) return dhl("Spoed — versturen met DHL (morgen binnen).");

  const from = String(fromStore || "").trim().toLowerCase();
  const to = String(toStore || "").trim().toLowerCase();
  const matches = cfg.routes.filter((r) => {
    const s = r.stores.map((x) => x.toLowerCase());
    return s.includes(from) && s.includes(to);
  });
  if (!matches.length) return dhl("Geen gedeelde rit tussen deze winkels — versturen met DHL.");

  let best: { route: TransferRoute; date: Date } | null = null;
  for (const r of matches) {
    const date = nextDateForDays(r.days, now);
    if (!best || date < best.date) best = { route: r, date };
  }
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const waitDays = Math.round((best!.date.getTime() - today.getTime()) / 86400000);
  if (waitDays > cfg.maxRouteWaitDays) {
    return dhl(`Eerstvolgende rit pas over ${waitDays} dagen — sneller met DHL.`);
  }
  const when = waitDays === 0 ? "vandaag" : waitDays === 1 ? "morgen" : DOW[best!.date.getDay()];
  return { method: "route", routeName: best!.route.name, nextDate: best!.date.toISOString(), waitDays, costCents: 0, eta: when, reason: `Meegeven met de rit "${best!.route.name}" — ${when}. Gratis.` };
}

/** Advies rit vs DHL voor een herverdeling bron→doel (leest de rit-config). Spoed → altijd DHL. */
export async function adviseShipMethod(fromStore: string, toStore: string, urgent: boolean, now: Date = new Date()): Promise<ShipAdvice> {
  return computeAdvice(await getTransferRoutesConfig(), fromStore, toStore, urgent, now);
}
