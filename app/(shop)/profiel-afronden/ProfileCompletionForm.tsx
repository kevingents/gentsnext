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
  // Huisstijl-tokens (line/ink/canvas) i.p.v. generiek neutral-Tailwind.
  const input = "w-full rounded-card border border-line bg-canvas px-3 py-2.5 font-sans text-sm outline-none focus:border-ink";

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
      <div className="mt-8 rounded-card border border-success/40 bg-success/5 p-6 text-center">
        <p className="font-display text-lg font-light text-ink">{done.already ? t("profielAfronden.done.updatedTitle") : t("profielAfronden.done.successTitle")}</p>
        <p className="mt-1 font-sans text-sm text-ink-soft">{done.already ? t("profielAfronden.done.updatedBody") : t("profielAfronden.done.successBody")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-4">
      {email && <p className="font-sans text-sm text-muted">{t("profielAfronden.form.for", { email })}</p>}
      <div className="grid grid-cols-2 gap-3">
        <input className={input} placeholder={t("checkout.firstname")} value={f.firstName} onChange={set("firstName")} required />
        <input className={input} placeholder={t("checkout.lastname")} value={f.lastName} onChange={set("lastName")} />
      </div>
      <input className={input} placeholder={t("checkout.phone_optional")} value={f.phone} onChange={set("phone")} />
      <p className="label-brand pt-2">{t("profielAfronden.form.sizesLabel")}</p>
      <div className="grid grid-cols-2 gap-3">
        <input className={input} placeholder={t("profielAfronden.form.jacketPlaceholder")} value={f.colbert} onChange={set("colbert")} />
        <input className={input} placeholder={t("profielAfronden.form.trousersPlaceholder")} value={f.broek} onChange={set("broek")} />
        <input className={input} placeholder={t("profielAfronden.form.shirtPlaceholder")} value={f.overhemd} onChange={set("overhemd")} />
        <input className={input} placeholder={t("profielAfronden.form.shoePlaceholder")} value={f.schoen} onChange={set("schoen")} />
      </div>
      {err && <p className="font-sans text-sm text-danger">{err}</p>}
      <button type="submit" disabled={busy} className="btn-primary w-full disabled:opacity-50">
        {busy ? t("common.processing") : t("profielAfronden.form.submit")}
      </button>
    </form>
  );
}
