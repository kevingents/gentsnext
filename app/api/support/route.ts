import { NextResponse } from "next/server";
import { handleSupportQuestion } from "@/lib/support";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** AI-klantenservice: beantwoordt of escaleert een vraag. */
export async function POST(req: Request) {
  let body: { question?: string; email?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "ongeldige body" }, { status: 400 });
  }
  const res = await handleSupportQuestion(String(body.question || ""), String(body.email || ""));
  return NextResponse.json(res);
}
