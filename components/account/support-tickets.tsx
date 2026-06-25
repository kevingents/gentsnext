"use client";

import { useEffect, useState } from "react";

type Entry = { from: string; text: string; at: string };
type Ticket = {
  ref: string; subject: string; status: string; statusLabel: string; category: string;
  createdAt: string; updatedAt: string; thread: Entry[];
};

function nlDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
  } catch {
    return iso;
  }
}

const OPEN_STATUSES = new Set(["new", "open", "pending-customer", "pending-internal", "on-hold"]);

export function SupportTickets() {
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/account/tickets", { cache: "no-store" });
      const d = await res.json();
      setTickets(Array.isArray(d.tickets) ? d.tickets : []);
    } catch {
      setTickets([]);
    }
  }
  useEffect(() => { load(); }, []);

  async function sendReply(ref: string) {
    const text = reply.trim();
    if (!text) return;
    setBusy(true);
    try {
      const res = await fetch("/api/account/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ref, text }),
      });
      if (res.ok) { setReply(""); await load(); }
    } finally {
      setBusy(false);
    }
  }

  if (tickets === null) {
    return <p className="font-sans text-sm text-muted">Bezig met laden…</p>;
  }

  if (!tickets.length) {
    return (
      <div className="border border-dashed border-line p-10 text-center">
        <p className="font-display text-xl font-light">Geen vragen of meldingen</p>
        <p className="mx-auto mt-2 max-w-md font-sans text-sm text-ink-soft">
          Hier zie je je contact met onze klantenservice — vragen over je bestelling, retour of
          ander. Een nieuwe vraag? Mail{" "}
          <a href="mailto:klantenservice@gents.nl" className="text-ink underline">klantenservice@gents.nl</a>{" "}
          en we maken er een ticket van.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="font-sans text-sm text-ink-soft">
        Je contact met onze klantenservice. Klik een vraag open om het gesprek te lezen of te reageren.
      </p>
      <ul className="space-y-3">
        {tickets.map((t) => {
          const isOpen = openRef === t.ref;
          const stillOpen = OPEN_STATUSES.has(t.status);
          return (
            <li key={t.ref} className="border border-line">
              <button
                type="button"
                onClick={() => { setOpenRef(isOpen ? null : t.ref); setReply(""); }}
                className="flex w-full flex-wrap items-center justify-between gap-2 p-4 text-left transition-colors hover:bg-surface"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink">{t.subject || "Vraag"}</span>
                  <span className="font-sans text-xs text-muted">{t.ref} · {nlDate(t.createdAt)}</span>
                </span>
                <span className={`shrink-0 px-2 py-0.5 font-sans text-[0.65rem] uppercase tracking-wide ${stillOpen ? "bg-ink text-canvas" : "border border-line text-muted"}`}>
                  {t.statusLabel}
                </span>
              </button>

              {isOpen ? (
                <div className="border-t border-line p-4">
                  {t.thread.length ? (
                    <ul className="space-y-3">
                      {t.thread.map((e, i) => {
                        const mine = e.from === "Jij";
                        return (
                          <li key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                            <div className={`max-w-[85%] px-3 py-2 ${mine ? "bg-ink text-canvas" : "bg-surface text-ink"}`}>
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
                    <p className="font-sans text-sm text-muted">Nog geen berichten in dit ticket.</p>
                  )}

                  {t.status !== "closed" ? (
                    <div className="mt-4">
                      <textarea
                        rows={3}
                        value={reply}
                        onChange={(e) => setReply(e.target.value)}
                        placeholder="Schrijf een reactie…"
                        className="w-full resize-y border border-line bg-canvas px-3 py-2.5 font-sans text-sm focus:border-ink focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => sendReply(t.ref)}
                        disabled={busy || !reply.trim()}
                        className="btn-primary mt-2 disabled:opacity-50"
                      >
                        {busy ? "Versturen…" : "Verstuur reactie"}
                      </button>
                    </div>
                  ) : (
                    <p className="mt-4 font-sans text-xs text-muted">Dit ticket is afgesloten. Mail klantenservice@gents.nl voor een nieuwe vraag.</p>
                  )}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
