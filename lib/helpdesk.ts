/**
 * Helpdesk-koppeling met de GENTS-portal (storegents).
 *
 * De klant ziet z'n eigen klantenservice-tickets in z'n account. We halen ze
 * SERVER-SIDE op met de geverifieerde sessie-e-mail (nooit door de klant op te
 * geven) + een gedeeld portal-secret. Het secret verlaat de server nooit.
 *
 * Zet in Vercel:
 *   STOREGENTS_API_URL       (default https://storegents.vercel.app)
 *   STOREGENTS_PORTAL_SECRET (= CUSTOMER_PORTAL_SECRET in storegents)
 */

const BASE = (process.env.STOREGENTS_API_URL || "https://storegents.vercel.app").replace(/\/$/, "");
const SECRET = process.env.STOREGENTS_PORTAL_SECRET || "";

export type TicketEntry = { from: string; text: string; at: string };
export type CustomerTicket = {
  ref: string;
  subject: string;
  status: string;
  statusLabel: string;
  category: string;
  createdAt: string;
  updatedAt: string;
  thread: TicketEntry[];
};

/** Tickets van de klant (geredigeerd: alleen klant-zichtbare berichten). */
export async function fetchCustomerTickets(email: string): Promise<CustomerTicket[]> {
  if (!SECRET || !email) return [];
  try {
    const res = await fetch(`${BASE}/api/customer-tickets?email=${encodeURIComponent(email)}`, {
      headers: { "x-portal-secret": SECRET },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    return Array.isArray(data?.tickets) ? (data.tickets as CustomerTicket[]) : [];
  } catch {
    return [];
  }
}

/** Klant voegt een reactie toe aan z'n eigen ticket. */
export async function replyToCustomerTicket(email: string, ref: string, text: string): Promise<boolean> {
  if (!SECRET || !email || !ref || !text) return false;
  try {
    const res = await fetch(`${BASE}/api/customer-tickets`, {
      method: "POST",
      headers: { "x-portal-secret": SECRET, "Content-Type": "application/json" },
      body: JSON.stringify({ email, ticketRef: ref, text }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
