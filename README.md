# gentsnext

De nieuwe gents.nl: een volledig eigen Next.js-storefront met eigen
commerce-database en Mollie-checkout. Shopify wordt volledig uitgefaseerd;
SRS blijft het ERP/kassasysteem en `storegents` blijft de integratielaag.

**Status: fase 1 — fundament.** Catalogus-schema, Shopify-migratie-imports en
de products-cache-publisher staan. Storefront, zoeken (Meilisearch), accounts
(Better Auth) en checkout (Mollie) volgen in fase 2/3.

## Architectuur in één alinea

Neon Postgres is het system of record voor de catalogus (producten, varianten
met SRS-koppelvelden, prijzen mét historie voor de wettelijke
Omnibus-30-dagenregel, collecties, voorraadspiegel). De bevroren Shopify-ID's
blijven bewaard voor feed-continuïteit (Google Merchant Center / Squeezely)
en migratie-mapping. Een dagelijkse cron publiceert de catalogus als
`shopify-products/cache.json` naar de blob-store van `storegents` — in exact
hetzelfde formaat als de huidige Shopify-dump, zodat de ~44 portal-modules
(artikel-zoeker, Bol-pipeline, feeds, mail-automations, …) ongewijzigd blijven
werken terwijl de bron verschuift.

## Lokale setup

```bash
npm install
copy .env.example .env.local   # en invullen
npm run db:migrate             # maakt de tabellen aan in Neon
npm run dev
```

## Catalogus vullen

1. **Bootstrap (vandaag al mogelijk, lossy):**
   `npm run import:cache -- --url <blob-url-van-cache.json>`
   Leest de bestaande storegents-productcache en vult producten/varianten/
   prijshistorie. Geen SEO-velden of compare-at-prijzen — genoeg om mee te bouwen.
2. **Volledige migratie (gezaghebbend):**
   `npm run import:shopify -- --save`
   Draait een Shopify GraphQL Bulk-export (producten + alle metafields + media +
   collecties + SEO) en upsert alles. Idempotent — opnieuw draaien werkt bij.
3. **Cache publiceren:**
   `npm run cache:publish -- --dry` om te controleren, zonder `--dry` om echt
   naar de storegents-blob te schrijven. De cron (04:00 UTC) doet dit dagelijks.

## Vercel-checklist (eenmalig)

1. **Project koppelen** aan deze GitHub-repo (framework wordt automatisch
   Next.js gedetecteerd; geen build-instellingen nodig).
2. **Storage → Create Database → Neon (Postgres)** en aan het project koppelen
   — `DATABASE_URL` verschijnt automatisch bij de env-vars. Draai daarna lokaal
   eenmalig `npm run db:migrate` (met die URL in `.env.local`).
3. **Environment variables** (Settings → Environment Variables):
   `CRON_SECRET` (vrij gekozen geheim), `STOREGENTS_BLOB_READ_WRITE_TOKEN`
   (het blob-token uit het storegents-project), `PUBLIC_SITE_URL`, en pas bij
   livegang `SITE_INDEXABLE=true`. Voor de migratie-import (lokaal) ook
   `SHOPIFY_STORE_DOMAIN` + `SHOPIFY_ADMIN_ACCESS_TOKEN`.
4. **Deployment Protection aan laten** (Vercel Authentication) zolang de site
   niet live is — dubbel slot bovenop de noindex.
5. **Géén domein koppelen.** gents.nl blijft op Shopify tot de geplande
   atomische DNS-cutover; eventueel `next.gents.nl` als preview-domein.
6. **Crons** (`vercel.json`): actief zijn `sync-reviews` (02:00), `blog`/stijlgids
   (09:00 op de 1e + 15e) en `translate` (03:00 — UI + producttitels/-omschrijvingen
   naar en/de/fr/es). Allemaal `CRON_SECRET`-gated. De **catalogus-cache-publicatie**
   (`npm run cache:publish`) blijft bewust handmatig tot er een doorlopende
   catalogus-sync naar deze database draait (de route weigert bij lege catalogus).

## Launch-checklist (pas bij cutover — NIET nu)

**Env / kill-switches (Vercel → gentsnext):**

| Variabele | Nu (pre-launch) | Bij go-live | Effect |
| --- | --- | --- | --- |
| `MOLLIE_API_KEY` | `test_…` | `live_…` (of `access_…`-token in live-modus) | echte betalingen |
| `SITE_INDEXABLE` | leeg → **noindex** | `true` | Google mag indexeren (`app/(shop)/robots.ts`, sitemap, layout) |
| `SRS_PUSH_ENABLED` | uit | **LATEN UIT** | bewust: SRS = alléén WMS/voorraadbron, géén weborder-push (kill-switch `lib/srs.ts`) |
| `RESEND_API_KEY` + `RESEND_FROM` | gezet? → **bevestigen** | gezet | transactionele mail (bestelbevestiging, magic-link). Let op: er is géén test-adres-guard — bij live Mollie gaan mails naar échte klanten (zo bedoeld) |
| `ANTHROPIC_API_KEY` | ✅ gezet | — | vertaal-cron + stijlgids + AI |
| `CRON_SECRET`, `DATABASE_URL`, `PUBLIC_SITE_URL`, `STOREGENTS_BLOB_READ_WRITE_TOKEN` | gezet | gezet | platform |

**Omnichannel-core (kassa ↔ webshop):**
- [ ] `STORE_CORE_TOKEN` staat in **beide** projecten (gentsnext + storegents) met dezelfde waarde; `GENTSNEXT_CORE_URL` in storegents. **Roteer dit token** (is in een chat geplakt) en zet de nieuwe waarde in beide.
- [ ] SRS-voorraad-SFTP-sync draait (blob `srs-voorraad/srs-rows-latest.json`, ~3×/dag) — externe afhankelijkheid, géén Vercel-cron. De anti-oversell-laag (Fase D) + de gedeelde core leunen op een actuele baseline.

**Cutover-stappen:**
- [ ] `SITE_INDEXABLE=true`
- [ ] Deployment Protection uit voor productie
- [ ] DNS gents.nl → Vercel (lage TTL vooraf), Shopify naar Pause and Build
- [ ] Sitemap indienen in Search Console; redirect-map voor legacy-URL's live

**Verificatie ná livegang:**
- [ ] Eén echte test-bestelling met live Mollie (klein bedrag) → betaald → bevestigingsmail → SRS-allocatie-plan op de order; daarna evt. terugbetalen.
- [ ] `/en/` `/de/` tonen vertaalde content (na de eerste 03:00-vertaalcron).
- [ ] `robots.txt` = allow; sitemap bereikbaar.
- [ ] Kassa: een verkoop verlaagt de webshop-voorraad (gedeelde core) en omgekeerd; dagafsluiting sluit kloppend.

## Conventies

- Geldbedragen: integer centen, nooit floats.
- SVG-iconen via een icon-component, nooit emoji's in UI.
- Instellingen horen in de portal-UI (blob-config), niet in env-vars —
  env is alleen voor secrets en platform-config.
