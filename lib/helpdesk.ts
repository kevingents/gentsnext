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
 *   STORE_CORE_TOKEN         (gedeeld met storegents; voor de webshop-intake)
 */

const BASE = (process.env.STOREGENTS_API_URL || "https://storegents.vercel.app").replace(/\/$/, "");
const SECRET = process.env.STOREGENTS_PORTAL_SECRET || "";
const CORE_TOKEN = process.env.STORE_CORE_TOKEN || "";

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

export type WebshopTicketInput = {
  email: string;
  name?: string;
  subject?: string;
  question: string;
  aiAnswer?: string;
  clientRef?: string;
};

/**
 * Escaleer een webshop-vraag naar de GEDEELDE helpdesk-store (storegents), zodat
 * dezelfde vraag zichtbaar wordt in de agent-inbox én in het klant-account
 * ("Mijn vragen"). Server-to-server met het gedeelde STORE_CORE_TOKEN (Bearer) —
 * hetzelfde token/patroon waarmee de kassa de gentsnext-core aanroept, hier
 * gespiegeld. Retour: het ticket-ref bij succes, anders null (dan valt de
 * aanroeper terug op de mail-escalatie zodat de vraag niet verloren gaat).
 */
export async function submitWebshopTicket(input: WebshopTicketInput): Promise<{ ref: string } | null> {
  if (!CORE_TOKEN || !input.email || !input.question) return null;
  try {
    const res = await fetch(`${BASE}/api/helpdesk-intake`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CORE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        name: input.name || "",
        subject: input.subject || "",
        question: input.question,
        aiAnswer: input.aiAnswer || "",
        source: "webshop",
        clientRef: input.clientRef || "",
      }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (!data || data.success === false) return null;
    return { ref: String(data.ref || "") };
  } catch {
    return null;
  }
}

export type FollowLookup = { email: string; ticket: CustomerTicket };

/**
 * Zoekt één ticket op REF voor de publieke volg-link (/vraag/<ref>?t=<token>).
 * SERVER-SIDE only: retourneert het geredigeerde ticket + het requester-e-mail
 * (nodig om de volg-token te verifiëren met lib/ticket-follow — dat e-mailadres
 * verlaat de server nooit richting de browser). null als niet gevonden of niet
 * geconfigureerd.
 */
export async function fetchTicketForFollow(ref: string): Promise<FollowLookup | null> {
  if (!SECRET || !ref) return null;
  try {
    const res = await fetch(`${BASE}/api/customer-ticket-follow?ref=${encodeURIComponent(ref)}`, {
      headers: { "x-portal-secret": SECRET },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (!data?.success || !data.email || !data.ticket) return null;
    return { email: String(data.email), ticket: data.ticket as CustomerTicket };
  } catch {
    return null;
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
