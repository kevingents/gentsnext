"use client";

import { useState } from "react";
import { useT } from "@/components/i18n/locale-provider";

/**
 * "Rond je profiel af voor +50 punten" — de klant vult naam/telefoon + maatprofiel
 * in; het token uit de URL is de autorisatie. Bij succes worden de punten éénmalig
 * toegekend (server-side idempotent).
 */
export function ProfileCompletionForm({ token, email }: { token: string; email: string }) {
  const t = useT();
  const [f, setF] = useState({ firstName: "", lastName: "", phone: "", colbert: "", broek: "", overhemd: "", schoen: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ points: number; already: boolean } | null>(null);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const input = "w-full rounded-lg border border-neutral-300 px-3 py-2.5 text-sm outline-none focus:border-neutral-900";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const sizeProfile: Record<string, string> = {};
      for (const k of ["colbert", "broek", "overhemd", "schoen"] as const) if (f[k].trim()) sizeProfile[k] = f[k].trim();
      const res = await fetch("/api/account/profile-completion", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, firstName: f.firstName, lastName: f.lastName, phone: f.phone, sizeProfile }),
      });
      const d = (await res.json().catch(() => ({}))) as { ok?: boolean; points?: number; alreadyClaimed?: boolean; error?: string };
      if (!res.ok || !d.ok) throw new Error(d.error || t("common.error"));
      setDone({ points: d.points || 0, already: !!d.alreadyClaimed });
    } catch (e) {
      setErr(e instanceof Error ? e.message : t("common.error"));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className="mt-8 rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <p className="text-lg font-semibold text-emerald-800">{done.already ? t("profielAfronden.done.updatedTitle") : t("profielAfronden.done.successTitle")}</p>
        <p className="mt-1 text-sm text-emerald-700">{done.already ? t("profielAfronden.done.updatedBody") : t("profielAfronden.done.successBody")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      {email && <p className="text-sm text-neutral-500">{t("profielAfronden.form.for", { email })}</p>}
      <div className="grid grid-cols-2 gap-3">
        <input className={input} placeholder={t("checkout.firstname")} value={f.firstName} onChange={set("firstName")} required />
        <input className={input} placeholder={t("checkout.lastname")} value={f.lastName} onChange={set("lastName")} />
      </div>
      <input className={input} placeholder={t("checkout.phone_optional")} value={f.phone} onChange={set("phone")} />
      <p className="pt-2 text-sm font-medium text-neutral-800">{t("profielAfronden.form.sizesLabel")}</p>
      <div className="grid grid-cols-2 gap-3">
        <input className={input} placeholder={t("profielAfronden.form.jacketPlaceholder")} value={f.colbert} onChange={set("colbert")} />
        <input className={input} placeholder={t("profielAfronden.form.trousersPlaceholder")} value={f.broek} onChange={set("broek")} />
        <input className={input} placeholder={t("profielAfronden.form.shirtPlaceholder")} value={f.overhemd} onChange={set("overhemd")} />
        <input className={input} placeholder={t("profielAfronden.form.shoePlaceholder")} value={f.schoen} onChange={set("schoen")} />
      </div>
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-lg bg-neutral-900 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {busy ? t("common.processing") : t("profielAfronden.form.submit")}
      </button>
    </form>
  );
}
