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
6. **Cron controleren** na de eerste deploy: Settings → Cron Jobs toont
   `/api/cron/publish-products-cache` (dagelijks 04:00 UTC). Vercel stuurt
   `CRON_SECRET` automatisch mee als Bearer-token.

## Launch-checklist (pas bij cutover — NIET nu)

- [ ] `SITE_INDEXABLE=true` zetten (robots/noindex-schakelaar in
      `app/robots.ts` en `app/layout.tsx`)
- [ ] Deployment Protection uit voor productie
- [ ] DNS gents.nl → Vercel (lage TTL vooraf), Shopify naar Pause and Build
- [ ] Sitemap indienen in Search Console; redirect-map voor legacy-URL's live

## Conventies

- Geldbedragen: integer centen, nooit floats.
- SVG-iconen via een icon-component, nooit emoji's in UI.
- Instellingen horen in de portal-UI (blob-config), niet in env-vars —
  env is alleen voor secrets en platform-config.
