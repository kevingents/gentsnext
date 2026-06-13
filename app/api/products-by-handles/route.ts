import { NextResponse } from "next/server";
import { getProductsByHandles } from "@/lib/catalog";

export const dynamic = "force-dynamic";

/** Bulk-resolver voor productkaarten uit een lijst handles (favorieten/recent). */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const handles: string[] = Array.isArray(body?.handles)
      ? body.handles.filter((h: unknown) => typeof h === "string").slice(0, 100)
      : [];
    const items = await getProductsByHandles(handles);
    return NextResponse.json({ items });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "fout" }, { status: 400 });
  }
}
