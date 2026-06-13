import "@/lib/load-env";
import { getDb } from "@/db";
import { products, productTranslations } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";

/**
 * AI-vertaling van producttitels naar een doeltaal. Vertaalt alleen wat nog
 * geen vertaling heeft (idempotent), in batches. Provider: Claude
 * (ANTHROPIC_API_KEY) of OpenAI (OPENAI_API_KEY).
 *   npm run translate:catalog -- en        (of de, fr, es)
 */

const LANG_NAME: Record<string, string> = { en: "English", de: "German", fr: "French", es: "Spanish" };

async function translateBatch(titles: string[], lang: string): Promise<string[]> {
  const sys = `You translate Dutch menswear product titles to ${lang}. Keep them concise and natural for an e-commerce shop. Keep brand names, fabric names and color names accurate. Return ONLY a JSON array of strings, same length and order as the input.`;
  const user = JSON.stringify(titles);

  const anth = process.env.ANTHROPIC_API_KEY;
  const oai = process.env.OPENAI_API_KEY;
  let text = "";
  if (anth) {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": anth, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 2000, system: sys, messages: [{ role: "user", content: user }] }),
    });
    if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 200)}`);
    text = (await r.json())?.content?.[0]?.text || "";
  } else if (oai) {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${oai}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "gpt-4o-mini", temperature: 0, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    text = (await r.json())?.choices?.[0]?.message?.content || "";
  } else {
    throw new Error("Geen ANTHROPIC_API_KEY of OPENAI_API_KEY gezet.");
  }

  const m = text.match(/\[[\s\S]*\]/);
  const arr = m ? JSON.parse(m[0]) : [];
  if (!Array.isArray(arr) || arr.length !== titles.length) throw new Error("Onverwacht vertaalresultaat.");
  return arr.map((x) => String(x));
}

async function main() {
  const locale = (process.argv[2] || "en").trim();
  if (!LANG_NAME[locale]) {
    console.error("Gebruik: npm run translate:catalog -- <en|de|fr|es>");
    process.exit(1);
  }
  const db = getDb();
  // Zichtbare producten zonder vertaling in deze taal.
  const rows = await db.execute<{ id: string; title: string }>(sql`
    select p.id, p.title from products p
    where p.status='active' and p.has_image=true and p.in_stock=true and p.is_group_primary=true
      and not exists (select 1 from product_translations t where t.product_id=p.id and t.locale=${locale})
    order by p.stock_qty desc
    limit 2000
  `);
  const list = rows.rows;
  console.log(`⏳ ${list.length} producten te vertalen naar ${LANG_NAME[locale]}…`);
  if (!list.length) {
    console.log("Niets te doen.");
    process.exit(0);
  }

  const BATCH = 25;
  let done = 0;
  for (let i = 0; i < list.length; i += BATCH) {
    const slice = list.slice(i, i + BATCH);
    try {
      const translations = await translateBatch(slice.map((s) => s.title), LANG_NAME[locale]);
      await db
        .insert(productTranslations)
        .values(slice.map((s, j) => ({ productId: s.id, locale, title: translations[j] || s.title })))
        .onConflictDoUpdate({
          target: [productTranslations.productId, productTranslations.locale],
          set: { title: sql`excluded.title`, updatedAt: sql`now()` },
        });
      done += slice.length;
      process.stdout.write(`\r  ${done}/${list.length}`);
    } catch (e) {
      console.error(`\n  batch ${i} faalde:`, (e as Error).message);
    }
  }
  console.log(`\n✓ Klaar — ${done} titels vertaald naar ${locale}.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
