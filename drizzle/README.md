# Database-migraties (Drizzle)

De migratiegeschiedenis is op 14 juni 2026 **opnieuw gebaseerd** (`0000_baseline.sql`).
Reden: eerdere schemawijzigingen waren via `db:push` toegepast en nooit als migratie
vastgelegd, waardoor de journal/snapshots niet meer overeenkwamen met de echte database
en `db:generate` tientallen al-bestaande tabellen opnieuw wilde aanmaken.

`0000_baseline.sql` bevat het **volledige schema** zoals het op dat moment live stond.
De live-database is in `drizzle.__drizzle_migrations` gemarkeerd als "baseline reeds
toegepast" (één rij met de baseline-timestamp), zodat `db:migrate` de baseline op de
bestaande database **overslaat**. Op een verse database bouwt de baseline het volledige
schema in één keer op.

## Workflow — ALTIJD via migraties, NOOIT meer `db:push`

1. Pas `db/schema.ts` aan.
2. `npm run db:generate` → maakt een nieuwe migratie + werkt de snapshot bij.
3. Controleer het gegenereerde `drizzle/00xx_*.sql` (alleen je bedoelde wijziging).
4. `npm run db:migrate` → past de migratie toe op de database.

`npm run db:push` **niet** gebruiken: dat past wijzigingen direct toe zonder een
migratie/snapshot vast te leggen, waardoor de geschiedenis weer uit sync raakt
(precies wat hier is rechtgezet). Na een correcte `generate` hoort `db:generate`
opnieuw "No schema changes" te geven.
