/**
 * Zet de Nederlandse notitie van een medewerker om in één korte, POSITIEVE
 * Engelse instructie voor een beeldgenerator. Gedeeld door de modellen-studio
 * (lib/model-learnings.ts) en de sfeerbeeld-studio (lib/visual-learnings.ts).
 *
 * Dit is de kern van "mijn feedback doet niks": een beeldmodel volgt geen
 * ontkenningen. "De mouwen zijn te lang" als "avoid long sleeves" de prompt in
 * duwen levert vaak juist lange mouwen op, want het model ziet vooral de woorden
 * "long sleeves". Erger nog is een notitie die al positief bedoeld was — "het is
 * beter als de kraag een beetje open staat" werd "avoid: het is beter als de
 * kraag een beetje open staat", oftewel precies het tegenovergestelde van wat er
 * gevraagd werd. We laten Claude er daarom "collar worn slightly open at the
 * neck" van maken.
 *
 * Faalt de omzetting (geen key, time-out, rare output), dan geeft dit null terug
 * en valt de aanroeper terug op de categorie-regel — nooit een harde fout,
 * feedback opslaan mag hier niet op stuklopen.
 */

/** Waar de notitie over gaat, in woorden die de omzetter begrijpt. */
export const DIRECTIVE_SUBJECTS: Record<string, string> = {
  model: "the male model (face, age, build, pose, hands, styling of the person)",
  garment: "the garment (fit, length, colour, fabric, details, how it is worn)",
  kleding: "the clothing in the photo (fit, colour, how it is worn, and the rest of the outfit around the featured item)",
  beeld: "the photo itself (background, setting, mood, lighting, composition, image quality)",
};

export function hasDirectiveProvider(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
}

/**
 * De omzetter kreeg te horen dat hij geen ontkenningen mag gebruiken, maar deed
 * het toch: 11 van de eerste 26 omgezette notities eindigden alsnog op "…, not
 * matching the jacket" of "…, not smooth or flat". Precies de vorm die we wilden
 * wegnemen. Vragen is dus niet genoeg — we controleren het na.
 */
export const NEGATIE = /\b(not|never|avoid|avoids|avoiding|without|no|nor|less|isn't|aren't|don't|doesn't)\b/i;

/** Knipt een ontkennende staart eraf: "X, not Y" → "X". */
export function knipOntkenning(s: string): string {
  const zonder = s
    .replace(/\s*[,;–—-]\s*(?:and\s+|but\s+|so\s+)?(?:not|never|without|avoiding|no longer)\b.*$/i, "")
    .replace(/\s+(?:and|but)\s+(?:not|never|without)\b.*$/i, "")
    .trim()
    .replace(/[,;]$/, "");
  return zonder;
}

export async function toDirective(reason: string, category: string, topic: string): Promise<string | null> {
  const text = String(reason || "").trim();
  if (text.length < 3) return null;

  const eerste = await vraagOmzetting(reason, category, topic, false);
  if (eerste === null) return null;
  if (!NEGATIE.test(eerste)) return eerste;

  // Ontkenning erin: één keer opnieuw, nu met de fout er expliciet bij.
  const tweede = await vraagOmzetting(reason, category, topic, true);
  if (tweede && !NEGATIE.test(tweede)) return tweede;

  // Nog steeds ontkennend → de staart eraf. Blijft er niets bruikbaars over, dan
  // liever null: de aanroeper valt dan terug op de categorie-regel, en die is
  // altijd positief geformuleerd.
  const geknipt = knipOntkenning(tweede || eerste);
  return geknipt.length > 8 && !NEGATIE.test(geknipt) ? geknipt : null;
}

async function vraagOmzetting(reason: string, category: string, topic: string, strenger: boolean): Promise<string | null> {
  const text = String(reason || "").trim();
  const subject = DIRECTIVE_SUBJECTS[topic] || DIRECTIVE_SUBJECTS.beeld;
  const sys =
    `You rewrite Dutch feedback from a menswear photo studio into ONE short English instruction for an AI image generator. ` +
    `The feedback is about ${subject}. Rules: ` +
    `phrase it POSITIVELY as what the new photo MUST show — never use "no", "not", "avoid", "without" or "less", because image models ignore negations and render exactly what you name ` +
    `(example: "het jasje is te lang" becomes "jacket length ends just below the seat, classic menswear proportions"); ` +
    `note that the feedback may already be phrased as a wish ("het is beter als de kraag een beetje open staat") — then simply restate it as the instruction; ` +
    `MOST NOTES CONTAIN BOTH A COMPLAINT AND AN INSTRUCTION ("de broek hoort niet bij het jasje, doe er een normale broek onder", "… dus zorg ervoor dat het model een smokingpantalon draagt") — ` +
    `the instruction is the part that matters, build your answer on that and ignore the complaint; ` +
    `NEVER turn a complaint into its opposite: "de broek hoort niet bij het jasje" does NOT mean the trousers should match the jacket, it means the trousers currently shown are wrong — ` +
    `if the note gives no instruction, describe the correct end state for a well-dressed man instead of inverting the complaint; ` +
    `stay concrete and visual; max 20 words; no quotes, no explanation, no trailing period. Return ONLY the instruction.` +
    (strenger
      ? ` Your previous answer contained a negation. State ONLY the desired end state. ` +
        `"trousers in a contrasting colour, not matching the jacket" must become "trousers in a contrasting colour"; ` +
        `"fabric shows texture, not smooth" must become "fabric shows visible woven texture". ` +
        `The words no, not, never, avoid, without and less may NOT appear anywhere in your answer.`
      : "");
  const user = `Categorie: ${category}\nNotitie: ${text}`;

  const anth = process.env.ANTHROPIC_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  try {
    let out = "";
    if (anth) {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": anth, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.CONTENT_MODEL || process.env.SUPPORT_MODEL || "claude-haiku-4-5-20251001",
          max_tokens: 120,
          temperature: 0,
          system: sys,
          messages: [{ role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return null;
      out = (await r.json())?.content?.[0]?.text || "";
    } else if (oai) {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${oai}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0,
          messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) return null;
      out = (await r.json())?.choices?.[0]?.message?.content || "";
    } else {
      return null;
    }
    const one = out.trim().split("\n")[0].replace(/^["']|["'.]+$/g, "").trim();
    return one.length > 2 ? one.slice(0, 200) : null;
  } catch {
    return null;
  }
}
