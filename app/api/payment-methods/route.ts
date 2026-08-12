import { NextResponse } from "next/server";
import { getMollieMethods } from "@/lib/mollie";
import { getSettings } from "@/lib/settings";
import { resolveAb } from "@/lib/experiments";
import { topFor, type PaymentChoice } from "@/lib/payment-methods";

export const dynamic = "force-dynamic";

/**
 * De betaalkeuze voor de afrekenpagina: de actieve Mollie-methoden plus de
 * kopgroep die bovenaan hoort te staan.
 *
 * Waarom hier en niet in de browser: de kopgroep hangt aan het bezorgland én aan
 * een eventueel lopend experiment, en dat laatste zit in de ab-cookie die alleen
 * de server leest. Zo blijft er ook maar één plek waar de volgorde bepaald wordt.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const amount = Number(url.searchParams.get("amount")) || undefined;
  const land = url.searchParams.get("land") || "";

  const [methods, settings, ab] = await Promise.all([getMollieMethods(amount), getSettings(), resolveAb()]);

  // Een variant mag de volgorde per land overschrijven; wat hij niet noemt blijft
  // gewoon de ingestelde volgorde.
  const override = ab.overrides.betaalmethoden;
  const cfg = {
    topByCountry: { ...settings.paymentTop.topByCountry, ...(override?.topByCountry || {}) },
    maxVisible: override?.maxVisible ?? settings.paymentTop.maxVisible,
  };

  // Alleen experimenten die de betaalkeuze écht aanpassen loggen exposure hier —
  // wie de homepage-variant zag maar niets anders hoort niet in deze noemer.
  // Geforceerde previews (?ab=) tellen nooit mee.
  const exposure = ab.assignments
    .filter((a) => !a.forced && a.overrides?.betaalmethoden)
    .map((a) => ({ id: a.id, variant: a.variant }));

  const body: PaymentChoice = {
    methods,
    top: topFor(cfg, land),
    maxVisible: cfg.maxVisible,
    ab: exposure,
  };
  return NextResponse.json(body);
}
