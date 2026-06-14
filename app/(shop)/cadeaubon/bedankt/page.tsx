import type { Metadata } from "next";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Bedankt voor je cadeaubon", robots: { index: false } };

export default function GiftcardThanksPage() {
  return (
    <div className="mx-auto max-w-2xl px-gutter py-20 text-center">
      <p className="label-brand">Bedankt</p>
      <h1 className="mt-2 text-display-md">Je cadeaubon is onderweg</h1>
      <p className="mt-4 font-sans text-ink-soft">
        Zodra je betaling is bevestigd, sturen we de cadeaubon per e-mail naar de ontvanger — meestal binnen een paar minuten. Niets ontvangen? Check de spam of neem gerust contact met ons op.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link href="/" className="btn-primary">Verder shoppen</Link>
        <Link href="/pages/klantenservice" className="btn-ghost">Klantenservice</Link>
      </div>
    </div>
  );
}
