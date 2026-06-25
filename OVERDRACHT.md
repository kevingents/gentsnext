# Overdracht — GENTS omnichannel-stack

> Doel van dit document: een nieuwe ontwikkelaar (Hessel) snel meenemen in **hoe het
> geheel werkt**, **waar we staan** en **wat er moet gebeuren voor go-live en daarna**.
> Laatst bijgewerkt: 24 juni 2026.

---

## 1. De drie repo's en hun rol

| Repo | Stack | Rol |
| --- | --- | --- |
| **gentsnext** | Next 15 (App Router), Neon Postgres + Drizzle, Vercel | De **nieuwe webshop** (gents.nl) **én** de **omnichannel-core** (gedeelde voorraad/orders-DB) + de studio-API's die het portal voeden. |
| **storeportal_next** | Next (App Router), Vercel | Het **medewerkers-portal**: beheer ("Nieuwe site"-tabs) + de **kassa-UI** (`/kassa-proef`). Praat als BFF met gentsnext (studio-token) en met storegents (sessie). |
| **storegents** | Vercel serverless, ESM JavaScript | De **backend-API's**: kassa-endpoints (`/api/store/*`), SRS-koppeling, filialen (`/api/branches`), mail (Resend), blobs. |

**Externe systemen:** **SRS** = WMS / voorraadbron (read-only). **Mollie** = webbetalingen. **Resend** = transactionele mail. **Shopify** = wordt uitgefaseerd (alleen nog transitie: de kassa-`article-search-live` en wat productdata).

---

## 2. Het hart: de omnichannel-voorraadflow

SRS is **alleen WMS** (besluit 23 juni 2026). Er gaat **geen** weborder-push meer naar SRS (`SRS_PUSH_ENABLED` blijft uit). De gedeelde waarheid leeft in **Neon**:

```
beschikbaar(locatie, artikel)
  = SRS-baseline            (uit de SFTP-blob srs-voorraad/srs-rows-latest.json, ~3×/dag)
  + kassa-delta             (store_stock_movements — verkopen/correcties uit de kassa)
  − web-reservering         (lopende web-/afhaalorders, afgeleid uit orders+fulfillment_plan)
  − veiligheidsvoorraad     (retailSafetyStock = 2 per winkel, warehouse = 0)
```

- **store_stock_movements** (Neon, append-only grootboek): kassa én web boeken hier; idempotent op `(ref, channel, stockKey)`.
- **Lees-API** (token-gated): `POST /api/core/stock/available` geeft per artikel `{baseline, posDelta, webReserved, safety, available}`.
- **Anti-oversell:**
  - **Web (Fase D):** bij `createOrder` claimt een **atomaire gate** de voorraad (tabel `web_stock_reservation_counter` + `web_stock_holds`, één SQL-statement → rij-lock serialiseert gelijktijdige checkouts). Hold verloopt via TTL of valt vrij bij betaald/mislukt.
  - **Winkel:** de kassa **waarschuwt** de kassier als een mand-artikel online gereserveerd is (verkoop kan een webklant tekortdoen). `pos-sale` blokkeert niet — de directe baliesale mag het laatste stuk fysiek verkopen.
- **Kassa-weergave leest uit de core** (read-side cut-over): de winkelvoorraad + de POS-zoekgrid tonen het netto core-getal; de oude Blob-core is nog **fallback** (zie open punten).

Belangrijke bestanden (gentsnext): `lib/store-core.ts`, `lib/store-reserve.ts`, `lib/stock-reservations.ts`, `lib/orders.ts`, `lib/fulfillment.ts` (allocatie magazijn-eerst/least-split), `lib/settings.ts` (o.a. `retailSafetyStock`).

---

## 3. De kassa (POS) — in `storeportal_next` + `storegents`

