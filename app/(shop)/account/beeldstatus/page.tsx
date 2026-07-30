import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { BackofficeShell, Section } from "@/components/account/report-ui";
import { getBeeldStatus, type BeeldStatusRegel } from "@/lib/beeld-status";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Beeldstatus", robots: { index: false, follow: false } };

const nl = (n: number) => n.toLocaleString("nl-NL");

export default async function BeeldStatusPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "presentatie")) {
    return <GeenToegang permission="presentatie" />;
  }

  const { totalen, aiPerHoofdgroep, aiRegels, geenRegels } = await getBeeldStatus(100);
  const totaalProducten = totalen.echt.producten + totalen.ai.producten + totalen.geen.producten;
  const pct = (n: number) => (totaalProducten ? Math.round((n / totaalProducten) * 100) : 0);

  return (
    <BackofficeShell active="/account/beeldstatus" title="Beeldstatus">
      <p className="font-sans text-sm text-pslate">
        Welk deel van de catalogus staat online met een <strong className="text-pnavy">echte foto</strong>, welk deel
        leunt op een <strong className="text-pnavy">door AI verzonnen packshot</strong>, en wat is er helemaal
        onzichtbaar. De winkel toont alleen artikelen mét beeld — geen foto is geen omzet.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <Kaart label="Echte productfoto" producten={totalen.echt.producten} stuks={totalen.echt.stuks} pct={pct(totalen.echt.producten)} toon="goed" />
        <Kaart label="Alleen een AI-packshot" producten={totalen.ai.producten} stuks={totalen.ai.stuks} pct={pct(totalen.ai.producten)} toon="let-op" />
        <Kaart label="Geen enkel beeld" producten={totalen.geen.producten} stuks={totalen.geen.stuks} pct={pct(totalen.geen.producten)} toon="uit" />
      </div>

      <div className="mt-4 rounded-xl border border-pnavy-100 bg-white p-4 text-sm text-pslate shadow-portal">
        <p>
          Een AI-packshot staat er alleen als er géén geïmporteerde productfoto is — het beeld verving dus niets,
          het vulde een gat. Haal je het weg, dan verdwijnen deze artikelen volledig uit de webshop, inclusief{" "}
          {nl(totalen.ai.stuks)} stuks voorraad.{" "}
          <span className="text-muted">
            (Bij de laatste controle van de Shopify-media-dump, 12 juni 2026, bestond er voor geen van deze
            artikelen elders een echte foto — sindsdien aangeleverde fotografie telt dit overzicht vanzelf mee
            als &quot;echte productfoto&quot;.)
          </span>
        </p>
      </div>

      <div className="mt-6">
        <Section title={`Alleen AI-beeld — per afdeling (${aiPerHoofdgroep.length})`}>
          <table className="w-full border-collapse font-sans text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <th className="py-1.5">Afdeling</th>
                <th className="py-1.5 text-right">Artikelen</th>
                <th className="py-1.5 text-right">Voorraad</th>
              </tr>
            </thead>
            <tbody>
              {aiPerHoofdgroep.map((r) => (
                <tr key={r.hoofdgroep} className="border-b border-line/60">
                  <td className="py-1.5">{r.hoofdgroep}</td>
                  <td className="py-1.5 text-right tabular-nums">{nl(r.producten)}</td>
                  <td className="py-1.5 text-right tabular-nums">{nl(r.stuks)}</td>
                </tr>
              ))}
              {!aiPerHoofdgroep.length ? (
                <tr><td colSpan={3} className="py-4 text-center text-muted">Geen artikelen met alleen een AI-beeld.</td></tr>
              ) : null}
            </tbody>
          </table>
        </Section>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Lijst
          titel="Alleen AI-beeld — meeste voorraad eerst"
          uitleg="Hier levert een echte fotoshoot het meeste op: de voorraad ligt er al."
          regels={aiRegels}
          totaal={totalen.ai.producten}
        />
        <Lijst
          titel="Geen enkel beeld — niet zichtbaar in de winkel"
          uitleg="Deze artikelen staan nergens op de site, want de catalogus eist een foto."
          regels={geenRegels}
          totaal={totalen.geen.producten}
        />
      </div>
    </BackofficeShell>
  );
}

function Kaart({
  label,
  producten,
  stuks,
  pct,
  toon,
}: {
  label: string;
  producten: number;
  stuks: number;
  pct: number;
  toon: "goed" | "let-op" | "uit";
}) {
  const rand = toon === "goed" ? "border-l-success" : toon === "let-op" ? "border-l-pnavy" : "border-l-danger";
  return (
    <div className={`rounded-xl border border-pnavy-100 border-l-4 ${rand} bg-white p-4 shadow-portal`}>
      <p className="text-xs uppercase tracking-wider text-pslate">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-pnavy">{nl(producten)}</p>
      <p className="mt-0.5 font-sans text-xs text-pslate">
        {pct}% van de catalogus · {nl(stuks)} stuks voorraad
      </p>
    </div>
  );
}

function Lijst({
  titel,
  uitleg,
  regels,
  totaal,
}: {
  titel: string;
  uitleg: string;
  regels: BeeldStatusRegel[];
  totaal: number;
}) {
  return (
    <Section title={titel}>
      <p className="mb-2 font-sans text-xs text-pslate">{uitleg}</p>
      <div className="max-h-[30rem] overflow-y-auto">
        <table className="w-full border-collapse font-sans text-sm">
          <thead className="sticky top-0 bg-canvas">
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <th className="py-1.5 pr-2">Artikel</th>
              <th className="py-1.5 text-right">Voorraad</th>
              <th className="py-1.5 pl-2 text-right">Online</th>
            </tr>
          </thead>
          <tbody>
            {regels.map((r) => (
              <tr key={r.handle} className="border-b border-line/60">
                <td className="py-1.5 pr-2">
                  <Link href={`/products/${r.handle}`} className="block max-w-[18rem] truncate hover:underline" target="_blank">
                    {r.title}
                  </Link>
                  <span className="block text-xs text-muted">{r.hoofdgroep}</span>
                </td>
                <td className="py-1.5 text-right tabular-nums">{nl(r.stockQty)}</td>
                <td className="py-1.5 pl-2 text-right text-xs">{r.opWebsite ? "ja" : "nee"}</td>
              </tr>
            ))}
            {!regels.length ? (
              <tr><td colSpan={3} className="py-4 text-center text-muted">Niets gevonden.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {totaal > regels.length ? (
        <p className="mt-2 font-sans text-xs text-muted">
          {nl(regels.length)} van {nl(totaal)} getoond — de rest heeft minder voorraad.
        </p>
      ) : null}
    </Section>
  );
}
