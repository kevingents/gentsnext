import { sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/db";
import { personnelMirror } from "@/db/schema";

/**
 * Personeels-spiegel voor de snelle kassacode-check (zie db/schema.ts).
 *
 * Schrijvers: de storegents-sync-cron (action "sync": volledige set, verwijdert
 * verdwenen nummers), write-through bij kassacode-reset/actief-zetten en de
 * self-heal na een geslaagde SRS-fallback (action "upsert").
 * Lezer: action "verify" — geeft alleen door of de hash matcht plus de
 * login-velden; de opgeslagen hash verlaat de database nooit.
 */

export type MirrorRowInput = {
  personnelId: string;
  name?: string;
  internalName?: string;
  externalName?: string;
  personnelGroupId?: string;
  active?: boolean;
  branches?: string[] | string;
  fingerprintRequired?: boolean;
  codeHash?: string;
};

const norm = (v: unknown) => String(v ?? "").trim();
const normBranches = (v: MirrorRowInput["branches"]): string =>
  (Array.isArray(v) ? v : norm(v).split(","))
    .map((b) => norm(b))
    .filter(Boolean)
    .join(",");

function toRow(r: MirrorRowInput) {
  const personnelId = norm(r?.personnelId);
  if (!personnelId) return null;
  return {
    personnelId,
    name: norm(r.name),
    internalName: norm(r.internalName),
    externalName: norm(r.externalName),
    personnelGroupId: norm(r.personnelGroupId),
    active: r.active === true,
    branches: normBranches(r.branches),
    fingerprintRequired: r.fingerprintRequired === true,
    codeHash: norm(r.codeHash).toLowerCase(),
    updatedAt: new Date(),
  };
}

async function upsertRows(rows: MirrorRowInput[]): Promise<number> {
  const byId = new Map<string, NonNullable<ReturnType<typeof toRow>>>();
  for (const r of rows || []) {
    const row = toRow(r);
    if (row) byId.set(row.personnelId, row);
  }
  const values = [...byId.values()];
  if (!values.length) return 0;
  const db = getDb();
  await db
    .insert(personnelMirror)
    .values(values)
    .onConflictDoUpdate({
      target: personnelMirror.personnelId,
      set: {
        name: sql`excluded.name`,
        internalName: sql`excluded.internal_name`,
        externalName: sql`excluded.external_name`,
        personnelGroupId: sql`excluded.personnel_group_id`,
        active: sql`excluded.active`,
        branches: sql`excluded.branches`,
        fingerprintRequired: sql`excluded.fingerprint_required`,
        /* Een sync-rij zonder code (SRS gaf geen PosLoginCode terug) mag een
           eerder via write-through gezette hash niet wissen. */
        codeHash: sql`CASE WHEN excluded.code_hash = '' THEN "personnel_mirror"."code_hash" ELSE excluded.code_hash END`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
  return values.length;
}

/** Losse write-through / self-heal (één of enkele rijen). */
export async function upsertPersonnelMirror(rows: MirrorRowInput[]): Promise<{ ok: boolean; upserted: number }> {
  return { ok: true, upserted: await upsertRows(rows) };
}

/**
 * Volledige sync: upsert de complete set en verwijder nummers die er niet meer
 * in zitten (gemarkeerd doordat hun updated_at vóór de sync-start blijft; een
 * gelijktijdige write-through krijgt een verse stempel en overleeft dus).
 * Lege set → alleen weigeren, nooit de spiegel leegtrekken.
 */
export async function syncPersonnelMirror(rows: MirrorRowInput[]): Promise<{ ok: boolean; upserted: number; removed: number; error?: string }> {
  if (!Array.isArray(rows) || !rows.length) {
    return { ok: false, upserted: 0, removed: 0, error: "Lege set — sync geweigerd (spiegel ongewijzigd)." };
  }
  const start = new Date();
  const upserted = await upsertRows(rows);
  const db = getDb();
  const res = await db.execute(sql`DELETE FROM personnel_mirror WHERE updated_at < ${start.toISOString()}`);
  return { ok: true, upserted, removed: Number(res.rowCount) || 0 };
}

export type MirrorVerifyResult = {
  ok: true;
  found: boolean;
  active: boolean;
  match: boolean;
  person: {
    personnelId: string;
    name: string;
    internalName: string;
    externalName: string;
    personnelGroupId: string;
    active: boolean;
    branches: string[];
    fingerprintRequired: boolean;
  } | null;
};

function hashesEqual(a: string, b: string): boolean {
  const A = Buffer.from(String(a || ""), "utf8");
  const B = Buffer.from(String(b || ""), "utf8");
  if (A.length !== B.length || A.length === 0) return false;
  return timingSafeEqual(A, B);
}

/**
 * Kassacode-check tegen de spiegel. `match` is alleen true bij een gevonden,
 * ACTIEVE medewerker met een niet-lege, gelijke hash — de beslissing "mag de
 * live SRS-check overgeslagen worden" ligt bij de aanroeper (storegents), die
 * bij alles behalve een volledige match op SRS terugvalt.
 */
export async function verifyPersonnelCode({ personnelId, codeHash }: { personnelId: string; codeHash: string }): Promise<MirrorVerifyResult> {
  const id = norm(personnelId);
  const hash = norm(codeHash).toLowerCase();
  const db = getDb();
  const rows = await db.select().from(personnelMirror).where(sql`${personnelMirror.personnelId} = ${id}`).limit(1);
  const row = rows[0];
  if (!row) return { ok: true, found: false, active: false, match: false, person: null };
  const match = row.active && hashesEqual(row.codeHash, hash);
  return {
    ok: true,
    found: true,
    active: row.active,
    match,
    person: {
      personnelId: row.personnelId,
      name: row.name,
      internalName: row.internalName,
      externalName: row.externalName,
      personnelGroupId: row.personnelGroupId,
      active: row.active,
      branches: row.branches ? row.branches.split(",").filter(Boolean) : [],
      fingerprintRequired: row.fingerprintRequired,
    },
  };
}