- **Waar:** portal `/kassa-proef` (`components/features/kassa/KassaPos.tsx`), per filiaal (`?store=` of de actieve winkel).
- **Verkoopflow:** scan/zoek → mandje → afrekenen (contant / pin\* / cadeaubon / split + wisselgeld) → bon (mail + publieke bonpagina). Offline-wachtrij + sync. Hardware via een lokale agent (lade, printen).
- **Features:** parkeren (drafts), korting op bon, vrije/custom verkoop, retour/annulering, loyalty (punten + vouchers), **dagafsluiting** (kasstaat-Z + kasopmaak, **mailbaar** voor de boekhouding), **bestel voor klant** (bezorgen óf **afhalen in een (ander) filiaal** = click&collect), **afhalen/orders** (afhaalorders + ship-from-store), **volledig scherm** (kiosk) + tablet-proof.
- \***PIN** zit er nog niet in (vereist Worldline/PAY-terminal — hardware/PSP-keuze).
- **Endpoints (storegents):** `pos-sale`, `pos-draft`, `store-stock`, `stock-reserved`, `store-orders`, `dagafsluiting(-email)`, `article-search`. Voorraad-nummers komen uit de gentsnext-core (`gentsnext-core-client.js`, env `GENTSNEXT_CORE_URL` + `STORE_CORE_TOKEN`).

Architectuur-roadmap van de kassa: `storegents/docs/omnichannel-core-architectuur.md`.

---

## 4. De webshop (gentsnext)

- **Catalogus** in Neon (geseed; alleen producten met foto + voorraad). PLP-filters, PDP met maatmatrix + maatadvies (`lib/size-chart.ts`, uit de Faslet-maattabel), pak-samensteller, looks/shop-the-look, AI-stijlgids/blog.
- **Checkout:** Mollie (betaalmethode vooraf kiesbaar), vouchers/cadeaubonnen/staffelkorting, click&collect, zakelijk bestellen.
- **Content-laag = eigen stack (Sanity is volledig verwijderd).** Alles portal-beheerbaar via een content-store (`app_settings` id `content:<key>`): **menu, footer, gelegenheden, looks, pagina's** (lichte, veilige Markdown). Beheer onder portal → "Nieuwe site".
- **Meertalig:** NL/EN/DE/FR/ES. UI-microcopy + producttitels/-omschrijvingen via een eigen vertaal-engine (`lib/translate.ts`) + nachtelijke cron; componenten gebruiken `t()`/`useT()` (parametrisch). Bron-keys in `lib/messages-catalog.ts`.
- **Config-principe:** instellingen horen in de **tool** (settings-store + `/account/instellingen`), **niet** in Vercel-env — env is alleen voor secrets/platform.

---

## 5. Waar we NU staan (status: pre-launch, klaar voor cutover)

**Live op `gentsnext.vercel.app` (Mollie TEST, niet geïndexeerd):** volledige webshop + omnichannel-core + kassa-pilot.

Recent afgerond (incl. deze sessie):
- Content-laag compleet + **Sanity eruit** (build groen).
- **Fase D** anti-oversell (atomaire gate, bewezen).
- Kassa **read-side cut-over** (voorraad uit de core, Blob = fallback) + **POS-grid op core-voorraad**.
- **Dagafsluiting** (kasstaat + kasopmaak) + **mailbaar**.
- **Meertaligheid compleet** (parametrische i18n, hele storefront gewired).
- **Bestel voor klant → afhalen in (ander) filiaal** (click&collect vanuit de kassa).
- **Veiligheidsvoorraad = 2** per winkel, consistent op de gedeelde voorraadlaag (instelbaar in `/account/instellingen` → "Voorraad-bescherming").
- Kassa **fullscreen + tablet-proof**.
- Een adversariële **go-live-review** met 10 doorgevoerde fixes (o.a. dagafsluiting-annuleringen, BTW-grondslag, stored-XSS in menu/gelegenheden, hold-TTL voor banktransfer, order_lines-volgorde).

---

## 6. Wat te doen voor GO-LIVE

> Volledige, actuele checklist staat in **`README.md` → "Launch-checklist"**. Kort:

**Env (Vercel → gentsnext):**
- `MOLLIE_API_KEY`: `test_…` → **`live_…`**
- `SITE_INDEXABLE`: leeg → **`true`** (Google mag indexeren)
- `SRS_PUSH_ENABLED`: **laten UIT** (SRS = alleen WMS)
- `RESEND_API_KEY` + `RESEND_FROM`: **bevestigen** (let op: geen test-adres-guard → live gaan mails naar échte klanten)
- `ANTHROPIC_API_KEY`: staat (vertaling/AI)

