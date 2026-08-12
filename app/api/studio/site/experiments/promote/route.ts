import { NextResponse } from "next/server";
import { adminOrToken } from "@/lib/studio-token";
import { setContentDoc } from "@/lib/content-store";
import { docVersion, CONFLICT_MESSAGE } from "@/lib/content-version";
import { getExperiments, homepageVariantKey, type ExperimentsDoc } from "@/lib/experiments";
import { getSiteSettings, updateSiteSettings } from "@/lib/site-settings";
import { getHomeLayout } from "@/lib/homepage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/studio/site/experiments/promote — de winnaar doorvoeren.
 * body { id, variant, version? }
 *
 * Wat de variant overschreef wordt de echte site: balk/hero/USP's gaan als
 * patch de site-instellingen in, en een eigen indeling wordt gekopieerd naar
 * het live homepage-document. Daarna gaat het experiment op "gestopt" — de
 * winnaar draait dan voor 100% van de bezoekers, en het meetvenster sluit.
 *
 * Bewust géén verwijdering van het experiment of het variant-document: de
 * uitslag en de indeling blijven naleesbaar. De controle promoten kan ook —
 * dat is gewoon "stop, houd het origineel".
 *
 * De version is de stempel van het experimenten-document: doorvoeren op basis
 * van een verouderde lijst zou een tussentijdse wijziging overschrijven.
 * Auth: gentsnext-admin OF STUDIO_API_TOKEN.
 */
export async function POST(req: Request) {
  if (!(await adminOrToken(req))) {
    return NextResponse.json({ ok: false, error: "Geen toegang." }, { status: 403 });
  }
  let body: { id?: unknown; variant?: unknown; version?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, error: "Ongeldige aanvraag." }, { status: 400 });
  }
  const id = String(body.id ?? "").trim().toLowerCase();
  const variantKey = String(body.variant ?? "").trim().toUpperCase();
  if (!/^[a-z0-9-]{1,40}$/.test(id) || !variantKey) {
    return NextResponse.json({ ok: false, error: "Geen geldig experiment of variant." }, { status: 400 });
  }

  try {
    const doc = (await getExperiments()) as ExperimentsDoc;
    if (typeof body.version === "string" && body.version && body.version !== docVersion(doc.experimenten)) {
      return NextResponse.json({ ok: false, error: CONFLICT_MESSAGE, conflict: true }, { status: 409 });
    }
    const exp = doc.experimenten.find((e) => e.id === id);
    if (!exp) return NextResponse.json({ ok: false, error: "Experiment bestaat niet." }, { status: 404 });
    const variant = exp.varianten.find((v) => v.key === variantKey);
    if (!variant) return NextResponse.json({ ok: false, error: "Variant bestaat niet." }, { status: 404 });

    const o = variant.overrides;
    const doorgevoerd: string[] = [];

    if (o?.announcement) {
      await updateSiteSettings({
        announcement: {
          text: o.announcement.text ?? "",
          linkLabel: o.announcement.linkLabel,
          linkHref: o.announcement.linkHref,
        },
      });
      doorgevoerd.push("aankondigingsbalk");
    }

    if (o?.hero) {
      // Losse override-velden over de huidige hero heen — de patch vervangt het
      // hele hero-object, dus eerst mergen met wat er nu staat.
      const huidig = (await getSiteSettings()).hero;
      await updateSiteSettings({
        hero: {
          ...huidig,
          eyebrow: o.hero.eyebrow ?? huidig.eyebrow,
          title: o.hero.title ?? huidig.title,
          subtitle: o.hero.subtitle ?? huidig.subtitle,
          videoUrl: o.hero.videoUrl ?? huidig.videoUrl,
          videoUrlMobile: o.hero.videoUrlMobile ?? huidig.videoUrlMobile,
          posterUrl: o.hero.posterUrl ?? huidig.posterUrl,
          primary: {
            label: o.hero.primaryLabel ?? huidig.primary.label,
            href: o.hero.primaryHref ?? huidig.primary.href,
          },
          secondary:
            o.hero.secondaryLabel || o.hero.secondaryHref
              ? {
                  label: o.hero.secondaryLabel ?? huidig.secondary?.label ?? "",
                  href: o.hero.secondaryHref ?? huidig.secondary?.href ?? "",
                }
              : huidig.secondary,
        },
      });
      doorgevoerd.push("hero");
    }

    if (o?.usps?.length) {
      await updateSiteSettings({ usps: o.usps });
      doorgevoerd.push("USP's");
    }

    if (o?.eigenIndeling) {
      const layout = await getHomeLayout(homepageVariantKey(exp.id, variant.key));
      await setContentDoc("homepage", layout);
      doorgevoerd.push("homepage-indeling");
    }

    // Experiment stoppen — de winnaar draait nu voor iedereen. De POST-route
    // stempelt normaal, maar dit pad schrijft direct; dus zelf gestoptOp zetten.
    exp.status = "gestopt";
    exp.gestoptOp = exp.gestoptOp ?? new Date().toISOString();
    await setContentDoc("experiments", doc);

    const { experimenten } = await getExperiments();
    return NextResponse.json({
      ok: true,
      doorgevoerd,
      experimenten,
      version: docVersion(experimenten),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
