"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon } from "@/components/icons";

/**
 * Publieke ticket-volgweergave (geen login). Krijgt het al GEREDIGEERDE ticket
 * server-side aangeleverd (alleen klant-zichtbare thread); reageren gaat via het
 * rate-gelimiteerde /api/vraag/reply met dezelfde ref + token uit de URL.
 */

type Entry = { from: string; text: string; at: string };
type Ticket = {
  ref: string;
  subject: string;
  status: string;
  statusLabel: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  thread: Entry[];
};

function nlDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** Hoever staat het ticket in de tijdlijn (0..3), afgeleid uit status + thread.
 *  We hebben geen assignee/firstResponseAt (die zijn geredigeerd), dus een
 *  GENTS-antwoord in de thread telt als "er is gereageerd". */
function reachedStage(status: string, hasGentsReply: boolean): number {
  if (status === "resolved" || status === "closed") return 3;
  if (status === "pending-customer") return 2;
  if (status === "new") return hasGentsReply ? 2 : 0;
  // open, pending-internal, on-hold
  return hasGentsReply ? 2 : 1;
}

export function VraagVolgen({ ticket, refId, token }: { ticket: Ticket; refId: string; token: string }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const hasGentsReply = ticket.thread.some((e) => e.from === "GENTS");
  const reached = reachedStage(ticket.status, hasGentsReply);
  const isClosed = ticket.status === "closed";

  const steps = [
    { title: "Ontvangen", body: "Je vraag is bij ons binnen." },
    { title: "In behandeling", body: "Een collega bekijkt je vraag." },
    {
      title: ticket.status === "pending-customer" ? "Wacht op jou" : "Beantwoord",
      body: ticket.status === "pending-customer" ? "We wachten op jouw reactie." : "We hebben gereageerd.",
    },
    { title: isClosed ? "Afgesloten" : "Afgehandeld", body: "Deze vraag is afgerond." },
  ];

  async function sendReply() {
    const text = reply.trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/vraag/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref: refId, token, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.ok) {
        setReply("");
        setSent(true);
        // Server component opnieuw ophalen zodat de heropende thread verschijnt.
        router.refresh();
      } else {
        setError(data?.error || "Versturen mislukte — probeer het zo opnieuw.");
      }
    } catch {
      setError("Versturen mislukte — probeer het zo opnieuw.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-gutter py-16">
      <p className="label-brand">Jouw vraag</p>
      <h1 className="mt-2 text-display-md">{ticket.subject || "Je vraag bij GENTS"}</h1>
      <p className="mt-3 font-sans text-sm text-muted">
        {ticket.ref} · aangemaakt {nlDate(ticket.createdAt)}
      </p>

      {/* Status-tijdlijn */}
      <section className="mt-8 rounded-card border border-line bg-surface/50 p-5">
        <p className="label-brand">Status</p>
        <ol className="mt-4 space-y-4">
          {steps.map((step, i) => {
            const done = i < reached;
            const current = i === reached;
            return (
              <li key={i} className="flex gap-4">
                <span
                  className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    done || current ? "bg-ink text-canvas" : "border border-line text-muted"
                  }`}
                  aria-hidden="true"
                >
                  {done ? (
                    <CheckIcon className="h-4 w-4" />
                  ) : current ? (
                    <span className="h-2 w-2 rounded-full bg-canvas" />
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-line" />
                  )}
                </span>
                <div className="min-w-0">
                  <p className={`font-sans text-sm font-medium ${done || current ? "text-ink" : "text-muted"}`}>
                    {step.title}
                    {current ? <span className="ml-2 font-sans text-[0.65rem] uppercase tracking-wide text-ink-soft">nu</span> : null}
                  </p>
                  <p className="mt-0.5 font-sans text-sm leading-relaxed text-ink-soft">{step.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* Conversatie */}
      <section className="mt-10">
        <p className="label-brand">Gesprek</p>
        {ticket.thread.length ? (
          <ul className="mt-4 space-y-3">
            {ticket.thread.map((e, i) => {
              const mine = e.from === "Jij";
              return (
                <li key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-card px-3.5 py-2.5 ${mine ? "bg-ink text-canvas" : "bg-surface text-ink"}`}>
                    <p className="whitespace-pre-wrap font-sans text-sm">{e.text}</p>
                    <p className={`mt-1 font-sans text-[0.65rem] ${mine ? "text-canvas/70" : "text-muted"}`}>
                      {mine ? "Jij" : "GENTS"} · {nlDate(e.at)}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 font-sans text-sm text-muted">Nog geen berichten in dit gesprek.</p>
        )}
      </section>

      {/* Reageren */}
      {isClosed ? (
        <p className="mt-8 font-sans text-sm text-muted">
          Deze vraag is afgesloten. Nieuwe vraag? Mail{" "}
          <a href="mailto:klantenservice@gents.nl" className="text-ink underline underline-offset-4">
            klantenservice@gents.nl
          </a>
          .
        </p>
      ) : (
        <section className="mt-8">
          <label htmlFor="vraag-reply" className="label-brand">
            Reageren
          </label>
          <textarea
            id="vraag-reply"
            rows={3}
            value={reply}
            onChange={(ev) => {
              setReply(ev.target.value);
              if (sent) setSent(false);
            }}
            placeholder="Typ je reactie…"
            className="mt-3 w-full resize-y border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={sendReply} disabled={busy || !reply.trim()} className="btn-primary disabled:opacity-50">
              {busy ? "Versturen…" : "Verstuur reactie"}
            </button>
            {sent ? (
              <span className="inline-flex items-center gap-1.5 font-sans text-sm text-success">
                <CheckIcon className="h-3.5 w-3.5" /> Verstuurd — we hebben je vraag heropend.
              </span>
            ) : null}
            {error ? <span className="font-sans text-sm text-danger">{error}</span> : null}
          </div>
        </section>
      )}
    </div>
  );
}