**Omnichannel-core:**
- `STORE_CORE_TOKEN` in **beide** projecten (gentsnext + storegents), zelfde waarde → **roteren** (is ooit in een chat geplakt). `GENTSNEXT_CORE_URL` in storegents.
- **SRS-SFTP-voorraadsync moet draaien** (blob 3×/dag) — externe afhankelijkheid die de hele core voedt.

**Cutover:** SITE_INDEXABLE aan → Deployment Protection uit → DNS gents.nl → Vercel (lage TTL vooraf) + Shopify op Pause-and-Build → sitemap in Search Console + redirect-map legacy-URL's.

**Verificatie ná live:** echte test-bestelling (live Mollie, klein bedrag) → betaald → bevestigingsmail → SRS-allocatieplan; `/en/ /de/` vertaald; `robots.txt` = allow; kassa↔webshop-voorraad synchroon; dagafsluiting sluit kloppend.

---

## 7. Openstaand werk (na go-live / hardware / keuzes)

| Onderwerp | Aard |
| --- | --- |
| **PIN-terminal** (Worldline/PAY.) in de kassa | Hardware + PSP-keuze |
| **Blob-core uitfaseren** (nu nog fallback + write-backup) | Pas ná productie-bewijs van de Neon-core |
| **Catalogus & prijzen één bron** (POS gebruikt nu SRS-data, web de Neon-catalogus; voorraad is wél gedeeld) | Roadmap-fase 5 |
| **Herverdelingen** (filiaal-overboekingen) meenemen in de voorraad | Ontwerpkeuze openstaand (zie `storegents/api/admin/herverdeling.js`, `lib/srs-uitwisseling-client.js`) |
| **PWA/kiosk** voor de kassa-tablet (Add-to-Home-Screen, standalone) | Optioneel, betrouwbaarste iPad-kiosk |
| **Sokken eigen modelbeeld** | Kost FASHN-credits |

---

## 8. Praktische overdracht aan Hessel

**Toegang die hij nodig heeft:**
1. **GitHub** — alle drie de repo's (gentsnext, storeportal_next, storegents).
2. **Vercel** — de drie projecten + hun Environment Variables.
3. **Neon** — de Postgres-DB (gekoppeld aan gentsnext; `DATABASE_URL`).
4. **Apple/Mollie/Resend/Anthropic/SRS** — secrets staan in Vercel-env, niet in de repo.

**Per repo lokaal draaien:**
- gentsnext / storeportal_next: `npm install`, `.env.local` vullen (zie `.env.example` waar aanwezig), `npm run dev`. Typecheck: `npx tsc --noEmit`. Build: `npm run build`.
- storegents: ESM JS, Vercel-functions; geen build/typecheck — `node --check <bestand>` voor syntax. Lokaal via `vercel dev`.

**Database-migraties (gentsnext, Drizzle) — BELANGRIJK:**
- `npm run db:generate` (genereert SQL uit `db/schema.ts`) → `npm run db:migrate` (voert uit op Neon).
- **NOOIT `db:push`** gebruiken — dat omzeilt de migratie-historie. Altijd generate + migrate.

**Conventies (hard):**
- Geldbedragen in **centen** (gentsnext) / euro's met `round2` (kassa). Nooit floats voor geld.
- **Altijd SVG-iconen** via de Icon-component, **nooit emoji** in UI.
- Instellingen horen in de **tool** (settings-store + portal), niet in env, tenzij secret.
- Pre-launch grenzen die aan blijven tot bewust go-live: Mollie TEST, `SRS_PUSH_ENABLED` uit, `SITE_INDEXABLE` uit, geen klant-mails buiten test.

**Belangrijkste documentatie om te lezen:**
1. Dit bestand (`OVERDRACHT.md`).
2. `README.md` (gentsnext) — setup + Launch-checklist.
3. `storegents/docs/omnichannel-core-architectuur.md` — de kassa/voorraad-architectuur + roadmap.

**Mentaal model in één zin:** *SRS levert de magazijnvoorraad, de Neon-core legt daar realtime de winkel- en webmutaties overheen, kassa en webshop rekenen met exact hetzelfde getal (met een veiligheidsbuffer van 2), en niets gaat dubbel verkocht.*
