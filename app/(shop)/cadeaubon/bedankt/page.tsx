import type { Metadata } from "next";
import Link from "next/link";
import { BrandedState } from "@/components/brand-state";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bedankt voor je cadeaubon", robots: { index: false } };

export default function GiftcardThanksPage() {
  return (
    <BrandedState
      eyebrow="Cadeaubon"
      title="Je cadeaubon is onderweg"
      intro="Zodra je betaling is bevestigd, sturen we de cadeaubon per e-mail naar de ontvanger — meestal binnen een paar minuten. Niets ontvangen? Check de spam of neem gerust contact met ons op."
    >
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">Verder shoppen</Link>
        <Link href="/pages/klantenservice" className="btn-ghost">Klantenservice</Link>
      </div>
    </BrandedState>
  );
}
