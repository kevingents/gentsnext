import "@/lib/load-env";
import { getDb } from "@/db";
import { sql } from "drizzle-orm";
import { parseCare } from "@/lib/care";

/**
 * Draait parseCare() over élk actief product dat GEEN wasvoorschrift heeft (en dus
 * op de fallback terugvalt), en toont het advies per categorie. Zo is te zien of een
 * pakbroek stomerij-advies krijgt en een chino gewoon wasbaar blijft.
 */
async function main() {
  const db = getDb();
  const rows = (await db.execute<{ titel: string; hg: string; sub: string; mat: string; attrs: Record<string, unknown> }>(sql`
    select title titel,
           coalesce(attributes->>'hoofdgroep_omschrijving','(leeg)') hg,
           coalesce(attributes->>'subgroep','(leeg)') sub,
           coalesce(attributes->>'materiaal','(leeg)') mat,
           attributes attrs
    from products
    where status='active' and coalesce(attributes->>'wasvoorschrift','') = ''
    order by hg, sub, titel`)).rows;

  const perCat = new Map<string, { advies: string; titels: string[] }[]>();
  for (const r of rows) {
    const advies = parseCare("", { ...r.attrs, titel: r.titel }).map((i) => i.label).join(" · ") || "(geen advies)";
    const cat = r.hg;
    const lijst = perCat.get(cat) ?? [];
    const bestaand = lijst.find((x) => x.advies === advies);
    if (bestaand) bestaand.titels.push(`[${r.sub}] ${r.titel}`);
    else lijst.push({ advies, titels: [`[${r.sub}] ${r.titel}`] });
    perCat.set(cat, lijst);
  }

  let verdacht = 0;
  for (const [cat, lijst] of perCat) {
    console.log(`\n### ${cat}  (${lijst.reduce((n, l) => n + l.titels.length, 0)} zonder wasvoorschrift)`);
    for (const { advies, titels } of lijst) {
      // Een pak-onderdeel dat "wassen" te horen krijgt is fout; idem metaal dat "strijken" hoort.
      const wasbaar = /(^|· )Wassen /.test(advies); // "Niet wassen" mag NIET meetellen
      const fout =
        (/pantalon|smoking|jacquet|\bmm\b|mixmatch|kostuum|rokvest/i.test(titels.join(" ")) && wasbaar) ||
        (/manchetknop|dasspeld/i.test(cat) && advies !== "(geen advies)") ||
        (/stropdas|strik|pochet/i.test(cat) && wasbaar) ||
        (/leder|leer|suede|suède/i.test(titels.join(" ")) && wasbaar);
      if (fout) verdacht += titels.length;
      console.log(`  ${fout ? "!! FOUT" : "   ok   "}  ${advies}`);
      titels.slice(0, 6).forEach((t) => console.log(`             ${t}`));
      if (titels.length > 6) console.log(`             … +${titels.length - 6} meer`);
    }
  }
  console.log(`\n=== ${verdacht} verdachte adviezen over ${rows.length} producten zonder wasvoorschrift ===`);
  process.exit(verdacht ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
