"use client";

import { useState } from "react";

type Lid = {
  email: string;
  naam: string;
  isAdmin: boolean;
  roles: string[];
  permissions: string[];
  isJij: boolean;
};
type Rol = { key: string; label: string; omschrijving: string; permissions: string[] };

/**
 * Rollen toekennen. Bewust simpel: geen losse vinkjes per recht, maar hele
 * rollen — dat voorkomt combinaties die niemand meer kan uitleggen ("wel
 * klantgegevens, geen bestellingen"). De server controleert alles opnieuw.
 */
export function TeamManager({ team, roles }: { team: Lid[]; roles: Rol[] }) {
  const [leden, setLeden] = useState(team);
  const [email, setEmail] = useState("");
  const [nieuweRollen, setNieuweRollen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [melding, setMelding] = useState<{ tekst: string; fout?: boolean } | null>(null);

  async function opslaan(doelEmail: string, rollen: string[]) {
    setBusy(true);
    setMelding(null);
    try {
      const res = await fetch("/api/account/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: doelEmail, roles: rollen }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) {
        setMelding({ tekst: d.error || "Opslaan lukte niet.", fout: true });
        return;
      }
      setLeden((prev) => {
        const bestaat = prev.some((m) => m.email.toLowerCase() === doelEmail.toLowerCase());
        const bijgewerkt = prev
          .map((m) => (m.email.toLowerCase() === doelEmail.toLowerCase() ? { ...m, roles: rollen } : m))
          .filter((m) => m.isAdmin || m.roles.length);
        if (bestaat) return bijgewerkt;
        return rollen.length
          ? [...bijgewerkt, { email: doelEmail, naam: "", isAdmin: false, roles: rollen, permissions: [], isJij: false }]
          : bijgewerkt;
      });
      setMelding({ tekst: rollen.length ? `Rollen opgeslagen voor ${doelEmail}.` : `Toegang ingetrokken voor ${doelEmail}.` });
      setEmail("");
      setNieuweRollen([]);
    } catch {
      setMelding({ tekst: "Opslaan lukte niet — probeer het opnieuw.", fout: true });
    } finally {
      setBusy(false);
    }
  }

  function wissel(lijst: string[], rol: string): string[] {
    return lijst.includes(rol) ? lijst.filter((r) => r !== rol) : [...lijst, rol];
  }

  return (
    <>
      <section className="mt-6 rounded-xl bg-white p-5 shadow-portal">
        <p className="text-xs uppercase tracking-wider text-pslate">Toegang geven</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-sm text-pslate">E-mailadres van de medewerker</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="collega@gents.nl"
              className="mt-1 w-72 rounded-lg border border-pnavy/15 px-3 py-2 text-sm focus:border-pnavy focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {roles.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => setNieuweRollen((p) => wissel(p, r.key))}
                aria-pressed={nieuweRollen.includes(r.key)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  nieuweRollen.includes(r.key) ? "border-pnavy bg-pnavy text-cream" : "border-pnavy/15 text-pslate hover:border-pnavy"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !email.trim() || !nieuweRollen.length}
            onClick={() => opslaan(email.trim(), nieuweRollen)}
            className="rounded-lg bg-pnavy px-4 py-2 text-sm font-medium text-cream disabled:opacity-50"
          >
            Toegang geven
          </button>
        </div>
        {melding ? (
          <p role="status" className={`mt-3 text-sm ${melding.fout ? "text-red-700" : "text-green-700"}`}>{melding.tekst}</p>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl bg-white p-5 shadow-portal">
        <p className="text-xs uppercase tracking-wider text-pslate">Wie heeft nu toegang ({leden.length})</p>
        <ul className="mt-3 divide-y divide-pnavy/10">
          {leden.map((m) => (
            <li key={m.email} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-pnavy">
                    {m.naam || m.email}
                    {m.isJij ? <span className="ml-2 text-xs font-normal text-pslate">(jij)</span> : null}
                  </p>
                  <p className="truncate text-sm text-pslate">{m.email}</p>
                </div>
                {m.isAdmin ? (
                  <span className="rounded-lg border border-pnavy/20 px-2.5 py-1 text-xs uppercase tracking-wide text-pnavy">
                    Beheerder — alle rechten
                  </span>
                ) : m.isJij ? (
                  // Je eigen rollen niet hier: één misklik en je kunt er zelf
                  // niet meer in, zonder scherm om het terug te draaien. De
                  // server weigert dit ook.
                  <span className="text-xs text-pslate">
                    {m.roles.length ? m.roles.map((r) => roles.find((x) => x.key === r)?.label || r).join(" + ") : "Geen rol"} — je eigen
                    toegang wijzig je niet zelf
                  </span>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {roles.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        disabled={busy}
                        onClick={() => opslaan(m.email, wissel(m.roles, r.key))}
                        aria-pressed={m.roles.includes(r.key)}
                        className={`rounded-lg border px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
                          m.roles.includes(r.key) ? "border-pnavy bg-pnavy text-cream" : "border-pnavy/15 text-pslate hover:border-pnavy"
                        }`}
                      >
                        {r.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`Alle toegang van ${m.email} intrekken?`)) opslaan(m.email, []);
                      }}
                      className="rounded-lg px-2.5 py-1 text-xs text-red-700 underline underline-offset-4 disabled:opacity-50"
                    >
                      Toegang intrekken
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
          {!leden.length ? <li className="py-3 text-sm text-pslate">Nog niemand met een rol.</li> : null}
        </ul>
      </section>
    </>
  );
}
