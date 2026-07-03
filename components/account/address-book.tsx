"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";

export type Address = {
  id: string; label: string; firstName?: string; lastName?: string;
  street: string; houseNumber: string; postalCode: string; city: string; country: string; isDefault: boolean;
};

const EMPTY: Address = { id: "", label: "Thuis", firstName: "", lastName: "", street: "", houseNumber: "", postalCode: "", city: "", country: "NL", isDefault: false };

/** Adresboek met toevoegen/bewerken/verwijderen + standaard kiezen (AVG: eigen adressen). */
export function AddressBook({ addresses }: { addresses: Address[] }) {
  const t = useT();
  const router = useRouter();
  const [editing, setEditing] = useState<null | "new" | string>(null);
  const [form, setForm] = useState<Address>({ ...EMPTY });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const set = (k: keyof Address, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  async function post(body: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/account/addresses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !d?.ok) { setErr(d?.error || t("account.addresses.error.failed")); return false; }
      router.refresh();
      return true;
    } catch {
      setErr(t("account.addresses.error.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const ok = await post({ action: editing === "new" ? "add" : "update", ...form });
    if (ok) setEditing(null);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="font-sans text-sm text-ink-soft">{addresses.length ? (addresses.length === 1 ? t("account.addresses.count.one", { n: addresses.length }) : t("account.addresses.count.other", { n: addresses.length })) : t("account.addresses.empty")}</p>
        {editing === null ? (
          <button type="button" onClick={() => { setForm({ ...EMPTY, label: t("account.addresses.defaultLabel") }); setEditing("new"); setErr(""); }} className="btn-ghost">{t("account.addresses.add")}</button>
        ) : null}
      </div>

      {editing !== null ? (
        <div className="mt-4 border border-line p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("account.addresses.field.label")} v={form.label} on={(v) => set("label", v)} />
            <span className="hidden sm:block" />
            <Field label={t("checkout.firstname")} v={form.firstName ?? ""} on={(v) => set("firstName", v)} />
            <Field label={t("checkout.lastname")} v={form.lastName ?? ""} on={(v) => set("lastName", v)} />
            <Field label={t("checkout.street")} v={form.street} on={(v) => set("street", v)} />
            <Field label={t("checkout.housenumber")} v={form.houseNumber} on={(v) => set("houseNumber", v)} />
            <Field label={t("checkout.postalcode")} v={form.postalCode} on={(v) => set("postalCode", v)} />
            <Field label={t("checkout.city")} v={form.city} on={(v) => set("city", v)} />
            <Field label={t("checkout.country")} v={form.country} on={(v) => set("country", v)} />
          </div>
          <label className="mt-3 flex items-center gap-2 font-sans text-sm">
            <input type="checkbox" checked={form.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />
            {t("account.addresses.setDefault")}
          </label>
          {err ? <p className="mt-2 font-sans text-sm text-danger">{err}</p> : null}
          <div className="mt-4 flex gap-2">
            <button type="button" onClick={save} disabled={busy} className="btn-primary">{busy ? t("common.saving") : t("common.save")}</button>
            <button type="button" onClick={() => { setEditing(null); setErr(""); }} className="btn-ghost">{t("common.cancel")}</button>
          </div>
        </div>
      ) : null}

      {addresses.length ? (
        <ul className="mt-4 grid gap-4 sm:grid-cols-2">
          {addresses.map((a) => (
            <li key={a.id} className="border border-line p-5">
              <div className="flex items-center justify-between">
                <p className="font-medium">{a.label}</p>
                {a.isDefault ? <span className="bg-surface px-2 py-0.5 font-sans text-[0.6rem] uppercase tracking-wide">{t("account.addresses.default")}</span> : null}
              </div>
              <p className="mt-2 font-sans text-sm text-ink-soft">
                {[a.firstName, a.lastName].filter(Boolean).join(" ")}
                {a.firstName || a.lastName ? <br /> : null}
                {a.street} {a.houseNumber}<br />
                {a.postalCode} {a.city}<br />
                {a.country}
              </p>
              <div className="mt-3 flex flex-wrap gap-3 font-sans text-xs">
                <button type="button" onClick={() => { setForm({ ...EMPTY, ...a }); setEditing(a.id); setErr(""); }} className="text-ink underline underline-offset-4">{t("common.edit")}</button>
                {!a.isDefault ? <button type="button" onClick={() => post({ action: "default", id: a.id })} className="text-ink underline underline-offset-4">{t("account.addresses.makeDefault")}</button> : null}
                <button type="button" onClick={() => { if (window.confirm(t("account.addresses.confirmDelete"))) void post({ action: "delete", id: a.id }); }} className="text-danger underline underline-offset-4">{t("common.delete")}</button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Field({ label, v, on }: { label: string; v: string; on: (v: string) => void }) {
  return (
    <label className="block">
      <span className="font-sans text-xs text-muted">{label}</span>
      <input value={v} onChange={(e) => on(e.target.value)} className="mt-1 w-full border border-line bg-canvas px-3 py-2 font-sans text-sm focus:border-ink focus:outline-none" />
    </label>
  );
}
