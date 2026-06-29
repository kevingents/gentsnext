import type { Metadata } from "next";
import Link from "next/link";
import { SizeAdvisor } from "@/components/maatadvies/size-advisor";

export const metadata: Metadata = {
  title: "Maatadvies — vind jouw maat",
  description:
    "Vind in een paar stappen je colbert-, lengte- en boordmaat. Het maatadvies van GENTS helpt je aan de juiste pasvorm.",
  alternates: { canonical: "/maatadvies" },
};

export default function MaatadviesPage() {
  return (
    <div className="mx-auto max-w-page px-gutter py-14">
      <div className="max-w-2xl">
        <p className="label-brand">Maatadvies</p>
        <h1 className="mt-2 text-display-lg">Vind jouw maat</h1>
        <p className="mt-4 font-sans text-ink-soft">
          Onze maattabellen lopen van colbertmaten en lengtematen tot boordmaten —
          niet altijd even overzichtelijk. Vul je gegevens in en wij vertalen ze
          naar de juiste maat per onderdeel.
        </p>
        <p className="mt-3 font-sans text-sm text-ink-soft">
          Liever zelf de tabellen bekijken?{" "}
          <Link href="/maattabellen" className="text-ink underline underline-offset-4">
            Bekijk alle maattabellen
          </Link>
          .
        </p>
      </div>
      <div className="mt-12">
        <SizeAdvisor />
      </div>
    </div>
  );
}
