import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionCustomer } from "@/lib/account";
import { can } from "@/lib/permissions";
import { GeenToegang } from "@/components/account/geen-toegang";
import { BackofficeShell } from "@/components/account/report-ui";
import { MediaThemesManager } from "@/components/account/media-themes-manager";
import { getMediaThemes, BRAND_RULES, REALISM_RULE, shoesFor } from "@/lib/media-themes";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Beeldthema's", robots: { index: false, follow: false } };

export default async function BeeldthemasPage() {
  const customer = await getSessionCustomer();
  if (!customer) redirect("/account/login");
  if (!can(customer, "presentatie")) {
    return <GeenToegang permission="presentatie" />;
  }

  const store = await getMediaThemes();
  const categories = Object.keys(BRAND_RULES);

  return (
    <BackofficeShell active="/account/beeldthemas" title="Beeldthema's">
      <p className="font-sans text-sm text-pslate">
        Bepaalt hoe de AI-sfeerbeelden eruitzien. Een <strong className="text-pnavy">thema</strong> is de omgeving, een{" "}
        <strong className="text-pnavy">camerastijl</strong> is het licht en de uitsnede — die twee worden gecombineerd,
        dus je krijgt thema&apos;s × stijlen aan verschillende looks. Wijzigingen gelden vanaf de volgende generatie-run;
        bestaande beelden blijven staan tot je ze opnieuw laat maken.
      </p>
      <div className="rounded-xl border border-pnavy-100 bg-white p-5 shadow-portal">
        <MediaThemesManager
          initial={store}
          categories={categories}
          previewParts={{ brandRule: BRAND_RULES.Colberts(shoesFor("navy")), realism: REALISM_RULE }}
        />
      </div>
    </BackofficeShell>
  );
}
