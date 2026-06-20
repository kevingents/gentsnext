import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { adminOrToken } from "@/lib/studio-token";
import { getDb } from "@/db";
import { appSettings } from "@/db/schema";
import { normPath, type Redirect } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ID = "redirects";

async function read(): Promise<Redirect[]> {
  const db = getDb();
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, ID)).limit(1);
  const list = (rows[0]?.data as { list?: Redirect[] } | undefined)?.list;
  return Array.isArray(list) ? list : [];
}

async function write(list: Redirect[]): Promise<void> {
  const db = getDb();
  await db
    .insert(appSettings)
    .values({ id: ID, data: { list }, updatedAt: sql`now()` })
    .onConflictDoUpdate({ target: appSettings.id, set: { data: { list }, updatedAt: sql`now()` } });
}

/**
 * Portal-beheerbare redirects (301/302). Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 * GET                                          → lijst
 * POST { source, target, status?, active? }    → toevoegen/bijwerken (op source)
 * POST { action:"delete", source }             → verwijderen
 */
export async function GET(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  return NextResponse.json({ ok: true, redirects: await read() });
}

export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { source?: unknown; target?: unknown; status?: unknown; active?: unknown; action?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const source = normPath(String(body.source || ""));
  if (!source || source === "/") {
    return NextResponse.json({ ok: false, error: "Geldig bron-pad vereist (bv. /oude-pagina)." }, { status: 400 });
  }

  try {
    const list = await read();
    const idx = list.findIndex((r) => normPath(r.source) === source);

    if (body.action === "delete") {
      if (idx >= 0) list.splice(idx, 1);
      await write(list);
      return NextResponse.json({ ok: true, redirects: list });
    }

    const targetRaw = String(body.target || "").trim();
    if (!targetRaw) return NextResponse.json({ ok: false, error: "Doel vereist (pad of volledige URL)." }, { status: 400 });
    const target = /^https?:\/\//i.test(targetRaw) ? targetRaw.slice(0, 400) : normPath(targetRaw);
    if (target === source) return NextResponse.json({ ok: false, error: "Bron en doel zijn gelijk." }, { status: 400 });

    const entry: Redirect = {
      source,
      target,
      status: Number(body.status) === 302 ? 302 : 301,
      active: body.active === undefined ? true : Boolean(body.active),
    };
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    await write(list);
    return NextResponse.json({ ok: true, redirects: list });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
