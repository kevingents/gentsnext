"use client";

import { Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useT } from "@/components/i18n/locale-provider";

/**
 * /punten-claim?bon=<saleId>&t=<token> — landingspagina van de QR/CTA op een
 * anonieme kassabon. Verzilvert de spaarpunten van de bon naar het ingelogde
 * account. Niet ingelogd? Dan vraagt de pagina zelf een magic-inloglink aan met
 * een next terug naar deze pagina, zodat de punten ná het inloggen klaarstaan.
 */

type State =
  | { kind: "loading" }
  | { kind: "ok"; points: number; balance: number; already: boolean }
  | { kind: "login" }
  | { kind: "error"; message: string };

function LoginForm({ next }: { next: string }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim().toLowerCase(), next }),
      });
      const d = await res.json();
      if (d.ok) setSent(true);
      else setErr(d.error || t("common.error"));
    } catch {
      setErr(t("puntenClaim.error.retry"));
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <p className="text-sm text-neutral-600">
        {t("puntenClaim.login.sent")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-neutral-600">
        {t("puntenClaim.login.intro")}
      </p>
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("puntenClaim.login.emailPlaceholder")}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-neutral-900"
      />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60"
      >
        {busy ? t("common.processing") : t("puntenClaim.login.submit")}
      </button>
    </form>
  );
}

function ClaimInner() {
  const t = useT();
  const params = useSearchParams();
  const saleId = params.get("bon") || "";
  const token = params.get("t") || "";
  const [state, setState] = useState<State>({ kind: "loading" });
  const fired = useRef(false);

  useEffect(() => {
    if (!saleId || !token) {
      setState({ kind: "error", message: t("puntenClaim.error.incompleteLink") });
      return;
    }
    if (fired.current) return; // claim precies één keer (StrictMode/dubbelklik)
    fired.current = true;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/account/claim-receipt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ saleId, token }),
        });
        if (cancelled) return;
        if (res.status === 401) {
          setState({ kind: "login" });
          return;
        }
        const d = await res.json();
        if (res.ok && d.ok) {
          setState({ kind: "ok", points: d.points || 0, balance: d.balance || 0, already: !!d.alreadyClaimed });
        } else {
          setState({ kind: "error", message: d.error || t("puntenClaim.error.failed") });
        }
      } catch {
        if (!cancelled) setState({ kind: "error", message: t("forms.error.tryLater") });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [saleId, token]);

  const next = `/punten-claim?bon=${encodeURIComponent(saleId)}&t=${encodeURIComponent(token)}`;

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-6 py-16">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-lg font-semibold tracking-tight text-neutral-900">{t("puntenClaim.title")}</h1>

        {state.kind === "loading" && <p className="mt-3 text-sm text-neutral-500">{t("puntenClaim.claiming")}</p>}

        {state.kind === "login" && (
          <div className="mt-4">
            <LoginForm next={next} />
          </div>
        )}

        {state.kind === "ok" && (
          <div className="mt-3 space-y-3">
            {state.already ? (
              <p className="text-sm text-neutral-700">{t("puntenClaim.already", { balance: state.balance })}</p>
            ) : (
              <p className="text-sm text-neutral-700">
                {t("puntenClaim.success.prefix")} <strong>{t("puntenClaim.success.points", { points: state.points })}</strong> {t("puntenClaim.success.credited")}{" "}
                <strong>{t("puntenClaim.success.balance", { balance: state.balance })}</strong>.
              </p>
            )}
            <Link
              href="/account"
              className="inline-block rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-medium text-white"
            >
              {t("order.to_account")}
            </Link>
          </div>
        )}

        {state.kind === "error" && (
          <div className="mt-3 space-y-3">
            <p className="text-sm text-red-600">{state.message}</p>
            <Link href="/" className="inline-block text-sm text-neutral-600 underline">
              {t("puntenClaim.toShop")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PuntenClaimPage() {
  const t = useT();
  return (
    <Suspense fallback={<div className="px-6 py-16 text-center text-sm text-neutral-500">{t("common.processing")}</div>}>
      <ClaimInner />
    </Suspense>
  );
}
