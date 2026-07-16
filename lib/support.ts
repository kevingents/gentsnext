import { getDb } from "@/db";
import { supportTickets } from "@/db/schema";
import { emailConfigured } from "@/lib/email";
import { submitWebshopTicket } from "@/lib/helpdesk";

/**
 * AI-klantenservice. Beantwoordt veelvoorkomende vragen direct op basis van een
 * gecureerde kennisbank; lukt dat niet betrouwbaar, dan escaleert het naar de
 * support-mailbox (CONTACT_EMAIL_SERVICE/GENERAL) en krijgt de klant bericht dat
 * een medewerker reageert. Provider-flexibel: Claude (ANTHROPIC_API_KEY) of
 * OpenAI (OPENAI_API_KEY); zonder sleutel wordt elke vraag een ticket.
 */

const KNOWLEDGE = `
GENTS is dé Nederlandse herenmode-specialist voor formele momenten (pakken, overhemden, smoking, accessoires, schoenen). 19 winkels in NL en België + webshop.

VERZENDING & LEVERTIJD:
- Gratis verzending vanaf € 75; daaronder € 4,95.
- Voor 16:00 besteld op werkdagen = vaak dezelfde dag verzonden.
- Standaard levertijd 2-3 werkdagen; vanuit ons magazijn vaak sneller (1-2 werkdagen).
- Snellere levering (express) tegen € 1,50 toeslag, te kiezen bij het afrekenen.
- Een bestelling die deels uit een winkel komt of gesplitst is, kan iets later aankomen.

OPHALEN IN DE WINKEL (click & collect):
- Veel artikelen zijn op voorraad in de winkels; je ziet per winkel of het er ligt en of de winkel open is.

RETOURNEREN:
- Gratis retour binnen 14 dagen, online of in een van de 19 winkels. Volledige terugbetaling.

BETALEN:
- Veilig betalen met iDEAL (via Mollie).

MATEN & PASVORM:
- Maatadvies online (/maatadvies) en in elke winkel. Maattabellen per categorie op de productpagina's.
- Pakken/colberts: modern fit (net aangesloten) of slim fit (strakker). Broekpijp gratis innemen in de winkel.

ACCOUNT:
- Inloggen met een veilige login-link (geen wachtwoord). In je account zie je online- én winkelaankopen, spaarpunten, vouchers en je maatprofiel.

DRESSCODES:
- Uitleg over black tie, white tie, gala, smart casual, jacquet, tenue de ville en promovendus op /pages/etiquette.

CONTACT:
- Telefoon 085 115 50 42, of via de winkels. Voor zakelijke kleding en studentenverenigingen zijn er aparte pagina's.
`;

const SYSTEM = `Je bent de digitale klantenservice van GENTS Herenmode. Beantwoord de vraag van de klant kort, vriendelijk en correct in het Nederlands, UITSLUITEND op basis van de onderstaande kennisbank. Verzin niets. Kun je de vraag niet betrouwbaar beantwoorden met de kennisbank (bv. over een specifieke bestelling, retourstatus, klacht, of iets dat er niet in staat), zet dan "confident" op false. Antwoord ALLEEN met JSON: {"answer": "...", "confident": true|false}.

KENNISBANK:
${KNOWLEDGE}`;

type AiResult = { answer: string; confident: boolean };

async function askClaude(question: string): Promise<AiResult | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM,
        messages: [{ role: "user", content: question }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    const text = j?.content?.[0]?.text || "";
    return parseAi(text);
  } catch {
    return null;
  }
}

async function askOpenAI(question: string): Promise<AiResult | null> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.SUPPORT_MODEL || "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: question }],
      }),
    });
    if (!res.ok) return null;
    const j = await res.json();
    return parseAi(j?.choices?.[0]?.message?.content || "");
  } catch {
    return null;
  }
}

function parseAi(text: string): AiResult | null {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const j = JSON.parse(m[0]);
    if (typeof j.answer === "string") return { answer: j.answer, confident: Boolean(j.confident) };
  } catch {
    /* leeg */
  }
  return null;
}

export type SupportResponse = { answer: string; escalated: boolean };

export async function handleSupportQuestion(question: string, email: string): Promise<SupportResponse> {
  const q = question.trim().slice(0, 1000);
  if (!q) return { answer: "Stel gerust je vraag.", escalated: false };

  const ai = (await askClaude(q)) || (await askOpenAI(q));
  const confident = Boolean(ai?.confident && ai.answer);
  const answer = confident
    ? ai!.answer
    : "Goede vraag — dit pak ik even persoonlijk op. Laat je e-mailadres achter, dan reageert een collega binnen één werkdag.";

  // Analytics/audit-log (NIET de bron voor klant-tickets — die staan sinds de
  // naad-unificatie in de gedeelde helpdesk-store van storegents, gelezen door
  // zowel de agent-inbox als het klant-account). Deze Neon-tabel bewaart de
  // volledige AI-deflectiefunnel — óók de vragen die de AI wél beantwoordde —
  // zodat we het deflectiepercentage kunnen meten. Voor de geëscaleerde vragen
  // is het tevens een laatste vangnet mocht zowel de intake als de mail falen.
  try {
    const db = getDb();
    await db.insert(supportTickets).values({
      email: email.trim().toLowerCase(),
      question: q,
      aiAnswer: confident ? ai!.answer : "",
      confident,
      status: confident ? "answered" : "escalated",
    });
  } catch {
    /* logging mag niet breken */
  }

  // Escalatie → gedeelde helpdesk-store (agent-inbox + klant-account).
  if (!confident) {
    await escalate(q, email, ai?.answer || "");
  }

  return { answer, escalated: !confident };
}

/** Kort, herkenbaar onderwerp voor de agent-inbox — afgeleid van de vraag. */
function deriveSubject(question: string): string {
  const first = question.replace(/\s+/g, " ").trim();
  if (!first) return "Vraag via de website";
  const snippet = first.slice(0, 80);
  return `Vraag via de website: ${snippet}${first.length > 80 ? "…" : ""}`;
}

async function escalate(question: string, email: string, aiAnswer: string): Promise<void> {
  // Primair: schrijf naar de GEDEELDE helpdesk-store (storegents) zodat agent én
  // klant-account de vraag zien. requester.email = de ECHTE klant (join-sleutel),
  // niet RESEND_FROM zoals in de oude, mis-geattribueerde mail-escalatie.
  const ticket = await submitWebshopTicket({
    email,
    subject: deriveSubject(question),
    question,
    aiAnswer, // landt als interne notitie bij de agent, nooit als klant-antwoord
  });
  if (ticket) return;

  // Fallback (intake onbereikbaar/niet geconfigureerd): verlies de vraag niet —
  // mail met de JUISTE klant-identiteit (reply_to = klant). Dit is een vangnet,
  // niet meer de bron van waarheid.
  await escalateByEmailFallback(question, email);
}

async function escalateByEmailFallback(question: string, email: string): Promise<void> {
  const to = process.env.CONTACT_EMAIL_SERVICE || process.env.CONTACT_EMAIL_GENERAL || process.env.CONTACT_EMAIL_B2B;
  if (emailConfigured() && to) {
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.RESEND_FROM,
          to: [to],
          reply_to: email || undefined,
          subject: "Support-vraag (AI kon niet beantwoorden — intake onbereikbaar)",
          text: `Klant: ${email || "onbekend"}\n\nVraag:\n${question}`,
        }),
      });
    } catch (e) {
      console.error("[support] escalatie-mailfout:", e);
    }
  } else {
    console.log("[support] (stub) escalatie:", email, question.slice(0, 120));
  }
}
