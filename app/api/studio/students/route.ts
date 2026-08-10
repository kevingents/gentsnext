import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import {
  listStudentActies, saveStudentActie, setStudentActieActief,
  listStudentVerkopen, studentActieTotalen, listStudentLeden, listVerenigingen,
} from "@/lib/student-acties";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/students — PORTAL-kant van de Students-acties (Remy).
 * Auth: admin of STUDIO_API_TOKEN (de portal proxyt met de token).
 *
 *   list                        → { ok, acties, totalen, verenigingen }
 *   save   { id?, actie }       → { ok, actie }        (id leeg = nieuw)
 *   actief { id, actief }       → { ok }
 *   verkopen { actieId? | vereniging? } → { ok, verkopen }
 *   leden  { vereniging? }      → { ok, leden }
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });

  let b: {
    action?: string; id?: string; actief?: boolean; actieId?: string; vereniging?: string;
    actie?: {
      naam?: string; vereniging?: string; winkels?: unknown; producten?: unknown;
      kortingPct?: unknown; vanaf?: string | null; tot?: string | null; actief?: unknown; aangemaaktDoor?: string;
    };
  };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige body." }, { status: 400 });
  }

  try {
    switch (String(b?.action || "")) {
      case "list": {
        const [acties, totalen, verenigingen] = await Promise.all([
          listStudentActies(),
          studentActieTotalen(),
          listVerenigingen(),
        ]);
        return NextResponse.json({ ok: true, acties, totalen, verenigingen });
      }
      case "save": {
        const r = await saveStudentActie(b.id || null, b.actie || {});
        if (!r.ok) return NextResponse.json(r, { status: 400 });
        return NextResponse.json(r);
      }
      case "actief": {
        if (!String(b.id || "").trim()) return NextResponse.json({ ok: false, error: "id vereist." }, { status: 400 });
        await setStudentActieActief(String(b.id), Boolean(b.actief));
        return NextResponse.json({ ok: true });
      }
      case "verkopen": {
        const verkopen = await listStudentVerkopen({ actieId: b.actieId, vereniging: b.vereniging });
        return NextResponse.json({ ok: true, verkopen });
      }
      case "leden": {
        const leden = await listStudentLeden(b.vereniging);
        return NextResponse.json({ ok: true, leden });
      }
      default:
        return NextResponse.json({ ok: false, error: `Onbekende actie "${String(b?.action || "")}".` }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
