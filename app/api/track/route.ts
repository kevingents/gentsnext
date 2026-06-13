import { NextResponse } from "next/server";
import { recordEvents } from "@/lib/analytics";

export const dynamic = "force-dynamic";

/** Ontvangt een batch anonieme storefront-events (geen PII). */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const list = Array.isArray(body?.events) ? body.events : Array.isArray(body) ? body : [];
    await recordEvents(list);
  } catch {
    /* analytics mag nooit de UX breken */
  }
  return NextResponse.json({ ok: true });
}
